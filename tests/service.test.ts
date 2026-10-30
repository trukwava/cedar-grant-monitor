import test from 'node:test';
import assert from 'node:assert/strict';
import {openDB,DEMO_ORG,migrate} from '../src/db.ts';
import {seedDemo,resetDemo} from '../src/seed.ts';
import {stageImport,commitImport,importDetail,dashboard,previewMetric,reportDraft,getReport,alertAction,createAmendment,snapshotDetail} from '../src/service.ts';
import {partialCsv,lateArrivalCsv,sampleCsv} from '../src/fixtures.ts';
function setup(){const db=openDB(':memory:');seedDemo(db);return db;}
function throws(fn:()=>any,pattern:RegExp){assert.throws(fn,pattern);}

test('seed has six grants, twelve current obligations, three windows per grant and two quarantined rows',()=>{
 const db=setup();const d=dashboard(db);
 assert.equal(d.grants.length,6);assert.equal(d.snapshot.totals.length,12);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM grant_periods').get() as any).n,18);
 assert.equal(d.imports.find((b:any)=>b.status==='committed'&&b.row_count===120).issue_count,2);
 const p=d.snapshot.totals.find((t:any)=>t.obligation_key==='jobs-placements');
 assert.equal(p.achieved,23);assert.equal(p.target,40);assert.equal(p.baseline,20);assert.equal(p.source_count,25);
 db.close();
});
test('stage returns exact invalid rows, raw values and idempotent batch hash',()=>{
 const db=setup();const first=stageImport(db,{csv:sampleCsv(),sourceAsOf:'2026-10-29',expectedRows:120});
 const again=stageImport(db,{csv:sampleCsv(),sourceAsOf:'2026-10-29',expectedRows:120});
 assert.equal(first.id,again.id);assert.equal(first.quarantined,2);
 assert.ok(first.issues.some((i:any)=>i.issues.includes('duplicate_external_id')));
 assert.ok(first.issues.some((i:any)=>i.issues.includes('unmapped_program_code')));
 assert.ok(first.issues[0].raw);db.close();
});
test('partial export cannot replace valid portfolio',()=>{
 const db=setup();const before=dashboard(db).snapshot.snapshot.id;
 const staged=stageImport(db,{csv:partialCsv(),sourceAsOf:'2026-10-29',expectedRows:120});
 assert.equal(staged.is_complete,0);
 throws(()=>commitImport(db,staged.id,{acceptQuarantine:true}),/Partial source export/);
 assert.equal(dashboard(db).snapshot.snapshot.id,before);db.close();
});
test('quarantined records require explicit operator acceptance',()=>{
 const db=setup();const before=dashboard(db).snapshot.snapshot.id;
 const stage=stageImport(db,{csv:lateArrivalCsv(),sourceAsOf:'2026-10-29',expectedRows:121});
 throws(()=>commitImport(db,stage.id),/Quarantined rows require explicit acceptance/);
 assert.equal(dashboard(db).snapshot.snapshot.id,before);db.close();
});
test('late record creates new snapshot without changing prior report',()=>{
 const db=setup();const oldSnap=dashboard(db).snapshot.snapshot.id;
 const oldReport=reportDraft(db,oldSnap);const oldJson=getReport(db,oldReport.id).contents;
 assert.equal(oldJson.obligations.find((o:any)=>o.key==='jobs-placements').achieved,23);
 const s=stageImport(db,{csv:lateArrivalCsv(),sourceAsOf:'2026-10-29',expectedRows:121});
 const newSnap=commitImport(db,s.id,{acceptQuarantine:true,asOf:'2026-10-29'});
 const current=dashboard(db);assert.equal(current.snapshot.snapshot.id,newSnap.id);
 assert.equal(current.snapshot.totals.find((o:any)=>o.obligation_key==='jobs-placements').achieved,24);
 assert.equal(snapshotDetail(db,oldSnap).totals.find((o:any)=>o.obligation_key==='jobs-placements').achieved,23);
 assert.deepEqual(getReport(db,oldReport.id).contents,oldJson);db.close();
});
test('independent preview reproduces stored snapshot',()=>{
 const db=setup();const d=dashboard(db),id=d.snapshot.snapshot.batch_id;
 for(const t of d.snapshot.totals){
  const p=previewMetric(db,t.obligation_key,id,'2026-10-29');
  assert.equal(p.achieved,t.achieved,t.obligation_key);
  assert.equal(p.target,t.target,t.obligation_key);
 }
 db.close();
});
test('amendment versions do not rewrite historical snapshot or report',()=>{
 const db=setup(),before=dashboard(db).snapshot.snapshot.id;
 const v=createAmendment(db,'jobs-placements',{target:45,effectiveOn:'2026-10-30'});
 assert.equal(v.version,2);assert.equal(dashboard(db).snapshot.totals.find((t:any)=>t.obligation_key==='jobs-placements').target,40);
 const stage=stageImport(db,{csv:lateArrivalCsv(),sourceAsOf:'2026-10-30',expectedRows:121});
 const after=commitImport(db,stage.id,{acceptQuarantine:true,asOf:'2026-10-30'});
 assert.equal(snapshotDetail(db,after.id).totals.find((t:any)=>t.obligation_key==='jobs-placements').target,45);
 assert.equal(snapshotDetail(db,before).totals.find((t:any)=>t.obligation_key==='jobs-placements').target,40);db.close();
});
test('ownership survives alert acknowledgement and new evidence; active trigger cannot be arbitrarily resolved',()=>{
 const db=setup();const d=dashboard(db);const alert=d.alerts.find((x:any)=>x.obligation_key==='adult-attendance'&&x.kind==='behind_pace');
 assert.ok(alert);alertAction(db,alert.id,'assign',{assignee:'Review Officer'});
 alertAction(db,alert.id,'acknowledge');
 throws(()=>alertAction(db,alert.id,'resolve'),/Active triggers cannot/);
 const stage=stageImport(db,{csv:lateArrivalCsv(),sourceAsOf:'2026-10-29',expectedRows:121});
 commitImport(db,stage.id,{acceptQuarantine:true});
 const a=dashboard(db).alerts.find((x:any)=>x.id===alert.id);
 assert.equal(a.assignee,'Review Officer');assert.equal(a.state,'acknowledged');db.close();
});
test('stale source creates explicit alert instead of healthy-looking performance',()=>{
 const db=setup();const stage=stageImport(db,{csv:lateArrivalCsv(),sourceAsOf:'2026-10-29',expectedRows:121});
 commitImport(db,stage.id,{acceptQuarantine:true,asOf:'2026-11-20'});
 const alerts=dashboard(db).alerts.filter((a:any)=>a.kind==='missing_source'&&a.state==='open');
 assert.ok(alerts.length>0);assert.match(alerts[0].explanation,/Source export is 22 days old/);db.close();
});
test('completed spring period can be replayed and exported',()=>{
 const db=setup();const d=dashboard(db);
 const historical=d.reports.find((r:any)=>r.status==='draft');assert.ok(historical);
 const rep=getReport(db,historical.id).contents;
 assert.equal(rep.as_of,'2026-06-29');assert.equal(rep.obligations.length,3);
 assert.equal(rep.obligations.find((o:any)=>o.key==='spring-jobs-placements').achieved,14);
 assert.equal(rep.obligations.find((o:any)=>o.key==='spring-digital-completions').achieved,10);
 assert.equal(rep.obligations.find((o:any)=>o.key==='spring-bridge-attendance').achieved,16);
 db.close();
});
test('organization scope: foreign grant, import, alert and report are inaccessible',()=>{
 const db=setup();const d=dashboard(db);
 const ids={grant:d.grants[0].id,import:d.imports[0].id,alert:d.alerts[0].id,report:d.reports[0].id};
 // Source org is untrusted input; passing a foreign org never reveals Cedar data.
 throws(()=>importDetail(db,ids.import,'other-org'),/Not found in current organization/);
 throws(()=>alertAction(db,ids.alert,'acknowledge',{},'other-org'),/Not found in current organization/);
 throws(()=>getReport(db,ids.report,'other-org'),/Not found in current organization/);
 throws(()=>createAmendment(db,'jobs-placements',{target:2,effectiveOn:'2026-10-30'},'other-org'),/Obligation not found/);
 db.close();
});
test('immutable source and records cannot be overwritten after staging',()=>{
 const db=setup();const b=dashboard(db).imports.find((i:any)=>i.status==='committed'&&i.row_count===120);
 throws(()=>db.prepare('UPDATE import_batches SET raw_csv=? WHERE id=?').run('fake',b.id),/Immutable|immutable/i);
 throws(()=>db.prepare('UPDATE program_records SET status=? WHERE batch_id=?').run('void',b.id),/immutable/i);
 db.close();
});
test('reset deletes only flagged demo org and preserves foreign organizations',()=>{
 const db=setup();db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('another','Other organization',0);
 resetDemo(db);assert.equal((db.prepare('SELECT COUNT(*) n FROM organizations WHERE id=?').get(DEMO_ORG) as any).n,0);
 assert.equal((db.prepare('SELECT COUNT(*) n FROM organizations WHERE id=?').get('another') as any).n,1);
 db.close();
});

