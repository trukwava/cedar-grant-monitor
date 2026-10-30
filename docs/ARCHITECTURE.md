# Architecture, state and invariants

## Decision

Single-process TypeScript Node.js 22 application, SQLite as durable relational storage, static browser client. This keeps the default synthetic demo credential-free and avoids paid hosted infrastructure. Optional local password sessions with three role levels are supported, but loopback-only binding remains mandatory and this is not production authorization.

## Data and relationships

`organizations` → `users`, `grants`, `source_datasets`, `record_mappings`, `import_batches`, `calculation_snapshots`, `alerts`, `report_drafts`, `audit_events`.

`grants` → `grant_periods` → `obligation_versions` → `metric_definition_versions`; `import_batches` → `program_records`; `calculation_snapshots` → `snapshot_totals` and `alerts`; `report_drafts` pin `calculation_snapshots`. See SQL statements in `src/db.ts` for actual table definitions and constraints. Cross-organization references are prohibited by `scope_*` SQLite triggers (on insert and ownership-changing updates) for imported records, source datasets, snapshots, obligations, metrics, alerts, assignments, and reports. Startup validates existing relationships and foreign keys before accepting new writes. The HTTP server still deliberately supports only one fixed synthetic organization.

### Lifecycle

- **Import:** `staged → committed` with explicit acceptance of quarantined rows. A staged partial export cannot become the active published snapshot. Re-imports with the same CSV source hash are idempotent. Raw CSV and row values are immutable after insert.
- **Metric config:** `draft → previewed → enabled`. Preview is audited and required for promotion. Amendments are append-only versions with effective dates, while prior snapshots reference their own versions.
- **Snapshot:** each published result records batch, source SHA256, as-of date and version identities. Reports store a frozen JSON payload. New imports do not rewrite old reports.
- **Alert:** `open → acknowledged / assigned / snoozed`; conditions are re-evaluated when new published snapshots arrive, with state and owner history. Resolving a currently active trigger is rejected.
- **Report:** exported as a **draft** for external human approval. No automatic submission endpoint exists.

## Counting and exclusions

Only `verified` records with matching program, event type and period are eligible. Person-based metrics deduplicate by participant identifier; attendance counts verified event instances. Across grants, the same individual may legitimately satisfy distinct obligations, because those grants' targets are independent; this does **not** imply one individual's records may be counted twice within a single distinct-person obligation. Source errors are quarantined, not inferred or corrected silently.

Alert calculations are deterministic rules. Linear pacing is simply `(elapsed inclusive days / inclusive period days) × target`; it is labeled an assumption and is not a probabilistic prediction.

## Threat model and production blockers

- Treat CSV, text fields, rendered error messages and any future AI output as untrusted data.
- The server processes bounded-size JSON/CSV and the UI escapes record text.
- The demo has a fixed organization. If role passwords are configured, the server checks HTTP session and CSRF tokens and role privileges; if not, the local synthetic demo remains open. No individual identity or production multi-tenancy exists. Loopback binding remains mandatory.
- Must add genuine individual identities, server-derived organization claims, robust tenant-scoped HTTP authorization, structured request schemas, migration versioning, durable rate limiting, secure logging and production secrets infrastructure before real data use.
- Provider-specific CRM credentials and adapters must be server-only, read-only, and clearly marked connected or disconnected.

## P0 versus parking lot

**P0 demonstrated:** import staging, provenance, frozen metric counts, portfolio, evidence refs, alerts, amendments, draft exports, synthetic scenario, automated tests. **Parking lot:** SSO, production CRM adapters, live reconciliation, email alerts, task workflow integrations, richer reporting formats, AI-assisted narrative drafting, predictive modeling, funder portal submission, participant intake, billing. Do not treat any parked item as already implemented.
