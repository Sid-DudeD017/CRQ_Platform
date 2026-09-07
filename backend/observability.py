"""
Lightweight, dependency-free observability for the CRQ Platform backend:
structured logging, in-process request/simulation metrics, and a plain
Prometheus-text-format /api/metrics exposition.

Deliberately dependency-free (no prometheus_client, no APM agent, no
external log shipper) - this backend runs on a single free-tier instance
for a demo/hackathon deployment with no guaranteed network egress to a
paid observability backend, so "real structured logs plus real in-process
counters" is the honest, always-works version of this rather than wiring
up a SaaS integration that would silently no-op (or fail to start) without
credentials. Every counter here resets on process restart - there's no
persistence layer for metrics, matching the rest of this backend's
"single process, single SQLite/Postgres database" scale.
"""
import json
import logging
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict


class JsonLogFormatter(logging.Formatter):
    """
    Renders each log record as one JSON line: timestamp, level, logger
    name, message, plus any extra fields passed via `logging.info(...,
    extra={...})`. Structured logs are what actually make "grep the logs"
    tractable once there's more than one kind of event flowing through the
    same stream (admin actions, per-user audit events, request timing,
    simulation failures) - free-text log lines are fine for one signal,
    but become impossible to reliably filter/aggregate once several are
    interleaved.
    """
    # Attributes every stdlib LogRecord carries - anything else on the
    # record was passed via `extra={...}` by the call site and should be
    # surfaced in the JSON line.
    _STANDARD_ATTRS = set(logging.LogRecord(
        "", 0, "", 0, "", (), None
    ).__dict__.keys())

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in self._STANDARD_ATTRS and key not in payload:
                try:
                    json.dumps(value)  # only include JSON-safe extras
                    payload[key] = value
                except (TypeError, ValueError):
                    payload[key] = str(value)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_structured_logging(level: int = logging.INFO) -> None:
    """
    Replaces the default plain-text root handler with one that emits JSON
    lines (see JsonLogFormatter above). Called once at import time from
    main.py, before any other logger is used, so every logger in this
    process (admin_actions, audit_events, ai_tools, chat, uvicorn's own
    access/error logs, etc.) inherits the same structured format instead
    of each needing its own handler.
    """
    root = logging.getLogger()
    root.setLevel(level)
    # Clear any handlers a prior basicConfig() call (or reload) may have
    # attached, so log lines aren't duplicated in one plain + one JSON copy.
    for existing_handler in list(root.handlers):
        root.removeHandler(existing_handler)
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root.addHandler(handler)


# --- In-process metrics -----------------------------------------------
# A single lock guards every counter below. Request volume on a demo
# instance is low enough that a coarse global lock is not a real
# bottleneck, and it keeps this module trivially correct instead of
# reaching for per-metric atomics for a scale this app doesn't operate at.
_metrics_lock = threading.Lock()

_request_metrics: Dict[str, Dict[str, float]] = defaultdict(
    lambda: {"count": 0, "total_duration_ms": 0.0, "status_2xx": 0, "status_4xx": 0, "status_5xx": 0}
)
_simulation_metrics = {"success": 0, "failure": 0}
_client_error_count = 0


def record_request(method: str, route_path: str, status_code: int, duration_ms: float) -> None:
    """Called once per HTTP request (see main.py's request-timing
    middleware) - route_path should be the matched route template (e.g.
    '/api/audit-log/{decision_id}/commit-chain'), never the raw URL, so
    per-account/per-ID paths aggregate into one metric instead of one
    series per unique ID ever requested."""
    key = f"{method} {route_path}"
    with _metrics_lock:
        bucket = _request_metrics[key]
        bucket["count"] += 1
        bucket["total_duration_ms"] += duration_ms
        if 200 <= status_code < 300:
            bucket["status_2xx"] += 1
        elif 400 <= status_code < 500:
            bucket["status_4xx"] += 1
        elif status_code >= 500:
            bucket["status_5xx"] += 1


