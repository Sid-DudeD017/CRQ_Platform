"""
Rule-based network-config parser behind the Ingestion Engine
(frontend/src/app/ingestion/page.tsx).

The page previously showed one hardcoded example mapping (the same
"ip verify unicast source reachable-via rx" -> "Enforce Anti-Spoofing
(URPF)" pair, 85% confidence, on every load) regardless of what was
uploaded - there was no upload handler, no parser, and no backend
endpoint at all. This module actually reads the uploaded config text and
finds real, line-addressable matches against a small catalog of known
security-relevant directives common to enterprise/DC switch and router
configs (Cisco IOS-style and SONiC both use this same command grammar).

Design choices worth calling out:
- Confidence is not a single fabricated number shown on every mapping
  (the old UI always said "85%" no matter what). It's assigned per rule
  based on how unambiguous that rule's match actually is - an exact,
  well-known command string scores highest; a heuristic "this control
  looks absent" inference scores lower, because absence-from-one-file
  is weaker evidence than presence-of-a-specific-line.
- Most rules detect a *present* control (positive finding). Two rules
  detect a *gap* - a weak/default value present, or an expected control
  that's missing - because a real ingestion tool has to flag risk, not
  just catalog config. Each finding carries a `severity` the frontend
  uses to color it (info = confirmed good control, warning/critical =
  something a reviewer should look at).
"""
import re
from dataclasses import dataclass
from typing import List


@dataclass
class Finding:
    line_number: int          # 1-indexed line in the uploaded file
    snippet: str               # the actual matched raw text
    parameter: str             # standard compliance parameter name
    risk_tag: str
    confidence: float          # 0-1, see module docstring
    kind: str                  # "control_present" | "control_gap"
    severity: str              # "info" | "warning" | "critical"
    rationale: str              # one line explaining *why* this was flagged


# Each rule: a compiled regex tested against every line, and the finding
# fields to emit on a match. `confidence` reflects how unambiguous the
# match is - not a constant across every rule.
_LINE_RULES = [
    dict(
        pattern=re.compile(r"ip verify unicast (source reachable-via rx|reverse-path)"),
        parameter="Enforce Anti-Spoofing (uRPF)",
        risk_tag="Network Integrity",
        confidence=0.95,
        kind="control_present",
        severity="info",
        rationale="Exact, unambiguous uRPF directive - one specific command with one meaning.",
    ),
    dict(
        pattern=re.compile(r"^\s*service password-encryption\s*$"),
        parameter="Password Encryption Enabled",
        risk_tag="Credential Protection",
        confidence=0.92,
        kind="control_present",
        severity="info",
        rationale="Exact, well-known global command.",
    ),
    dict(
        pattern=re.compile(r"snmp-server community\s+(public|private)\s+RO", re.IGNORECASE),
        parameter="Default/Weak SNMP Community String",
        risk_tag="Credential Protection",
        confidence=0.9,
        kind="control_gap",
        severity="critical",
        rationale="'public'/'private' are the textbook default SNMP community strings - treated as compromised on sight.",
    ),
    dict(
        pattern=re.compile(r"^\s*enable password\s+\S+", re.IGNORECASE),
        parameter="Cleartext Enable Password (use 'enable secret')",
        risk_tag="Credential Protection",
        confidence=0.88,
        kind="control_gap",
        severity="critical",
        rationale="'enable password' stores a reversible/cleartext secret; 'enable secret' is the hashed equivalent and wasn't used here.",
    ),
    dict(
        pattern=re.compile(r"ip http secure-server"),
        parameter="Management Plane Hardening (HTTPS-only)",
        risk_tag="Access Control",
        confidence=0.85,
        kind="control_present",
        severity="info",
        rationale="Explicit HTTPS-only management directive.",
    ),
    dict(
        pattern=re.compile(r"switchport port-security\s*$"),
        parameter="Port Security Enabled",
        risk_tag="Access Control",
        confidence=0.85,
        kind="control_present",
        severity="info",
        rationale="Explicit port-security enable line on an access port.",
    ),
    dict(
        pattern=re.compile(r"logging host\s+\d{1,3}(?:\.\d{1,3}){3}"),
        parameter="Centralized Logging (SIEM Integration)",
        risk_tag="Detection & Monitoring",
        confidence=0.85,
        kind="control_present",
        severity="info",
        rationale="Explicit remote syslog destination configured.",
    ),
    dict(
        pattern=re.compile(r"ntp server\s+\d{1,3}(?:\.\d{1,3}){3}"),
        parameter="NTP Time Synchronization",
        risk_tag="Audit Integrity",
        confidence=0.75,
        kind="control_present",
        severity="info",
        rationale="Time sync matters for correlating logs/audit trails but is lower-stakes than the access-control findings above, hence the lower confidence.",
    ),
]

_NEIGHBOR_RE = re.compile(r"neighbor\s+(\d{1,3}(?:\.\d{1,3}){3})\s+remote-as\s+\d+")
_NEIGHBOR_PW_RE = re.compile(r"neighbor\s+(\d{1,3}(?:\.\d{1,3}){3})\s+password\s+\S+")


def parse_config(content: str) -> List[Finding]:
    """
    Scans raw config text and returns every Finding, in file order. Two
    passes: simple per-line regex rules, then one cross-line heuristic
    (BGP neighbors missing a matching password line) that can't be
    expressed as a single-line pattern.
    """
    findings: List[Finding] = []
    lines = content.splitlines()

    for i, line in enumerate(lines, start=1):
        for rule in _LINE_RULES:
            m = rule["pattern"].search(line)
            if m:
                findings.append(Finding(
                    line_number=i,
                    snippet=line.strip(),
                    parameter=rule["parameter"],
                    risk_tag=rule["risk_tag"],
                    confidence=rule["confidence"],
                    kind=rule["kind"],
                    severity=rule["severity"],
                    rationale=rule["rationale"],
                ))
                break  # one rule per line keeps output readable

    # BGP neighbor authentication gap: an org-level heuristic, not a
    # single-line match - collect every neighbor IP that HAS a password
    # line anywhere in the file, then flag any remote-as neighbor not in
    # that set. Confidence is deliberately lower than the line rules
    # above: we're inferring absence from one file, which is weaker
    # evidence than a specific line being present.
    authenticated_neighbors = set(_NEIGHBOR_PW_RE.findall(content))
    seen_neighbors = set()
    for i, line in enumerate(lines, start=1):
        m = _NEIGHBOR_RE.search(line)
        if m:
            ip = m.group(1)
            if ip in seen_neighbors:
                continue
            seen_neighbors.add(ip)
            if ip not in authenticated_neighbors:
                findings.append(Finding(
                    line_number=i,
                    snippet=line.strip(),
                    parameter="BGP Neighbor Authentication (Missing)",
                    risk_tag="Availability",
                    confidence=0.68,
                    kind="control_gap",
                    severity="warning",
                    rationale=f"No 'neighbor {ip} password ...' line found anywhere in this file for this peer.",
                ))

    findings.sort(key=lambda f: f.line_number)
    return findings
