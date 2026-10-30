import test from 'node:test';
import assert from 'node:assert/strict';
import {openDB,DEMO_ORG} from '../src/db.ts';
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
