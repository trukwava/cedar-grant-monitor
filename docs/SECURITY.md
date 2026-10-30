# Security and privacy boundary

**Not production-ready. Do not deploy to the internet.** This repository deliberately contains only fictional identifiers and synthetic records, and the HTTP server listens on `127.0.0.1` by default. It has no real authentication and uses a fixed demo organization. Service-level tenant checks tested in this repository do not turn the demo into a secure multi-tenant service.

Never commit `.env`, a SQLite file under `data/`, real CSV exports, CRM tokens, participant names or addresses, or confidential grant agreements. The supplied fixture files are deterministic and synthetic. Report drafts are for human review, not automated approval or submission.

Before a real pilot: perform a threat-model review; add identity/session handling and server-side role-based organization authorization; persist minimum necessary identifiers; add secure source retention and deletion policies; review backups and audit access; implement robust input and file parsing limits; and get customer approval for any data import. Test cross-tenant access at the HTTP layer with real identity claims.

No claim of HIPAA, SOC 2, GDPR or other compliance certification is made. No secret or production CRM integration is required in demo mode.
