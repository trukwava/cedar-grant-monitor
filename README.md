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
| Immutable history | Source bytes, individual records, versioned metrics/targets and calculation snapshots persist in SQLite |
| Performance signals | Date-only reporting deadlines, missing evidence, stale exports, and linear pacing **heuristics** with explanations |
| Operations | Acknowledge, assign, snooze with reason, resolve under documented conditions; audit events |
| Reporting | JSON and CSV **draft** exports with as-of date, source hash, versions, counts, exceptions, and evidence references; no external submission |
| Rule review | Preview before enabling a new draft definition; effective-dated target amendments |
| Demo recovery | Repeatable fixtures and scoped reset |
| Optional local access control | Role-password or named-account sign-in; server-derived organization and actor, viewer/reviewer/admin HTTP permissions, CSRF and origin checks |
| Cross-organization integrity | SQLite guards reject cross-organization references, parent ownership transfers and in-place changes to versioned definitions; migration preflight detects legacy violations |

**Exact checks:** 25 qualifying placement records include two already-counted people, so the result is **23 distinct people**. A target of 40 at day 45 of a 90-day window produces a **linear pacing baseline of 20**—a stated assumption, not proof of program failure.

### Current limitations

This is **local-only**. Optional password sessions and role checks now exist at the HTTP boundary, including optional named-account credentials and tenant-scoped HTTP routing, but they do not constitute production-ready identity or multi-tenant security. With no password configured, the demo is intentionally unauthenticated. The server binds to `127.0.0.1` by default; Cedar is the only automatically provisioned organization. The application must not be publicly hosted, connected to production exports or used to submit reports without a full authentication and security review. It has no live CRM adapter, live source validation, predictive accuracy claims, or external approval workflow. There is no AI inference in the count path.

The CSV completeness flag depends on the supplied expected row count; a misleading source export can still look complete. For a pilot, reconcile against authoritative CRM export totals and a reviewed metric dictionary. See [architecture](docs/ARCHITECTURE.md), [operator guide](docs/OPERATIONS.md), [security boundary](docs/SECURITY.md), and [pilot plan](docs/PILOT.md).

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

Tests cover the local sign-in boundary (unauthenticated GETs, role authorization, CSRF and origin rejection, logout), the exact 25→23 rule, event-vs-person deduplication, pacing baseline, CSV quoting, seed shape, idempotent imports, explicit quarantine acceptance, partial-import protection, late records, independent recomputation, amendments, stateful alerts, staleness, completed-period replay, organization-scoped service access, database-enforced cross-organization reference rejection, legacy-data preflight, data immutability, and scoped reset.

CI runs these tests on Node 22; a green CI run is **not** a security or regulatory certification. Browser automation was blocked by the execution environment and is still pending; see [verification log](docs/VERIFICATION.md).

## Repository

Source: https://github.com/trukwava/cedar-grant-monitor

Public code is not a public service. The demo is local-only, unauthenticated and uses synthetic data; never deploy it to the internet or import private records.
