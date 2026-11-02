# Local demo operator guide

1. Install Node.js **22.16+**. From the project directory, run `npm start`. Visit `http://127.0.0.1:4173`. The app seeds the demo on first start and keeps SQLite at `data/cedar.sqlite`.
2. Review **Portfolio** to see grant targets, achievement, input quality and due dates. All current data is synthetic.
3. Review an **Obligation** and its exact eligible record IDs, exclusions and missing evidence references. Preview a metric again from its persisted source to confirm the same count.
4. In **Data imports**, choose `fixtures/partial_export_35_of_120.csv`, set the source date to `2026-10-29` and expected rows to `120`, then validate. The batch remains staged and cannot replace the full snapshot.
5. Instead choose `fixtures/late_arrival_full_export_121.csv`, source date `2026-10-29`, expected rows `121`. Review any quarantined rows before accepting and committing. A new immutable snapshot is created; the earlier one stays unchanged.
6. In **Alerts**, acknowledge, assign or snooze with a reason. An active trigger cannot be arbitrarily marked resolved.
7. In **Report drafts**, generate/export a JSON document pinned to a selected snapshot. The export says DRAFT and includes its source hash and metric versions. Do not send it to a funder as an approved report.
8. In **Configuration**, review target amendments and reviewed mappings. If desired, reset synthetic data by entering `RESET DEMO` in the confirmation dialog.

### API examples

```bash
curl -s http://127.0.0.1:4173/api/bootstrap | head -c 300
# Example: create draft from an existing snapshot ID, retrieved from /api/bootstrap:
curl -s -X POST http://127.0.0.1:4173/api/reports \
  -H 'Content-Type: application/json' -d '{"snapshotId":"REPLACE_WITH_ID"}'
```

The curl examples above apply to the default open synthetic demo. In protected mode, use the browser sign-in page (session cookie + CSRF header are required for writes). Viewer access is read-only; reviewers can stage CSVs, manage alerts and draft reports; administrators can commit imports, amend rules and reset data. To enable local password protection, set `CEDAR_ADMIN_PASSWORD` and optionally separate `CEDAR_REVIEWER_PASSWORD`/`CEDAR_VIEWER_PASSWORD` before running `npm start`. These are shared demo roles, not production user accounts. Alternatively configure `CEDAR_USERS_JSON` (example in `.env.example`) for named local accounts bound to existing organizations. Named logins attribute new audit events to the signed-in user; organization selection is server-derived, not client-controlled. Shared-role and named-account modes cannot be combined. Do not open a public port. Running from the repository root is required for relative fixture and database paths.

### Troubleshooting

- `node:sqlite` or strip-types unavailable: install Node.js 22.16 or later.
- Port 4173 in use: set `PORT=4174 npm start`.
- Need a clean local run: stop the server and use `npm run seed -- --reset` (demo organization only), or use the UI's scoped reset. Do not delete an unknown SQLite database.
- No source records counted: check `status=verified`, program mappings, event type, event date, and reporting period.
- Import cannot publish: confirm expected row count and explicit quarantine review; invalid/partial rows are intentional in test files.

### Source provenance and metric immutability

Re-importing identical source bytes with the same `sourceAsOf` and `expectedRows` returns the original batch. Re-importing identical bytes while changing either metadata field returns HTTP 409; use a genuine new export rather than marking unchanged records as freshly reconciled. Existing metric-definition content, target versions, and reporting-window dates cannot be changed in place at the database layer; create a new reviewed version/amendment. The source export completeness claim still depends on an operator's stated expected count and is not proof from a live CRM.

### Simulated CRM export demonstration

Open **Data imports** and use **Stage full fixture** (120 rows), **Stage partial fixture** (35 of 120) or **Stage late outcome** (121 rows). The simulated source is separate from the CSV upload source. Review the staged result and confirm that the partial fixture cannot be published and the full fixture requires acceptance of quarantined rows. Draft reports from committed fixture batches say `SIMULATED - NOT CONNECTED` in both CSV and JSON. `GET /api/adapters/status` reports the production CRM as disconnected. No network request or actual CRM integration is performed.

### Verify a historical snapshot (v0.7)

On **Portfolio**, select **Verify snapshot**. This fetches a read-only recomputation using the source batch, original field mapping, persisted record values and pinned definition versions recorded in that snapshot. The API equivalent is:

```bash
curl -s http://127.0.0.1:4173/api/snapshots/SNAPSHOT_ID/verify
```

In protected mode, a signed-in viewer may inspect verification results. The response separates source SHA-256, raw CSV-row reconciliation, normalized-record reconciliation, definition completeness and each obligation result. A failed check blocks generating a **new** reporting draft but does not rewrite an existing draft. If an import fails with `Malformed CSV quoting`, repair the original CSV and stage it as a new file; do not repair the immutable stored batch. Oversized request bodies return HTTP 413; reduce the file or split exports under the documented limits.

## Comparing historical reporting snapshots

Open **Reports → Snapshot change review**, choose a historical snapshot, then compare it to the latest. The server verifies both original sources and each pinned metric definition. Source or definition corruption produces an explicit error instead of a misleading change report. A matching obligation name is not enough: the metric-definition **version** and reporting-period **ID** must match before an achievement delta appears. A target change is separately labeled an amendment.

For API-based review, retrieve `GET /api/bootstrap` to find `snapshotHistory`, then `GET /api/snapshots/{olderId}/compare/{newerId}`. The read-only comparison includes source dates, dataset identities and counted record-ID differences. Different as-of dates are not normalized to equal observation periods; treat these as source change explanations, not causal impact claims.

### v0.10: staged import publication

In **Data imports**, inspect the quarantined records first. The publish panel defaults **Snapshot as-of date** to the staged export's original source date, not today's system date. Change this explicitly only to calculate a later valid reporting cutoff with the same source export. After a failed attempt, stay on the same staged import and read the inline error; correct the date or quarantine acknowledgment and retry. An incomplete import cannot publish regardless of date or acknowledgment. Previous published snapshots and report downloads are preserved.
