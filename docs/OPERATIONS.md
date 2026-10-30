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

All write endpoints are demo-only and unauthenticated. Do not open a public port. Running from the repository root is required for relative fixture and database paths.

### Troubleshooting

- `node:sqlite` or strip-types unavailable: install Node.js 22.16 or later.
- Port 4173 in use: set `PORT=4174 npm start`.
- Need a clean local run: stop the server and use `npm run seed -- --reset` (demo organization only), or use the UI's scoped reset. Do not delete an unknown SQLite database.
- No source records counted: check `status=verified`, program mappings, event type, event date, and reporting period.
- Import cannot publish: confirm expected row count and explicit quarantine review; invalid/partial rows are intentional in test files.
