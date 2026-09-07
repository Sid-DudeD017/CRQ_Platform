# Privacy & Data Handling

This document describes what the CRQ Platform actually does with data, matched to the real code paths (linked below) rather than written as a generic template. It's written for a hackathon/demo-scale deployment, not as a legally-reviewed policy for a production financial-services product — see the caveat at the bottom.

## What is collected

| Data | Collected when | Where |
|---|---|---|
| Email + bcrypt-hashed password | You sign up for a real account | `backend/models.py::User` |
| Uploaded device/config files | You use the Ingestion Engine ("Enter your own data") | Parsed in-memory by `backend/ingestion_engine.py`; only the *parsed, structured mapping* (parameter name, risk tag, confidence) is stored — never the raw file content, and the content is never sent to the AI model (see the tripwire comment at the top of `ingestion_engine.py`) |
| Telemetry / asset data | Demo mode uses shared synthetic data; Own Data mode uses whatever you ingest or manually enter | `models.Asset`, `models.TelemetryLog`, scoped to your account via `owner_email` |
| Simulation results & risk-acceptance decisions | Every time you run a simulation or accept/approve a risk | `models.RiskSimulation`, `models.RiskDecision` |
| Chat messages to the Virtual CISO | Each chat turn | Sent to the configured LLM (Groq, or OpenAI if configured) for that turn only — not persisted server-side beyond the request/response cycle, and telemetry fields like `ip_address`/`owner_email` are deliberately excluded from what the AI's tools can read (see `ai-agent/tools.py`) |
| A thumbs-up/down rating on one chat answer | Only when you click a rating button under that specific message | Persisted (`models.ChatFeedback`) — the one deliberate exception to "chat isn't stored": just that one question/answer pair, capped in length, used solely to compute the AI-answer-usefulness metric (see `docs/SUCCESS_METRICS.md`). Never captured automatically |
| Basic request metadata (method, route, status, timing) | Every API request | In-process only, aggregated into counters (`backend/observability.py`) — never per-request logs of who called what |

## What is *not* collected

- Payment information (this app has none).
- Uploaded file content itself, beyond the structured mapping described above.
- Browsing history, location, or device fingerprinting.
- Anything from the two demo accounts (`ciso`/`cfo`) beyond whatever own-data they choose to enter while logged in as one.

## How data is isolated

Every "own data" row carries both a `data_source` ("predefined" vs "own") and an `owner_email` field. Every endpoint that reads "own" data filters by the caller's verified identity (from their JWT) — never from a client-supplied parameter — so one account's ingested environment, simulations, and decisions are never visible to a different account. See any endpoint in `backend/main.py` with a "[Cross-user data leakage fix]" comment for the specific history here.

## Retention

- **Risk-acceptance decisions (the audit ledger)** are kept indefinitely — they're this platform's compliance evidence, and are only ever deleted via your own explicit `DELETE /api/account` call (see below).
- **Incident records** (used for calibration) are likewise never auto-purged — deleting them would corrupt future calibration math.
- **Telemetry and simulation history** older than 365 days (configurable) can be purged by an admin via `POST /api/admin/purge-stale-data` — see `backend/retention.py`. This does not run automatically; it's an admin-invoked (or cron-invoked) maintenance action.
- **Demo/predefined data** is synthetic and can be regenerated or reset at any time via the existing demo-reset flow — it never represents a real environment.

## Your rights (self-service)

- **Export everything you own**: `GET /api/account/export` (requires being logged in) returns your full data as JSON.
- **Delete everything you own**: `DELETE /api/account` with `{"confirm": true}` permanently deletes all of your own-data rows, and your account itself if you have a real (non-demo) account. This is irreversible — export first if you want a copy.

## Third parties

- **LLM provider** (Groq, or OpenAI if configured): receives your chat messages for the duration of generating a response. No other data (telemetry, financial figures, other accounts' data) is sent unless you explicitly ask the Virtual CISO about it in your own message.
- **Blockchain (local Hardhat node)**: an on-chain commit stores only a hash/reference of a risk decision, not its full content, and only happens when you explicitly click to commit it — see `POST /api/audit-log/{id}/commit-chain`.
- No analytics, advertising, or data-broker integrations exist anywhere in this codebase.

## Caveat

This document describes actual current behavior in this codebase as of the "Data lifecycle" hardening pass referenced in `README.md`. It is written by the engineering work on this project, not by legal counsel — before handling real users' real financial/security data in production, have this reviewed against DPDP Act 2023 / applicable regulations by someone qualified to do so.
