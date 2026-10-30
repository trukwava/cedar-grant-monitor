# Verification log — v0.3 (2026-10-30)

Local verification on Node.js 22.16.0 using the built-in TypeScript-strip test runner:

- `npm test`: 21/21 passing, including grant/domain, persisted-import, report, and HTTP tests.
- `node --check public/app.js`: passed JavaScript syntax validation.
- Protected-mode HTTP test: no-session reads rejected; viewer reads accepted and writes rejected; reviewer can draft a report but cannot reset; administrator can reset; password errors, cookie issuance, missing/invalid CSRF, malicious Origin and Sec-Fetch-Site, Host spoofing, and logout invalidation checked.
- Default open synthetic mode: unchanged test suite verifies CSV and JSON report reconciliation, import quarantine, source checksum, historical snapshots and cross-organization service isolation.
- Browser-level end-to-end automation **not completed** in this environment: the headless Chromium navigation was blocked with `net::ERR_BLOCKED_BY_ADMINISTRATOR`. This is an execution-environment restriction, not a successful app/browser verification. UI sign-in, focus, keyboard and mobile workflows still require live device/browser validation.
- `npm run check`: compiler executable present but project lacks installed `@types/node` (no-dependency runtime intentionally). The command fails with `TS2688`. Do not treat this as passing type check; adding a reproducible TypeScript dev dependency and lockfile remains future work.

No external CRM, identity provider, real user account, funder submission or production deployment was tested. The optional role gate is a local demo control rather than a production-ready login solution.