test('SQLite rejects cross-organization relationships on INSERT and UPDATE, even if caller bypasses API',()=>{
 const db=setup();
 db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('partner-org','Partner fixture',0);
 db.prepare("INSERT INTO source_datasets VALUES(?,?,?,?,?)").run('partner-source','partner-org','Partner source','csv',10);
 const original=(db.prepare('SELECT * FROM import_batches WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 const grant=(db.prepare('SELECT * FROM grants WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 const period=(db.prepare('SELECT * FROM grant_periods WHERE grant_id=? LIMIT 1').get(grant.id) as any);
 const metric=(db.prepare('SELECT * FROM metric_definition_versions WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 const obligation=(db.prepare('SELECT * FROM obligation_versions WHERE grant_id=? LIMIT 1').get(grant.id) as any);
 const snapshot=(db.prepare('SELECT * FROM calculation_snapshots WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 const total=(db.prepare('SELECT * FROM snapshot_totals WHERE snapshot_id=? LIMIT 1').get(snapshot.id) as any);
 const alert=(db.prepare('SELECT * FROM alerts WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 const report=(db.prepare('SELECT * FROM report_drafts WHERE org_id=? LIMIT 1').get(DEMO_ORG) as any);
 // Cross-tenant references are rejected on INSERT, despite otherwise valid foreign keys.
 throws(()=>db.prepare(`INSERT INTO import_batches SELECT 'x-batch', 'partner-org', source_dataset_id, sha256, source_as_of, imported_at, status, expected_rows, row_count, valid_count, issue_count, is_complete, raw_csv, notes FROM import_batches WHERE id=?`).run(original.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare(`INSERT INTO program_records SELECT 'x-rec', batch_id, 'partner-org', row_number, external_id, participant_id, program_code, event_type, event_date, status, evidence_ref, raw_json, normalized_json, issues_json, is_valid FROM program_records WHERE batch_id=? LIMIT 1`).run(original.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare(`INSERT INTO calculation_snapshots SELECT 'x-snap','partner-org',batch_id,as_of,created_at,source_hash,metric_versions_json,status FROM calculation_snapshots WHERE id=?`).run(snapshot.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare(`INSERT INTO report_drafts SELECT 'x-report','partner-org',snapshot_id,created_at,status,contents_json FROM report_drafts WHERE id=?`).run(report.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare(`INSERT INTO alerts SELECT 'x-alert','partner-org',obligation_key,snapshot_id,kind,trigger_hash,state,severity,explanation,assignee,snoozed_until,snooze_reason,created_at,updated_at FROM alerts WHERE id=?`).run(alert.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare(`INSERT INTO assignments VALUES(?,?,?,?,?)`).run('x-assignment','partner-org',alert.id,'Partner User','2026-10-29T00:00:00Z'),/Cross-organization reference rejected/);
 // A valid second tenant can have its own grant, reporting period, metric, batch and snapshot.
 db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)').run('partner-grant','partner-org','Partner Grant','Partner','PRT','Partner Owner','2026-01-01','2026-12-31');
 db.prepare('INSERT INTO grant_periods VALUES(?,?,?,?,?,?)').run('partner-period','partner-grant','Partner window','2026-01-01','2026-12-31','2027-01-15');
 db.prepare('INSERT INTO metric_definition_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('partner-metric','partner-org','partner-placements',1,'placements','placement','PRT',0,'{}','enabled','2026-01-01T00:00:00Z');
 throws(()=>db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('x-ob',grant.id,'partner-period',metric.id,'x-ob',1,10,'2026-10-01','Owner','Required','enabled'),/Cross-organization reference rejected/);
 throws(()=>db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('x-ob2',grant.id,period.id,'partner-metric','x-ob2',1,10,'2026-10-01','Owner','Required','enabled'),/Cross-organization reference rejected/);
 db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('partner-ob','partner-grant','partner-period','partner-metric','partner-placements',1,10,'2026-01-01','Owner','Required','enabled');
 db.prepare(`INSERT INTO import_batches SELECT 'partner-batch','partner-org','partner-source',sha256,source_as_of,imported_at,status,expected_rows,row_count,valid_count,issue_count,is_complete,raw_csv,notes FROM import_batches WHERE id=?`).run(original.id);
 db.prepare(`INSERT INTO calculation_snapshots SELECT 'partner-snap','partner-org','partner-batch',as_of,created_at,source_hash,metric_versions_json,status FROM calculation_snapshots WHERE id=?`).run(snapshot.id);
 throws(()=>db.prepare(`INSERT INTO snapshot_totals SELECT 'x-total','partner-snap',obligation_version_id,obligation_key,achieved,target,baseline,source_count,excluded_count,missing_evidence_count,included_rows_json,excluded_examples_json,missing_evidence_refs_json FROM snapshot_totals WHERE id=?`).run(total.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare('UPDATE report_drafts SET org_id=? WHERE id=?').run('partner-org',report.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare('UPDATE calculation_snapshots SET batch_id=? WHERE id=?').run('partner-batch',snapshot.id),/Cross-organization reference rejected/);
 throws(()=>db.prepare('UPDATE obligation_versions SET metric_version_id=? WHERE id=?').run('partner-metric',obligation.id),/(Cross-organization reference rejected|Historical definition fields are immutable)/);
 db.prepare(`INSERT INTO snapshot_totals SELECT 'partner-total','partner-snap','partner-ob','partner-placements',achieved,target,baseline,source_count,excluded_count,missing_evidence_count,included_rows_json,excluded_examples_json,missing_evidence_refs_json FROM snapshot_totals WHERE id=?`).run(total.id);
 assert.equal((db.prepare("SELECT COUNT(*) n FROM snapshot_totals WHERE snapshot_id='partner-snap'").get() as any).n,1);
 assert.equal(dashboard(db).organization.id,DEMO_ORG);
 assert.equal(dashboard(db,'partner-org').organization.id,'partner-org');
 assert.ok(dashboard(db,'partner-org').grants.every((g:any)=>g.org_id==='partner-org'));
 db.close();
});


test('migration refuses pre-existing cross-organization references instead of trusting legacy rows',()=>{
 const db=setup(),r=dashboard(db).reports[0];
 db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('legacy-foreign','Legacy org',0);
 db.exec('DROP TRIGGER scope_report_drafts_update');
 db.prepare('UPDATE report_drafts SET org_id=? WHERE id=?').run('legacy-foreign',r.id);
 throws(()=>migrate(db),/Organization relationship mismatch in report_drafts/);
 // Repair the corrupted relationship and then verify idempotent migration.
 db.prepare('UPDATE report_drafts SET org_id=? WHERE id=?').run(DEMO_ORG,r.id);
 migrate(db);
 const report=db.prepare('SELECT org_id FROM report_drafts WHERE id=?').get(r.id) as any;
 assert.equal(report.org_id,DEMO_ORG);
 db.close();
});


test('a source hash cannot be relabeled with a newer export date or different completeness assertion',()=>{
 const db=openDB(':memory:');seedDemo(db);
 const csv=sampleCsv();
 const original=stageImport(db,{csv,sourceAsOf:'2026-10-29',expectedRows:120});
 assert.equal(stageImport(db,{csv,sourceAsOf:'2026-10-29',expectedRows:120}).id,original.id);
 assert.throws(()=>stageImport(db,{csv,sourceAsOf:'2026-10-30',expectedRows:120}),/Identical source bytes already exist/);
 assert.throws(()=>stageImport(db,{csv,sourceAsOf:'2026-10-29',expectedRows:121}),/Identical source bytes already exist/);
 const stored=db.prepare('SELECT source_as_of,expected_rows FROM import_batches WHERE id=?').get(original.id) as any;
 assert.equal(stored.source_as_of,'2026-10-29');assert.equal(stored.expected_rows,120);
 db.close();
});


test('versioned rules and parent organization ownership are immutable at database boundary',()=>{
 const db=setup();
 db.prepare('INSERT INTO organizations VALUES(?,?,?)').run('different-owner','Other tenant',0);
 const metric=db.prepare('SELECT * FROM metric_definition_versions LIMIT 1').get() as any;
 const obligation=db.prepare('SELECT * FROM obligation_versions LIMIT 1').get() as any;
 const period=db.prepare('SELECT * FROM grant_periods LIMIT 1').get() as any;
 const grant=db.prepare('SELECT * FROM grants LIMIT 1').get() as any;
 const dataset=db.prepare('SELECT * FROM source_datasets LIMIT 1').get() as any;
 throws(()=>db.prepare('UPDATE metric_definition_versions SET unit=? WHERE id=?').run('attendance_instances',metric.id),/Historical definition fields are immutable/);
 throws(()=>db.prepare('UPDATE obligation_versions SET target=target+1 WHERE id=?').run(obligation.id),/Historical definition fields are immutable/);
 throws(()=>db.prepare('UPDATE grant_periods SET report_due_on=? WHERE id=?').run('2027-12-31',period.id),/Historical definition fields are immutable/);
 throws(()=>db.prepare('UPDATE grants SET org_id=? WHERE id=?').run('different-owner',grant.id),/Organization ownership is immutable/);
 throws(()=>db.prepare('UPDATE source_datasets SET org_id=? WHERE id=?').run('different-owner',dataset.id),/Organization ownership is immutable/);
 throws(()=>db.prepare('UPDATE organizations SET is_demo=0 WHERE id=?').run(DEMO_ORG),/Demo organization designation is immutable/);
 // Status promotion is still allowed, which preserves the versioned draft workflow.
 db.prepare('UPDATE metric_definition_versions SET status=? WHERE id=?').run('draft',metric.id);
 assert.equal((db.prepare('SELECT status FROM metric_definition_versions WHERE id=?').get(metric.id) as any).status,'draft');
 db.close();
});