def record_simulation_result(success: bool) -> None:
    with _metrics_lock:
        _simulation_metrics["success" if success else "failure"] += 1


def record_client_error() -> None:
    global _client_error_count
    with _metrics_lock:
        _client_error_count += 1


def render_prometheus_text() -> str:
    """
    Plain Prometheus text-exposition format, built by hand (no
    prometheus_client dependency - see module docstring) so any standard
    scraper (Prometheus itself, Grafana Agent, a `curl` in a health-check
    script) can read it without this backend needing network access to
    install a metrics library.
    """
    lines = [
        "# HELP crq_http_requests_total Total HTTP requests handled, by method+route.",
        "# TYPE crq_http_requests_total counter",
    ]
    with _metrics_lock:
        for key, bucket in sorted(_request_metrics.items()):
            method, _, route = key.partition(" ")
            avg_ms = (bucket["total_duration_ms"] / bucket["count"]) if bucket["count"] else 0.0
            labels = f'method="{method}",route="{route}"'
            lines.append(f'crq_http_requests_total{{{labels}}} {int(bucket["count"])}')
            lines.append(f'crq_http_request_duration_ms_avg{{{labels}}} {avg_ms:.2f}')
            lines.append(f'crq_http_responses_total{{{labels},class="2xx"}} {int(bucket["status_2xx"])}')
            lines.append(f'crq_http_responses_total{{{labels},class="4xx"}} {int(bucket["status_4xx"])}')
            lines.append(f'crq_http_responses_total{{{labels},class="5xx"}} {int(bucket["status_5xx"])}')

        lines.append("# HELP crq_simulation_results_total Monte Carlo simulation outcomes.")
        lines.append("# TYPE crq_simulation_results_total counter")
        lines.append(f'crq_simulation_results_total{{outcome="success"}} {int(_simulation_metrics["success"])}')
        lines.append(f'crq_simulation_results_total{{outcome="failure"}} {int(_simulation_metrics["failure"])}')

        lines.append("# HELP crq_frontend_errors_total Client-side errors reported via POST /api/client-error.")
        lines.append("# TYPE crq_frontend_errors_total counter")
        lines.append(f"crq_frontend_errors_total {int(_client_error_count)}")
    return "\n".join(lines) + "\n"


def get_summary() -> Dict[str, Any]:
    """
    [Success metrics #15] Plain-JSON rollup of the same counters
    render_prometheus_text() formats for a scraper - used by
    GET /api/admin/success-metrics so "API and simulation failure rates"
    can be computed from the same in-process counters everything else in
    this module already tracks, instead of a second parallel tracking
    system. Aggregates _request_metrics across every route (that endpoint
    doesn't need a per-route breakdown, just an overall rate).
    """
    with _metrics_lock:
        total_requests = sum(b["count"] for b in _request_metrics.values())
        total_5xx = sum(b["status_5xx"] for b in _request_metrics.values())
        total_4xx = sum(b["status_4xx"] for b in _request_metrics.values())
        sim_success = _simulation_metrics["success"]
        sim_failure = _simulation_metrics["failure"]
        client_errors = _client_error_count
    total_sims = sim_success + sim_failure
    return {
        "total_requests": total_requests,
        "request_5xx_rate": (total_5xx / total_requests) if total_requests else None,
        "request_4xx_rate": (total_4xx / total_requests) if total_requests else None,
        "simulation_success": sim_success,
        "simulation_failure": sim_failure,
        "simulation_failure_rate": (sim_failure / total_sims) if total_sims else None,
        "frontend_client_errors": client_errors,
        "since_process_start": True,  # these counters reset on every restart - see module docstring
    }


class Timer:
    """Tiny context manager for measuring a block's wall-clock duration in
    milliseconds - used by the request-timing middleware in main.py."""

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *exc_info):
        self.duration_ms = (time.perf_counter() - self._start) * 1000.0
