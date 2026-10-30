# Verification log — v0.6 (2026-10-30)

- `npm test`: 28/28 local tests passing on Node.js 22.16.0 (confirmed in this session).
- Named-local-account HTTP test: successful named login, server-derived organization, viewer/reviewer/admin boundaries, foreign snapshot/report 404s, demo reset restriction for foreign tenants, sign-out, and audit actor verification.
- New import-provenance test: same CSV/hash with conflicting export date or expected row count is rejected (HTTP 409/domain 409); unchanged metadata remains idempotent.
- New database-history tests: updating metric units, obligation targets, period deadlines, parent organization ownership and demo flags is rejected; draft-status promotion remains possible.
- `node --check public/app.js`: syntax check (run separately during final release validation).
- Protected shared-role mode remains covered by the original HTTP authorization regression suite.
- Full browser-device/accessibility automation was not executed. This release remains a loopback-only synthetic prototype without external authentication, production CRM connections or compliance validation.
- Strict TypeScript checking requires the separate `@types/node` development dependency, which is absent from this offline no-install build; test execution with Node's type stripper is **not** full static type-checking.

## v0.6 verification additions

- The disconnected adapter fails rather than reporting a successful connection; the fixture adapter is explicitly marked simulated and returns fixed full, partial and late-outcome exports.
- All fixture paths stage through the existing immutable validation pipeline. Incomplete 35/120 exports cannot publish; 120-row full exports require explicit quarantine acceptance, and report drafts identify fixture provenance in CSV and JSON.
- Named-account HTTP checks reject cross-organization fixture staging and viewer fixture writes; authorized Cedar demo administrator may stage the fixture.
- Static browser JavaScript syntax was checked with `node --check`; live browser interaction remains unverified.

## Prior baseline

The published v0.4 baseline passed 23 tests; v0.5 passed 26 tests, including relational organization integrity, legacy-data preflight, HTTP host/origin/CSRF protection, and snapshot/report reconciliation.
