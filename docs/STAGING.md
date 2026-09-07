# Staging Environment

What's set up in code vs. what still needs a one-time manual step in each provider's dashboard, so destructive/seed operations (`POST /api/reset-demo`, `POST /api/generate-mock-data`, `POST /api/admin/purge-stale-data`) can be exercised freely without ever touching real deployment data.

## The six things a staging environment needs to duplicate

| | Production | Staging | Status |
|---|---|---|---|
| **Database** | Its own Neon Postgres project/branch | A separate Neon project/branch | `render.yaml` defines a second service (`crq-platform-backend-staging`) with its own `DATABASE_URL` slot - you create the second Neon project and paste its connection string in once, in Render's dashboard |
| **API keys** | Its own `GROQ_API_KEY`, its own auto-generated `SECRET_KEY` | Its own of both | Same `render.yaml` block - `SECRET_KEY` auto-generates per service already; `GROQ_API_KEY` can be the same key (not a data-isolation concern) or a separate one for cost/usage tracking |
| **Blockchain node** | Sepolia testnet (see README's Deployment section) - `WEB3_PROVIDER_URL`/`CONTRACT_ADDRESS`/`DEPLOYER_PRIVATE_KEY` point at a deployed `AuditLedger.sol`; if unset, `blockchain_client` gracefully reports "unavailable" and decisions still persist to the database without a tx hash | A **separate** Sepolia deployment of `AuditLedger.sol` (redeploy from `blockchain/`, same or a different wallet - only the contract address needs to differ), with its own `WEB3_PROVIDER_URL`/`CONTRACT_ADDRESS`/`DEPLOYER_PRIVATE_KEY` on the `-staging` service - never point staging at production's contract address, or staging's test "Accept Risk" clicks land permanently in production's audit ledger | Done - `render.yaml` scaffolds all three vars (`sync: false`) on both services; deploy once per environment and paste the values in |
| **Demo users** | The two fixed `DEMO_USERS` (`ciso`/`cfo`), backed by production's database | Same fixed identities, backed by staging's own (separate) database | Automatic - `DEMO_USERS` are hardcoded identities, not database rows; having a separate `DATABASE_URL` already gives staging its own demo-account data, entirely separate from production's |
| **Storage** | N/A - this app has no file/blob storage; uploaded configs are parsed in-memory and never persisted as files (see `docs/PRIVACY.md`) | N/A, same reason | N/A - nothing to duplicate |
| **Analytics** | N/A - no analytics/telemetry-collection integration exists in this codebase (see `docs/PRIVACY.md`) | N/A, same reason | N/A - nothing to duplicate |

## What's implemented

- `render.yaml` now defines both `crq-platform-backend` (production) and `crq-platform-backend-staging` as independent Render Blueprint services - deploying the blueprint creates both, each with its own env var slots.
- Both set `ENVIRONMENT` (`production` / `staging`); `GET /api/status` echoes it back (`backend/main.py`'s `ENVIRONMENT` constant, defaulting to `development` for local runs where it's never set), so you can always tell which deployment answered a request instead of trusting the URL in the address bar.
- The two most consequential shared-data operations - `POST /api/reset-demo` and `POST /api/generate-mock-data` - now log which `ENVIRONMENT` they ran in (`admin_actions_logger`), so an accidental production run is traceable after the fact, not just preventable in principle.
- Vercel needs no extra config for this - it already builds a separate preview deployment per branch/PR automatically. Point a staging preview's `NEXT_PUBLIC_API_URL` at the staging Render service's URL.

## One-time manual setup (per provider dashboard, not code)

1. Create a second Neon project (or a branch off the existing one) for staging; paste its connection string into `crq-platform-backend-staging`'s `DATABASE_URL` in Render.
2. Deploy `render.yaml` as a Blueprint (or update an existing Blueprint deployment) so both services exist.
3. Set `ALLOWED_ORIGINS` on the staging service to whatever Vercel preview URL(s) you'll point at it.
4. Point that Vercel preview's `NEXT_PUBLIC_API_URL` at the staging backend's Render URL.

## The actual rule this exists to support

Never run `POST /api/reset-demo`, `POST /api/generate-mock-data`, or `POST /api/admin/purge-stale-data` against the production URL to "just try something out." Test new destructive or seed behavior against the staging URL first - it has its own database, so there's nothing to lose there.
