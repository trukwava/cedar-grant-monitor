# Security and privacy boundary

**Not production-ready. Do not deploy to the internet.** This repository contains only synthetic records, and the HTTP server binds to `127.0.0.1` (or localhost). Cedar is the only automatically seeded organization. Named local sessions may access separately provisioned organizations, subject to server-derived organization and role checks. HTTP and service-level organization checks are complemented by SQLite ownership triggers. They still are not a substitute for production authentication and tenant isolation.

## Optional local access gate

To enable password protection, set `CEDAR_ADMIN_PASSWORD` (12–256 characters) in the server environment before starting. Optionally set separate `CEDAR_REVIEWER_PASSWORD` and `CEDAR_VIEWER_PASSWORD`. Leaving them unset runs the **open synthetic demo**. The server refuses reviewer/viewer credentials if no administrator password exists.

| Role | View portfolio, underlying synthetic records, reports | Stage CSV / alerts / create draft | Commit imports / modify grant rules / reset |
|---|---|---|---|
| Viewer | Yes | No | No |
| Reviewer | Yes | Yes | No |
| Administrator | Yes | Yes | Yes |

In shared-role mode, passwords are held in server environment variables and checked using fixed-length SHA-256 digests and timing-safe equality. In named-account mode, each account has a generated salt and scrypt-derived key; the JSON environment configuration is not persisted by the app. An in-memory rate limit rejects more than six failed login attempts per loopback address within 15 minutes. A successful login creates an eight-hour in-memory session identified by a random 256-bit HttpOnly SameSite=Strict cookie. A separate unpredictable CSRF token must accompany state-changing requests; host, Origin, and Sec-Fetch-Site checks reject unauthorized cross-site requests. Logging out invalidates the server-side session. A server restart removes every session; sessions are not persistent. Browser JavaScript only receives the CSRF token, never the password hash or session cookie contents.

These controls are for local demo defense in depth only: no TLS, no SSO, no MFA, no persistent failed-attempt protection, no credential recovery or rotation workflow, no true production multi-tenant identity claims, and no external exposure. Named accounts add per-user audit attribution, but they are configured manually through local environment secrets and are not externally verified identities. Session cookies are intentionally not marked Secure because the interface is HTTP loopback; production HTTPS would require Secure cookies and a different deployment architecture. Staging roles do not imply production access approval. All browser-side hiding of controls is cosmetic; HTTP permission checks are authoritative.

The database now rejects cross-organization references for imported batches and records, snapshots and totals, report drafts, alerts and assignments, and obligation/metric relationships. Migration checks existing rows before installing the guards; an inconsistent legacy database fails startup rather than silently mixing tenants. These safeguards apply to both INSERT and ownership-changing UPDATE operations, including writes that bypass the HTTP service. Named account sessions are bound to a configured, already-existing organization. This is a local, manually provisioned proof of organization scoping, not a customer-ready tenant lifecycle or authorization review.

Never commit `.env`, SQLite files under `data/`, real CSV exports, CRM tokens, participant names/addresses, or confidential grant agreements. Source CSV text is untrusted, imports are size-bounded, browser output escapes record text, and frozen snapshots retain provenance. Funder reports remain drafts for human approval. No active production CRM or identity connector exists.

Before a real pilot: independent threat-model and access-control audit; proper identity provider and unique users; authenticated, server-derived tenant authorization; audit attribution; HTTPS and secret management; structured request schemas; robust CSV/file safety limits; session revocation; data minimization and retention/deletion; backup protection; real identity- and tenant-scoped HTTP tests; customer permission for private data. No claim of HIPAA, SOC 2, GDPR or other compliance certification is made.

## v0.5 organization and history safeguards

All authenticated API calls run within a request-local identity context. The session, not a query string or request body, selects the organization; writes use the authenticated username for audit actor attribution. Fixture downloads and the demo reset are restricted to the seeded Cedar organization. The SQLite layer prohibits changes to historical metric-definition fields, obligation-version terms, and grant period windows, and rejects changes to parent organization ownership. These constraints prevent accidental retroactive mutation, but they do not protect against direct database administrator tampering, full-file replacement or a malicious host operator.

CSV replay checks include content hash, source export date and expected row count; identical CSV bytes cannot be silently relabeled as a newer, more complete export. Completeness is still operator-supplied, not verified against a connected CRM authority.

## v0.6 provider boundary

The fixture endpoint is a deterministic local read-only source: it cannot fetch private records or transmit data to an external CRM. It is available only to Cedar's demo organization and reviewer/admin role. `DisconnectedCRMAdapter` throws an explicit unavailable error. Report exports label simulated-source provenance. The `crm_readonly` dataset type must **not** be interpreted as evidence of an active provider connection. A real connector requires separate authorization and security review; no credentials should be added to this repository.

## v0.7 verification and ingestion

Report draft creation checks snapshot/source consistency before storing a new frozen report. Independent recomputation can catch alterations to counted records, raw rows, normalized copies, definition pins, or stored totals. Audits, reports and snapshots reject in-place field updates in ordinary SQLite writes. This is not a cryptographic audit log, database encryption, or protection against a malicious host administrator.

Malformed CSV quotes are rejected explicitly; request bodies exceeding 2.1MB receive HTTP 413. Production deployment would still require separate load testing, streaming ingestion, secure upload storage, DoS mitigations and a reviewed retention/deletion policy.

## Historical comparison boundary

The comparison route is read-only and requires the same server-selected organization for **both** snapshot IDs. It independently verifies their stored source batches and pinned definitions before emitting counted record IDs. Neither query parameters nor response data can select another tenant. The result is evidence for human reconciliation, not a compliance attestation or proof that CRM exports were complete.
