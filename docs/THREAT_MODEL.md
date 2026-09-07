# Threat Model

A risk register for the CRQ Platform, covering the eight threat categories this project's own hardening passes have most directly touched. Each entry cites the actual mitigating code (not aspirational controls) and is honest about what's still a residual risk versus what's fully closed. Written from the accumulated context of this project's security fixes (see README's "Security Notes" and the many "[Cross-user data leakage fix]" / "[Public demo credentials exposed - fix]" comments throughout `backend/main.py`), not as a generic template.

## 1. Uploaded device configurations

**Vector:** A visitor uploads a device/firewall/network config file through the Ingestion Engine, hoping to either exfiltrate data via the parser, inject content that reaches the LLM, or crash parsing with a malformed file.

**Mitigations in place:**
- The raw file content is parsed in-memory (`backend/ingestion_engine.py`) and never persisted as a file - only the structured output (parameter name, risk tag, confidence, severity) is written to `IngestedMapping`. There is no file storage subsystem in this app at all.
- A tripwire comment at the top of `ingestion_engine.py` documents and locks in the invariant that this content never reaches an LLM prompt - the parser is a pure rule-based matcher, not an LLM call.
- File-size and content-type validation happens client-side before upload (`frontend/src/app/ingestion/page.tsx`: extension allowlist, size cap, empty-file and binary/non-UTF-8 detection) and the backend independently validates on `POST /api/ingest/parse`.

**Residual risk:** Client-side validation is a UX convenience, not a security boundary - a direct API call bypassing the frontend could still submit an oversized or malformed payload. The backend's own validation is the real boundary and should be periodically fuzz-tested.

**Recommendation:** Add a backend-side max-size check on `POST /api/ingest/parse` independent of the frontend's, if one doesn't already exist, and add a fuzz/malformed-input test to `tests/test_ingestion_engine.py`.

## 2. AI prompt injection

**Vector:** A visitor tries to get the Virtual CISO to ignore its instructions, reveal system prompts, fabricate regulatory claims, or take an action outside its intended scope, either directly in chat or indirectly via content that later flows into a prompt (e.g. an ingested config's text).

**Mitigations in place:**
- Ingested config content never reaches the LLM at all (see #1 above) - the most common indirect-injection vector (poisoned document content) is structurally closed, not just filtered.
- `ai-agent/graph.py`'s supervisor + ReAct sub-agent architecture scopes each sub-agent (`security_analyst`, `compliance_officer`, `quant_analyst`) to a fixed toolset rather than one general-purpose agent with unrestricted tool access.
- `compliance_officer_node` appends a regulatory disclaimer to its answers rather than letting a citation-backed answer read as unqualified legal/regulatory advice.
- Every non-LLM fallback response is prefixed `[Offline Mode]` and surfaced to the user as a visible badge (`VirtualCisoChat.tsx`), so a degraded/fallback answer never reads as if it came from the real model.

**Residual risk:** Direct chat-based prompt injection (a user typing an injection attempt into the chat box itself) has no dedicated output-validation layer today - the mitigations above close the *indirect* (document-borne) vector and constrain tool scope, but a sufficiently creative direct prompt could still attempt to manipulate the model's tone or get it to overstate confidence. This is a known-hard, open problem for any LLM-backed feature, not unique to this app.

**Recommendation:** If this ever handles real financial decisions at scale, add a lightweight output classifier/guardrail step (e.g. checking for absolute/unhedged claims before they're returned) rather than relying solely on system-prompt instructions.

## 3. Cross-tenant access

**Vector:** One account reads or writes another account's assets, telemetry, simulations, decisions, or ingested mappings.

**Mitigations in place:** This was a real, previously-shipped P0 bug (item #58 in this project's fix history - "Cross-user data leakage in Own Data Ledger"), now fixed at the query level everywhere:
- Every own-data table carries `data_source` + `owner_email`; every "own" read filters by the caller's identity from their verified JWT (`get_current_user`), never from a client-supplied parameter.
- `generators.ensure_own_data_baseline` scopes its existence check and seed to a specific `owner_email`, so the first account to use "Enter your own data" no longer seeds a fleet every later account also sees as their own.
- `GET /api/account/export` and `DELETE /api/account` are scoped the same way, so even the newest self-service endpoints inherit this isolation rather than needing it re-derived.
- `tests/test_api.py` has explicit isolation tests (`isolation_users` fixture) asserting one account never sees another's rows.

**Residual risk:** The isolation is enforced per-endpoint by convention (every handler must remember to filter), not by a single shared authorization layer (e.g. row-level security at the database) - a future endpoint added without following this pattern could reintroduce the bug.

**Recommendation:** If this ever moves to Postgres in production (it already can - Neon), consider Postgres row-level security policies as a defense-in-depth backstop, so a missed `WHERE owner_email = ...` in application code isn't the only thing standing between accounts.

## 4. Audit tampering

**Vector:** A risk-acceptance decision is altered or deleted after the fact to hide what was actually approved, undermining the ledger's purpose as compliance evidence.

**Mitigations in place:**
- There is no update/edit endpoint for a `RiskDecision` anywhere in `backend/main.py` - only creation (`POST /api/audit`), an explicit opt-in on-chain commit (`POST /api/audit-log/{id}/commit-chain`), and an admin-gated bulk clear (`DELETE /api/audit-log`, demo/dev utility, RBAC-scoped since item #60's fix). A decision cannot be silently modified once logged.
- The on-chain commit (`blockchain_client`, backed by a local Hardhat node) anchors a decision's hash to an immutable ledger as an optional integrity check beyond the database itself.
- `POST /api/audit` requires board-approval evidence fields when `board_approved=True` (item #59's fix) so a decision can't claim governance sign-off it never actually had.
- `RiskDecision` records `model_version`/`control_library_version`/`evidence_hash` so a later dispute over "what did the model actually say" has a concrete, versioned answer.

**Residual risk:** `DELETE /api/audit-log` genuinely deletes rows from the database (by design, for demo/dev resets) - on a real production deployment with real decisions, this endpoint should not exist, or should be restricted far beyond the current admin gate. The on-chain commit is opt-in, not automatic, so an uncommitted decision has no tamper-evidence beyond the database itself.
- The database itself has no audit-of-the-audit-log (no separate append-only log of who deleted/modified rows at the infrastructure level) - a compromised admin credential could still delete rows via `DELETE /api/audit-log`.

**Recommendation:** Before any real production use, gate `DELETE /api/audit-log` behind an environment check (refuse outright when `ENVIRONMENT=production` - see `docs/STAGING.md`) rather than relying on RBAC alone, since a demo-reset utility has no legitimate reason to exist against real compliance data.

## 5. Blockchain failures

**Vector:** The local Hardhat node is unreachable, the transaction reverts, or the node itself is compromised/malicious.

**Mitigations in place:**
- `blockchain_client.is_available()` is checked before any commit attempt and surfaced via `GET /api/status`'s `blockchain` field (and the workspace-status popover in the frontend) rather than failing silently.
- A risk decision persists to the database regardless of blockchain availability - the on-chain commit is a separate, later, opt-in step (`POST /api/audit-log/{id}/commit-chain`), so a blockchain outage never blocks the core "log this decision" action.
- The hosted demo deployment runs with no live blockchain node at all (see README's Deployment section) and degrades gracefully - decisions simply have no `tx_hash`.

**Residual risk:** The on-chain commit's transaction failure handling (a reverted tx, an out-of-gas error, a malicious/forked node) hasn't been specifically fuzz/fault-tested - `blockchain_client.py`'s exception handling is broad (`except Exception`) rather than distinguishing failure modes.

**Recommendation:** If a hosted blockchain node is ever added, add specific handling (and user-facing messaging) for a reverted transaction vs. an unreachable node vs. an out-of-gas error, since "blockchain unavailable" today covers all three identically.

## 6. Exposed credentials

**Vector:** Real or demo credentials, API keys, or signing secrets leak via the client bundle, source control, or logs.

**Mitigations in place:** Also a previously-shipped P0 (item #60 - "Public demo credentials exposed"):
- `POST /api/auth/demo-login` takes only a role name - no password crosses the wire or lives in the client JS bundle, closing the original leak (the real demo password used to be hardcoded in `AuthContext.tsx` and printed on the public Support page).
- `DEMO_ACCOUNTS_ENABLED` (env var, `backend/security.py`) lets a real deployment disable demo accounts entirely.
- `backend/.env` and `ai-agent/.env` are gitignored; only `.env.example` templates with placeholder values are committed.
- `SECRET_KEY` gets a startup warning if it's still the public default (`dev-only-change-me`) rather than silently signing tokens with a well-known key, and Render's Blueprint (`render.yaml`) auto-generates a real one for both production and staging.
- Passwords for real accounts are bcrypt-hashed (`backend/security.py::hash_password`), never stored or logged in plaintext.
- The new `secret-scan` CI job (gitleaks) now scans every push/PR for accidentally-committed secrets going forward.

**Residual risk:** A rotated/leaked key still needs manual rotation in Render's dashboard - there's no automated key-rotation policy. The `.git` history predates several of these fixes, so if the original hardcoded demo password was ever pushed, it remains in history unless the repo's history was rewritten (out of scope for an application-code fix).

**Recommendation:** If the repository's history is a concern, use `git filter-repo` (or GitHub's secret-scanning + push protection, which also catches new commits) to scrub any historically-committed secret - a code fix alone doesn't remove it from history.

## 7. Malicious telemetry

**Vector:** A visitor submits crafted `TelemetryLog`/`Asset` data (via `POST /api/upload-telemetry` or manual entry) designed to manipulate simulation output, or telemetry containing content that could reach the AI agent unsanitized.

**Mitigations in place:**
- `RiskSimRequest.budget` and other numeric FAIR inputs are bounded (`Field(ge=0, le=...)`, part of this project's API-security hardening pass) rather than accepting unbounded values that could produce nonsensical or overflow-prone simulation output.
- `ai-agent/tools.py::query_telemetry` reads from a deliberate field allowlist (documented via a tripwire comment) that excludes `ip_address`/`owner_email` - so even if a visitor crafts unusual telemetry values, sensitive fields never reach the LLM through this tool regardless of what's in the row.
- Own-data telemetry is isolated per-account (see #3), so malicious telemetry submitted by one account can only ever skew that account's own simulations, never another account's or the shared demo fleet's.

**Residual risk:** There's no anomaly detection on submitted telemetry values themselves (e.g. a `vulnerability_score` of exactly the max allowed on every asset, submitted to always trigger the worst-case simulation branch) - the bounds prevent crashes/overflow, not implausible-but-valid data designed to game a specific output.

**Recommendation:** Low priority given telemetry is account-scoped and can only affect the submitting account's own view - revisit if this ever supports a workflow where one account's telemetry can influence another's (e.g. a shared benchmark).

## 8. Unauthorized approvals

**Vector:** A risk decision is marked `board_approved` (or otherwise treated as governance-approved) without a real approval having happened, or an account approves a decision it shouldn't have authority over.

**Mitigations in place:**
- `POST /api/audit` requires explicit evidence fields (approver identity, evidence reference - item #59's fix) whenever `board_approved=True`; a bare `true` with no evidence is rejected. `tests/test_api.py::test_audit_board_approved_requires_evidence` covers this as a regression test.
- The acting user for every audit/approval action is read from the verified JWT (`get_current_user`), never from the request body, so a caller can't submit an approval "as" a different identity.
- Every RBAC-sensitive admin action (`require_admin`) is scoped to `ADMIN_USERS` (`DEMO_USERS.keys()` plus any explicitly added admin accounts), not just "any authenticated user."

**Residual risk:** There is no dual-control/second-approver requirement - a single authenticated account with board-approval evidence fields filled in can self-approve. For a real financial-risk-acceptance workflow, that's a meaningful governance gap; for the demo/hackathon scope this was built for, single-approver logging (with evidence captured) was the deliberate scope.

**Recommendation:** Before any real production use for actual risk governance, add a second-approver/maker-checker step - a decision can be *logged* by one account but requires a second, different account's sign-off before it counts as `board_approved`.

## How to use this document

This is a living risk register, not a one-time audit - update an entry's "Residual risk"/"Recommendation" fields whenever a related fix lands (the pattern this whole project's fix history already follows: cite the actual code, not an aspirational control). Treat a new feature touching any of these eight categories as a prompt to revisit the relevant section before shipping.
