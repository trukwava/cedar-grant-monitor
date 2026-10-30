# Security and privacy boundary

**Not production-ready. Do not deploy to the internet.** This repository contains only synthetic records, and the HTTP server binds to `127.0.0.1` (or localhost). There is one fixed demo organization. HTTP and service-level organization checks are complemented by SQLite ownership triggers. They still are not a substitute for production authentication and tenant isolation.

## Optional local access gate

To enable password protection, set `CEDAR_ADMIN_PASSWORD` (12–256 characters) in the server environment before starting. Optionally set separate `CEDAR_REVIEWER_PASSWORD` and `CEDAR_VIEWER_PASSWORD`. Leaving them unset runs the **open synthetic demo**. The server refuses reviewer/viewer credentials if no administrator password exists.

| Role | View portfolio, underlying synthetic records, reports | Stage CSV / alerts / create draft | Commit imports / modify grant rules / reset |
|---|---|---|---|
| Viewer | Yes | No | No |
| Reviewer | Yes | Yes | No |
| Administrator | Yes | Yes | Yes |

Passwords are held only in server environment variables and compared as fixed-length SHA-256 digests with timing-safe equality. An in-memory rate limit rejects more than six failed login attempts per loopback address within 15 minutes. A successful login creates an eight-hour in-memory session identified by a random 256-bit HttpOnly SameSite=Strict cookie. A separate unpredictable CSRF token must accompany state-changing requests; host, Origin, and Sec-Fetch-Site checks reject unauthorized cross-site requests. Logging out invalidates the server-side session. A server restart removes every session; sessions are not persistent. Browser JavaScript only receives the CSRF token, never the password hash or session cookie contents.

These controls are for local demo defense in depth only: no TLS, no SSO, no unique human users, no MFA, no persistent failed-attempt protection, no per-user audit attribution, no credential recovery or rotation workflow, no true multi-tenant identity claims, and no external exposure. Session cookies are intentionally not marked Secure because the interface is HTTP loopback; production HTTPS would require Secure cookies and a different deployment architecture. Staging roles do not imply production access approval. All browser-side hiding of controls is cosmetic; HTTP permission checks are authoritative.

The database now rejects cross-organization references for imported batches and records, snapshots and totals, report drafts, alerts and assignments, and obligation/metric relationships. Migration checks existing rows before installing the guards; an inconsistent legacy database fails startup rather than silently mixing tenants. These safeguards apply to both INSERT and ownership-changing UPDATE operations, including writes that bypass the HTTP service. Only the Cedar demo organization is exposed by this server; identities and a real tenant-aware API remain intentionally unimplemented.

Never commit `.env`, SQLite files under `data/`, real CSV exports, CRM tokens, participant names/addresses, or confidential grant agreements. Source CSV text is untrusted, imports are size-bounded, browser output escapes record text, and frozen snapshots retain provenance. Funder reports remain drafts for human approval. No active production CRM or identity connector exists.

Before a real pilot: independent threat-model and access-control audit; proper identity provider and unique users; authenticated, server-derived tenant authorization; audit attribution; HTTPS and secret management; structured request schemas; robust CSV/file safety limits; session revocation; data minimization and retention/deletion; backup protection; real identity- and tenant-scoped HTTP tests; customer permission for private data. No claim of HIPAA, SOC 2, GDPR or other compliance certification is made.
