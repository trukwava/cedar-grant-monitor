# Cedar Pathways | Grant Deliverables Monitor

**Evidence-backed grant progress and transparent early warnings from existing program exports.**

> **Synthetic local demo.** Cedar Pathways is a fictional workforce nonprofit. Every program record, participant identifier, funder name, deadline, and grant obligation in this repository is invented. This is a working proof of concept, **not** a connected CRM, funder submission system, or production-ready multi-tenant application.

![Node 22+](https://img.shields.io/badge/Node-22.16%2B-2563eb) ![Synthetic demo](https://img.shields.io/badge/data-synthetic-0f766e) ![Status](https://img.shields.io/badge/status-local%20prototype-64748b)

## Run in under a minute

Requirements: **Node.js 22.16+** (includes the experimental built-in SQLite and TypeScript-strip capabilities used by this no-paid-services demo). No API keys and no `npm install` required to run or test the app.

```bash
npm run seed          # create/reset-independent initial demo data and fixtures
npm start             # open http://127.0.0.1:4173
```

In another terminal:

```bash
npm test              # all domain and persistence regression tests
```

The application creates a SQLite database at `data/cedar.sqlite` and preserves it across restarts. To reset only the synthetic Cedar Pathways organization, use the **Configuration → Reset synthetic demo** control; it requires typing `RESET DEMO`. Never expose the local server to the public internet or import personal data.

## Product promise and primary workflow

A nonprofit **grants lead** wants to know whether each funder obligation is genuinely on track, what is counted, which evidence is missing, and what needs review—without a second case-management system.

The smallest complete workflow is:

**CSV export or simulated read-only CRM fixture → staged quality checks → explicit approval of quarantined rows → immutable import → version-pinned calculation → portfolio and evidence review → explainable alert → draft report export.**

The interface contains six screens: **Portfolio, Obligations, Data imports, Alerts, Report drafts, and Configuration.**

## Local sign-in, named accounts, and role permissions

By default, the synthetic demo runs on loopback without credentials. To protect the demo with a shared administrator role, set `CEDAR_ADMIN_PASSWORD` (12–256 characters) and optionally `CEDAR_REVIEWER_PASSWORD` and `CEDAR_VIEWER_PASSWORD`. Role passwords are shared demo identities, not named individuals.

For **separate named local accounts**, instead set `CEDAR_USERS_JSON` to an array of objects with `username`, `orgId`, `role`, and `password`. These accounts are bound to an existing organization **on the server**; never supply an organization ID through a browser request to select another tenant. For example, use fictional local secrets in a private environment file (not in source control):

```json
[
  {"username":"demo-lead","orgId":"cedar-demo","role":"admin","password":"replace-with-strong-secret"},
  {"username":"demo-auditor","orgId":"cedar-demo","role":"viewer","password":"replace-with-different-secret"}
]
```

The optional modes are mutually exclusive. Named credentials are salted and checked using scrypt; sessions expire after eight hours and are invalidated by restart. Every API read uses the session's organization, and edits are attributed to the named user in the audit history. A separate organization must be explicitly provisioned in the local SQLite database; the demo reset affects Cedar only. These features are **not** production identity management: there is no SSO, MFA, TLS, persistent sessions or account-management UI. See [security](docs/SECURITY.md) and [operator guide](docs/OPERATIONS.md).

## What works in this version

| Capability | Implementation |
| --- | --- |
| Demo portfolio | Six synthetic grants, 12 active autumn obligations, three dated windows per grant and a completed spring replay |
| Source data | 120-row primary CSV, 35-row partial export, late-arrival 121-row export, and completed-period fixture; separately identified read-only **simulated** CRM fixture |
| Import quality | Exact field mapping; invalid IDs/dates, duplicate source identifiers, unrecognized program codes, incomplete exports, and quarantined rows. Both CSV and simulated CRM use the same staging rules |
| Counting rules | Distinct-person and event-based metrics with inclusion/exclusion examples; only verified records count |
| Immutable history | Source bytes, individual records, versioned metrics/targets, calculation snapshots, report contents and audit event fields are guarded against in-place edits |
| Performance signals | Date-only reporting deadlines, missing evidence, stale exports, and linear pacing **heuristics** with explanations |
| Operations | Acknowledge, assign, snooze with reason, resolve under documented conditions; audit events |
| Reporting | JSON and CSV **draft** exports with as-of date, source hash, versions, counts, exceptions, and evidence references; verified pinned snapshot required before creating a new draft |
| Rule review | Preview before enabling a new draft definition; effective-dated target amendments |
| Demo recovery | Repeatable fixtures and scoped reset |
| Optional local access control | Role-password or named-account sign-in; server-derived organization and actor, viewer/reviewer/admin HTTP permissions, CSRF and origin checks |
| Cross-organization integrity | SQLite guards reject cross-organization references, parent ownership transfers and in-place changes to versioned definitions; migration preflight detects legacy violations |

**Exact checks:** 25 qualifying placement records include two already-counted people, so the result is **23 distinct people**. A target of 40 at day 45 of a 90-day window produces a **linear pacing baseline of 20**—a stated assumption, not proof of program failure.

### Current limitations

This is **local-only**. Optional password sessions and role checks now exist at the HTTP boundary, including optional named-account credentials and tenant-scoped HTTP routing, but they do not constitute production-ready identity or multi-tenant security. With no password configured, the demo is intentionally unauthenticated. The server binds to `127.0.0.1` by default; Cedar is the only automatically provisioned organization. The application must not be publicly hosted, connected to production exports or used to submit reports without a full authentication and security review. It has no live CRM adapter, live source validation, predictive accuracy claims, or external approval workflow. There is no AI inference in the count path.

The CSV completeness flag depends on the supplied expected row count; a misleading source export can still look complete. For a pilot, reconcile against authoritative CRM export totals and a reviewed metric dictionary. See [architecture](docs/ARCHITECTURE.md), [operator guide](docs/OPERATIONS.md), [security boundary](docs/SECURITY.md), and [pilot plan](docs/PILOT.md).

## Historical snapshot verification (v0.7)

The **Verify snapshot** action in the portfolio calls `GET /api/snapshots/:id/verify`. It recalculates counts using the exact historical obligation and metric versions referenced by that snapshot, even if newer amendments or retired rules exist. The verifier also checks the original CSV SHA-256, the source row count, every preserved raw and normalized record, the pinned metric versions, the included/excluded evidence references, and the frozen totals. The endpoint is read-only and organization-scoped.

If any verification fails, the application refuses to create a new report draft from that snapshot. Existing reports remain frozen. SQLite now blocks in-place changes to stored snapshot results, frozen report contents, and audit event fields. These checks detect accidental corruption, but **are not tamper-proof against a database administrator who can replace the database and all associated evidence**; independent external signatures and secure audit retention are beyond this demo.

Malformed CSV quoting returns a clear validation error rather than silently moving fields, and oversized HTTP JSON requests return HTTP 413 without terminating the server. See [verification](docs/VERIFICATION.md).

## Simulated read-only CRM boundary (v0.6)

The **Data imports** screen now offers three clearly labeled synthetic read-only CRM fixtures: complete export (120 rows), partial export (35/120; cannot publish), and late-arriving outcome export (121 rows). They exercise the same server-side CSV validation and immutable staging pipeline used by manual uploads, but use their own `crm_readonly` source dataset. The provider interface in `src/adapters.ts` includes a deliberately unconfigured production adapter, which returns an explicit error instead of pretending a connection exists.

`GET /api/adapters/status` reports `disconnected`; `POST /api/adapters/fixture/stage` stages only deterministic synthetic records and requires reviewer-level access. It cannot contact a CRM, write to one, or accept arbitrary provider URLs or credentials. Every report draft identifies the source, adapter and connection state in both JSON and CSV. **No external service is connected or tested.**

## Sample CSV contract

The required header order is:

```csv
external_id,participant_id,program_code,event_type,event_date,status,evidence_ref
```

Values use synthetic IDs. `event_type`: `placement`, `attendance`, `enrollment`, `completion`, `coaching`; `status`: `verified`, `pending`, `void`. Program codes must be in the reviewed mapping; otherwise rows go to quarantine rather than being guessed. Evidence references are opaque IDs, not uploaded documents or links to private participant data.

| Fixture | Purpose |
| --- | --- |
| `fixtures/program_export_120.csv` | Complete 120-record synthetic source; includes duplicate and unmapped exceptions |
| `fixtures/partial_export_35_of_120.csv` | Incomplete export; set expected count to 120 to reject publication |
| `fixtures/late_arrival_full_export_121.csv` | New late-arriving outcome; creates a new snapshot, never mutates an old one |
| `fixtures/spring_completed_period_40.csv` | Reproducible completed-period draft |

## Architecture

- **Server:** small Node.js 22 HTTP application, TypeScript source executed with `--experimental-strip-types`.
- **Persistence:** built-in `node:sqlite` with relational constraints, immutable-source and organization-integrity triggers, foreign keys, audit trail and source checksums.
- **UI:** static HTML/CSS/JavaScript; no build chain, CDN, cookies, analytics or external services.
- **Domain:** pure counting/validation helpers in `src/domain.ts`, transactional operations in `src/service.ts`, schema in `src/db.ts`, fixtures and initialization in `src/fixtures.ts` and `src/seed.ts`.
- **Testing:** Node's built-in test runner, `tests/*.test.ts`; `npm run check` additionally requires a separately installed TypeScript compiler and Node type definitions, and is not required to run the demo.

There is no generative-AI-driven rules engine: metric definitions, source mapping and amendments remain explicit reviewed configuration.

## Acceptance and testing

```bash
npm test
```

Tests include the pinned historical snapshot verification, raw-versus-normalized source reconciliation, immutable totals/reports/audit fields, strict CSV quoting, HTTP 413 error recovery and the local sign-in boundary (unauthenticated GETs, role authorization, CSRF and origin rejection, logout), the exact 25→23 rule, event-vs-person deduplication, pacing baseline, CSV quoting, seed shape, idempotent imports, explicit quarantine acceptance, partial-import protection, late records, independent recomputation, amendments, stateful alerts, staleness, completed-period replay, organization-scoped service access, database-enforced cross-organization reference rejection, legacy-data preflight, data immutability, and scoped reset.

CI runs these tests on Node 22; a green CI run is **not** a security or regulatory certification. Browser automation was blocked by the execution environment and is still pending; see [verification log](docs/VERIFICATION.md).

## Repository

Source: https://github.com/trukwava/cedar-grant-monitor

Public code is not a public service. The demo is loopback-only, uses synthetic data, and supports optional local password protection; neither mode is production authentication. Never deploy it to the internet or import private records.

## Offline export integrity manifests

For each draft report, `GET /api/reports/{id}/manifest` returns SHA-256 checksums and UTF-8 byte lengths for the exact `export` JSON and `export.csv` downloads. A reviewer can compare downloaded bytes to the manifest to detect accidental modification or mismatched exports. This is **not** a digital signature, does not authenticate the server, and is not proof that upstream source data is correct.

## Historical snapshot change review (v0.9)

Open **Reports → Snapshot change review** to compare an earlier frozen snapshot with the latest one. Both source snapshots are independently verified before comparison; a failed verification blocks comparison. The server also offers `GET /api/snapshots/{oldId}/compare/{newId}`. The response includes as-of dates, source hashes and dataset identities, per-obligation achieved/target/evidence differences, and counted-record identifiers added or removed. Numerical deltas are displayed **only when the same reporting window and exact metric-definition version are shared**. Target amendments are labeled separately; new/retired obligations and definition changes are explicitly non-comparable. An added record ID is not a claim that a new person was served. Snapshots and reports remain unchanged.

CSV/JSON report downloads have a separate SHA-256 manifest download in the Reports interface. This verifies byte equality only; it is not a signature.

## Import publication and recovery (v0.10)

After staging an export, the **Publish this import** review panel shows a **Snapshot as-of date** prefilled with the immutable source export date. The date must not precede the source export and must fall inside an active reporting period to calculate obligations. It is never silently replaced by the computer's current date.

If publication is rejected (incomplete export, unaccepted quarantine, invalid date, or missing active obligations), the staged source and issue list stay visible. The rejection appears beside the publish control, and operators can correct their choice and retry. The server retains the previous published snapshot until a complete, accepted import commits successfully.

`tests/workflow.test.ts` exercises the full HTTP pathway: staging and rejecting a 35/120-row export; staging the 121-row late-arrival export; inspecting the metric preview; requiring quarantine approval; publishing a reproducible snapshot; idempotent retry; independent snapshot verification; immutable previous report; and byte-level JSON/CSV manifest reconciliation. A second test checks that the browser publish action uses the selected snapshot date and has an accessible error region. These are HTTP and source tests, not complete automated browser accessibility tests.
