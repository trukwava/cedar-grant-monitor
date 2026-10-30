import crypto from 'node:crypto';
import type {DB} from './db.ts';
import {currentOrg, now,uid,tx,audit,assertOrg} from './db.ts';
import {writeCsv,HEADERS, csvParse, validateDate,validateRecord,countUnit,linearBaseline,dayOffset,VALID_EVENTS, type RecordInput, type CountingUnit} from './domain.ts';

const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
const json=(x:unknown)=>JSON.stringify(x);
function fail(message:string,status=400):never {throw Object.assign(new Error(message),{status});}
function q(db:DB,query:string,...params:any[]):any[]{return db.prepare(query).all(...params) as any[];}
function one(db:DB,query:string,...params:any[]):any{return db.prepare(query).get(...params);}

export function stageImport(db:DB, input:{csv:string,sourceAsOf:string,expectedRows?:number,notes?:string,sourceDatasetId?:string},orgId=currentOrg()):any {
 const dataset=input.sourceDatasetId
  ? one(db,"SELECT * FROM source_datasets WHERE org_id=? AND id=? AND adapter='crm_readonly'",orgId,input.sourceDatasetId)
  : one(db,"SELECT * FROM source_datasets WHERE org_id=? AND adapter='csv'",orgId);
 if(!dataset)fail('Selected source dataset is not configured for this organization',404);
 if(!validateDate(input.sourceAsOf))fail('sourceAsOf must be ISO date YYYY-MM-DD');
 const csv=input.csv.replace(/^\uFEFF/,''); const parsed=csvParse(csv);
 if(parsed.length<2)fail('CSV must include header and at least one data row');
 if(parsed[0].length!==HEADERS.length||parsed[0].some((h,i)=>h.trim()!==HEADERS[i]))fail('CSV headers must exactly match documented schema: '+HEADERS.join(','));
 const rows=parsed.slice(1);
 const expected=input.expectedRows===undefined?rows.length:Number(input.expectedRows);
 if(!Number.isInteger(expected)||expected<rows.length||expected>100000)fail('Expected row count must be at least CSV rows and no more than 100,000');
 const checksum=hash(csv);
 const existing=one(db,'SELECT * FROM import_batches WHERE org_id=? AND source_dataset_id=? AND sha256=?',orgId,dataset.id,checksum);
 if(existing){
  if(existing.source_as_of!==input.sourceAsOf||existing.expected_rows!==expected)
   fail('Identical source bytes already exist with different source date or expected row count; review the original import instead of relabeling its provenance',409);
  return importDetail(db,existing.id,orgId);
 }
 const mappings=q(db,'SELECT source_code,normalized_code FROM record_mappings WHERE org_id=? AND active=1',orgId);
 const knownCodes=new Set<string>(mappings.map((m:any)=>m.source_code));
 const norm=new Map<string,string>(mappings.map((m:any)=>[m.source_code,m.normalized_code]));
 const seen=new Set<string>();const checked:any[]=[];
 for(let i=0;i<rows.length;i++){
   const raw:Record<string,string>={};HEADERS.forEach((h,j)=>raw[h]=rows[i][j]??'');
   const r=raw as RecordInput;
   const issues=validateRecord(r,knownCodes,seen);
   if(rows[i].length!==HEADERS.length)issues.push('column_count_mismatch');
   if(r.event_date>input.sourceAsOf && validateDate(r.event_date))issues.push('future_of_export');
   const normalized={...r,program_code:norm.get(r.program_code)||r.program_code};
   checked.push({row_number:i+2,raw,normalized,issues,is_valid:issues.length===0});
 }
 const id=uid('batch');const valid=checked.filter(r=>r.is_valid).length,issues=checked.filter(r=>r.issues.length).length;
 tx(db,()=>{
   db.prepare('INSERT INTO import_batches VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,orgId,dataset.id,checksum,input.sourceAsOf,now(),'staged',expected,rows.length,valid,issues,Number(expected===rows.length),csv,(input.notes||'').slice(0,500));
   const insert=db.prepare('INSERT INTO program_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
   for(const r of checked){const v=r.normalized;insert.run(uid('rec'),id,orgId,r.row_number,v.external_id,v.participant_id,v.program_code,v.event_type,v.event_date,v.status,v.evidence_ref,json(r.raw),json(r.normalized),json(r.issues),Number(r.is_valid));}
   audit(db,orgId,'import.staged','import_batch',id,{rows:rows.length,valid,quarantined:issues,expected,checksum});
 });
 return importDetail(db,id,orgId);
}
/** Only internally instantiated fixture exports use the read-only CRM source ID.
 * Never accept this source ID from a client-controlled CSV import request. */
export function stageCRMFixture(db:DB,exportData:{source:'fixture';fixtureId:string;csv:string;sourceAsOf:string;expectedRows:number;notes:string},orgId=currentOrg()):any{
 if(orgId!=='cedar-demo'||exportData.source!=='fixture'||!['full','partial','late'].includes(exportData.fixtureId))
  fail('Fixture adapter only available to the Cedar synthetic demonstration',403);
 return stageImport(db,{csv:exportData.csv,sourceAsOf:exportData.sourceAsOf,expectedRows:exportData.expectedRows,
  notes:exportData.notes,sourceDatasetId:'source-crm-readonly-fixture'},orgId);
}

export function importDetail(db:DB,id:string,orgId=currentOrg()):any{
 assertOrg(db,'import_batches',id,orgId);
 const batch=one(db,`SELECT b.*,s.name source_name,s.adapter source_adapter FROM import_batches b JOIN source_datasets s ON s.id=b.source_dataset_id WHERE b.id=? AND b.org_id=?`,id,orgId);
 const issues=q(db,'SELECT row_number,external_id,program_code,issues_json,raw_json FROM program_records WHERE batch_id=? AND org_id=? AND is_valid=0 ORDER BY row_number LIMIT 50',id,orgId).map((r:any)=>({row:r.row_number,external_id:r.external_id,program_code:r.program_code,issues:JSON.parse(r.issues_json),raw:JSON.parse(r.raw_json)}));
 return {...batch,issues,quarantined:batch.row_count-batch.valid_count};
}
function activeObligations(db:DB,orgId:string,asOf:string):any[]{
 return q(db,`SELECT ov.*,g.name grant_name,g.owner grant_owner,g.program_code grant_program,g.org_id,p.label period_label,p.starts_on,p.ends_on,p.report_due_on,m.metric_key,m.version metric_version,m.unit,m.event_type,m.program_code metric_program,m.needs_evidence,m.status metric_status
 FROM obligation_versions ov JOIN grants g ON ov.grant_id=g.id JOIN grant_periods p ON ov.period_id=p.id JOIN metric_definition_versions m ON ov.metric_version_id=m.id
 WHERE g.org_id=? AND ov.status='enabled' AND m.status='enabled' AND ov.effective_on<=? AND p.starts_on<=? AND p.ends_on>=?
 AND ov.version=(SELECT MAX(o2.version) FROM obligation_versions o2 WHERE o2.obligation_key=ov.obligation_key AND o2.effective_on<=? AND o2.status='enabled')
 ORDER BY g.name,ov.obligation_key`,orgId,asOf,asOf,asOf,asOf);
}
export function previewMetric(db:DB,obligationKey:string,batchId:string,asOf:string,orgId=currentOrg(),includeDraft=false):any{
 assertOrg(db,'import_batches',batchId,orgId);
 let o=activeObligations(db,orgId,asOf).find((x:any)=>x.obligation_key===obligationKey);
 if(!o&&includeDraft){
   o=one(db,`SELECT ov.*,g.name grant_name,g.owner grant_owner,g.program_code grant_program,g.org_id,p.label period_label,p.starts_on,p.ends_on,p.report_due_on,m.metric_key,m.version metric_version,m.unit,m.event_type,m.program_code metric_program,m.needs_evidence,m.status metric_status
   FROM obligation_versions ov JOIN grants g ON ov.grant_id=g.id JOIN grant_periods p ON ov.period_id=p.id JOIN metric_definition_versions m ON ov.metric_version_id=m.id
   WHERE g.org_id=? AND ov.obligation_key=? AND ov.status='draft' AND m.status='draft' AND p.starts_on<=? AND p.ends_on>=? ORDER BY ov.version DESC LIMIT 1`,orgId,obligationKey,asOf,asOf);
 }
 if(!o)fail('No active or requested draft obligation at this as-of date',404);
 const all=q(db,'SELECT * FROM program_records WHERE batch_id=? AND org_id=? ORDER BY row_number',batchId,orgId);
 const qualifying:RecordInput[]=[],excluded:any[]=[];
 for(const r of all){const reason:string[]=[];
  if(!r.is_valid)reason.push(...JSON.parse(r.issues_json));
  if(r.program_code!==o.metric_program)reason.push('different_program');
  if(r.event_type!==o.event_type)reason.push('different_event_type');
  if(r.status!=='verified')reason.push('not_verified');
  if(r.event_date<o.starts_on||r.event_date>o.ends_on||r.event_date>asOf)reason.push('outside_reporting_cutoff');
  if(reason.length) {if(excluded.length<5&&r.program_code===o.metric_program)excluded.push({row:r.row_number,record:r.external_id,reason});continue;}
  qualifying.push({external_id:r.external_id,participant_id:r.participant_id,program_code:r.program_code,event_type:r.event_type,event_date:r.event_date,status:r.status,evidence_ref:r.evidence_ref});
 }
 const result=countUnit(qualifying,o.unit as CountingUnit);
 const includedSet=new Set(result.included);
 const counted=qualifying.filter(r=>includedSet.has(r.external_id));
 const missing=counted.filter(r=>o.needs_evidence&&!r.evidence_ref);
 const duplicates=qualifying.filter(r=>!includedSet.has(r.external_id));
 for(const r of duplicates.slice(0,3))if(excluded.length<6)excluded.push({record:r.external_id,reason:['deduplicated_person']});
 return {obligation:o,achieved:result.count,target:o.target,baseline:linearBaseline(o.target,o.starts_on,o.ends_on,asOf),sourceCount:result.sourceCount,duplicates:result.duplicates,excludedCount:all.length-result.included.length,missingEvidence:missing.map(r=>r.external_id),included:counted.map(r=>({record_id:r.external_id,participant_id:r.participant_id,evidence_ref:r.evidence_ref||null,event_date:r.event_date})),excludedExamples:excluded};
}
export function commitImport(db:DB,batchId:string,args:{acceptQuarantine?:boolean,asOf?:string}={},orgId=currentOrg()):any{
 const batch=importDetail(db,batchId,orgId);
 if(batch.status==='committed')return one(db,'SELECT * FROM calculation_snapshots WHERE batch_id=? AND org_id=? ORDER BY rowid DESC LIMIT 1',batchId,orgId);
 if(batch.status!=='staged')fail('Import is not staged',409);
 if(!batch.is_complete)fail('Partial source export cannot replace current snapshot',409);
 if(batch.quarantined>0&&!args.acceptQuarantine)fail('Quarantined rows require explicit acceptance before publishing',409);
 const asOf=args.asOf||batch.source_as_of;
 if(!validateDate(asOf)||asOf<batch.source_as_of)fail('Snapshot date must be valid and not before source export date');
 const active=activeObligations(db,orgId,asOf);
 if(!active.length)fail('No active obligations configured');
 const definitions=json(active.map((o:any)=>({obligation:o.obligation_key,version:o.version,target:o.target,metric:o.metric_version_id,metricVersion:o.metric_version})));
 const snapId=uid('snap');
 return tx(db,()=>{
  db.prepare("UPDATE import_batches SET status='committed' WHERE id=? AND org_id=?").run(batchId,orgId);
  db.prepare('INSERT INTO calculation_snapshots VALUES(?,?,?,?,?,?,?,?)').run(snapId,orgId,batchId,asOf,now(),batch.sha256,definitions,'published');
  const insert=db.prepare('INSERT INTO snapshot_totals VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const o of active){
   const p=previewMetric(db,o.obligation_key,batchId,asOf,orgId);
   insert.run(uid('total'),snapId,o.id,o.obligation_key,p.achieved,p.target,p.baseline,p.sourceCount,p.excludedCount,p.missingEvidence.length,json(p.included),json(p.excludedExamples),json(p.missingEvidence));
  }
  audit(db,orgId,'import.committed','import_batch',batchId,{snapshot:snapId,asOf,quarantined:batch.quarantined});
  syncAlerts(db,snapId,orgId);
  return one(db,'SELECT * FROM calculation_snapshots WHERE id=?',snapId);
 });
}
function syncAlerts(db:DB,snapshotId:string,orgId:string):void{
 const snap=one(db,'SELECT * FROM calculation_snapshots WHERE id=? AND org_id=?',snapshotId,orgId);
 const batch=one(db,'SELECT * FROM import_batches WHERE id=?',snap.batch_id);
 const obligations=activeObligations(db,orgId,snap.as_of);
 const totals=q(db,'SELECT * FROM snapshot_totals WHERE snapshot_id=?',snapshotId);
 const desired=new Map<string,{kind:string;explanation:string;severity:string;key:string}>();
 for(const o of obligations){const t=totals.find((r:any)=>r.obligation_key===o.obligation_key);if(!t)continue;
  const add=(kind:string,explanation:string,severity:string)=>desired.set(o.obligation_key+'|'+kind,{key:o.obligation_key,kind,explanation,severity});
  if(t.achieved<t.baseline)add('behind_pace',`${t.achieved} achieved vs ${t.baseline} expected by a simple linear pacing assumption (not a failure prediction).`,'warning');
  if(t.missing_evidence_count>0)add('evidence_incomplete',`${t.missing_evidence_count} counted records lack evidence references.`,'warning');
  const toDue=dayOffset(o.report_due_on,snap.as_of);
  if(toDue>=0&&toDue<=14)add('report_due',`Reporting deadline ${o.report_due_on} is ${toDue} day(s) away.`,'attention');
  const sourceLag=dayOffset(snap.as_of,batch.source_as_of);
  const freshness=one(db,'SELECT freshness_days FROM source_datasets WHERE id=?',batch.source_dataset_id)?.freshness_days??10;
  if(sourceLag>freshness)add('missing_source',`Source export is ${sourceLag} days old; latest source data may be missing.`,'critical');
 }
 const existing=q(db,'SELECT * FROM alerts WHERE org_id=?',orgId);
 for(const prior of existing){const id=prior.obligation_key+'|'+prior.kind;
  if(!desired.has(id)&&prior.state!=='resolved'){
   db.prepare("UPDATE alerts SET state='resolved',updated_at=? WHERE id=?").run(now(),prior.id);
   audit(db,orgId,'alert.auto_resolved','alert',prior.id,{reason:'Trigger absent from newest snapshot'});
  }
 }
 for(const target of desired.values()){
  const previous=existing.find((a:any)=>a.obligation_key===target.key&&a.kind===target.kind);
  const fingerprint=hash(target.kind+'|'+target.explanation);
  if(previous){const changed=previous.trigger_hash!==fingerprint;
   const state=(changed||previous.state==='resolved')?'open':previous.state;
   db.prepare('UPDATE alerts SET snapshot_id=?,trigger_hash=?,explanation=?,severity=?,state=?,updated_at=? WHERE id=?').run(snapshotId,fingerprint,target.explanation,target.severity,state,now(),previous.id);
   if(changed||previous.state==='resolved')audit(db,orgId,'alert.reopened','alert',previous.id,{changed,newSnapshot:snapshotId});
  }else{
   const id=uid('alert');
   db.prepare('INSERT INTO alerts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,orgId,target.key,snapshotId,target.kind,fingerprint,'open',target.severity,target.explanation,'',null,null,now(),now());
   audit(db,orgId,'alert.triggered','alert',id,{kind:target.kind,obligation:target.key});
  }
 }
}
export function alertAction(db:DB,id:string,action:string,input:{assignee?:string;until?:string;reason?:string}={},orgId=currentOrg()):any{
 assertOrg(db,'alerts',id,orgId);
 const a=one(db,'SELECT * FROM alerts WHERE id=?',id);let state=a.state;
 const assignee=input.assignee?.trim().slice(0,80)||a.assignee;
 const reason=input.reason?.trim().slice(0,300)||'';
 let until=a.snoozed_until;
 if(action==='acknowledge') {if(a.state!=='open')fail('Only open alerts can be acknowledged',409);state='acknowledged';}
 else if(action==='assign') {if(!input.assignee?.trim())fail('Assignee required');}
 else if(action==='snooze'){
  if(!['open','acknowledged'].includes(a.state))fail('Alert not snoozable in this state',409);
  if(!reason||!input.until||!validateDate(input.until)||input.until<=new Date().toISOString().slice(0,10))fail('Future snooze date and reason required');
  state='snoozed';until=input.until;
 }else if(action==='resolve'){
  const snap=one(db,'SELECT * FROM calculation_snapshots WHERE org_id=? ORDER BY rowid DESC LIMIT 1',orgId);
  if(snap?.id===a.snapshot_id && a.state!=='resolved')fail('Active triggers cannot be manually marked resolved; fix underlying data then publish a new snapshot',409);
  fail('Only rule-based resolution is permitted',409);
 }else fail('Unknown alert action');
 return tx(db,()=>{
  db.prepare('UPDATE alerts SET state=?,assignee=?,snoozed_until=?,snooze_reason=?,updated_at=? WHERE id=?').run(state,assignee,until,action==='snooze'?reason:a.snooze_reason,now(),id);
  if(action==='assign')db.prepare('INSERT INTO assignments VALUES(?,?,?,?,?)').run(uid('asg'),orgId,id,assignee,now());
  audit(db,orgId,'alert.'+action,'alert',id,{assignee,until,reason:action==='snooze'?reason:undefined});
  return one(db,'SELECT * FROM alerts WHERE id=?',id);
 });
}
export function createAmendment(db:DB,key:string,args:{target:number,effectiveOn:string,owner?:string},orgId=currentOrg()):any{
 if(!Number.isInteger(args.target)||args.target<0||args.target>1_000_000||!validateDate(args.effectiveOn))fail('Valid nonnegative target and effective date required');
 const current=q(db,`SELECT ov.*,g.org_id FROM obligation_versions ov JOIN grants g ON g.id=ov.grant_id WHERE ov.obligation_key=? AND g.org_id=? ORDER BY ov.version DESC LIMIT 1`,key,orgId)[0];
 if(!current)fail('Obligation not found',404);
 if(args.effectiveOn<=current.effective_on)fail('Amendment effective date must be later than previous version',409);
 return tx(db,()=>{
  const id=uid('ov');const version=current.version+1;
  db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(id,current.grant_id,current.period_id,current.metric_version_id,key,version,args.target,args.effectiveOn,args.owner?.slice(0,80)||current.owner,current.evidence_rule,'enabled');
  audit(db,orgId,'obligation.amended','obligation_version',id,{key,version,target:args.target,effectiveOn:args.effectiveOn});
  return one(db,'SELECT * FROM obligation_versions WHERE id=?',id);
 });
}
export function snapshotDetail(db:DB,id:string,orgId=currentOrg()):any{
 assertOrg(db,'calculation_snapshots',id,orgId);
 const snapshot=one(db,'SELECT * FROM calculation_snapshots WHERE id=?',id);
 const totals=q(db,`SELECT st.*,ov.owner,ov.evidence_rule,m.unit,m.metric_key,g.name grant_name,g.funder,p.label period_label,p.report_due_on,p.starts_on,p.ends_on FROM snapshot_totals st
 JOIN obligation_versions ov ON st.obligation_version_id=ov.id JOIN grants g ON ov.grant_id=g.id JOIN grant_periods p ON ov.period_id=p.id JOIN metric_definition_versions m ON ov.metric_version_id=m.id WHERE st.snapshot_id=? ORDER BY g.name,st.obligation_key`,id);
 return {snapshot,totals:totals.map((t:any)=>({...t,included:JSON.parse(t.included_rows_json),excluded_examples:JSON.parse(t.excluded_examples_json),missing_evidence_refs:JSON.parse(t.missing_evidence_refs_json)}))};
}
export function reportDraft(db:DB,snapshotId:string,orgId=currentOrg()):any{
 const detail=snapshotDetail(db,snapshotId,orgId);
 const batch=one(db,`SELECT b.source_as_of,b.sha256,b.row_count,b.valid_count,b.issue_count,s.name source_dataset_name,s.adapter source_adapter
 FROM import_batches b JOIN source_datasets s ON s.id=b.source_dataset_id WHERE b.id=? AND b.org_id=?`,detail.snapshot.batch_id,orgId);
 const orgName=one(db,'SELECT name,is_demo FROM organizations WHERE id=?',orgId);
 const payload={kind:'DRAFT - NOT APPROVED OR SUBMITTED',organization:orgName.name+(orgName.is_demo?' (synthetic)':''),source_dataset:batch.source_dataset_name,source_adapter:batch.source_adapter,source_connection:batch.source_adapter==='crm_readonly'?'SIMULATED - NOT CONNECTED':'LOCAL CSV - NO CRM CONNECTION',as_of:detail.snapshot.as_of,snapshot_timestamp:detail.snapshot.created_at,snapshot_id:snapshotId,source_sha256:detail.snapshot.source_hash,source_batch:detail.snapshot.batch_id,source_export_as_of:batch.source_as_of,source_rows:batch.row_count,quarantined_rows:batch.issue_count,metric_versions:JSON.parse(detail.snapshot.metric_versions_json),obligations:detail.totals.map((t:any)=>({key:t.obligation_key,grant:t.grant_name,period:t.period_label,metric:t.metric_key,counting_unit:t.unit,target:t.target,achieved:t.achieved,pacing_assumption:t.baseline,evidence_missing:t.missing_evidence_refs,records:t.included,exceptions:t.excluded_examples,definition_version:t.obligation_version_id}))};
 return tx(db,()=>{
  const id=uid('report');db.prepare('INSERT INTO report_drafts VALUES(?,?,?,?,?,?)').run(id,orgId,snapshotId,now(),'draft',json(payload));
  audit(db,orgId,'report.drafted','report_draft',id,{snapshotId});return one(db,'SELECT * FROM report_drafts WHERE id=?',id);
 });
}
export function getReport(db:DB,id:string,orgId=currentOrg()):any{
 assertOrg(db,'report_drafts',id,orgId);
 const r=one(db,'SELECT * FROM report_drafts WHERE id=?',id);
 return {...r,contents:JSON.parse(r.contents_json)};
}
export function createGrantDraft(db:DB,input:{name:string;funder:string;programCode:string;owner:string;startsOn:string;endsOn:string;reportDueOn:string;unit:CountingUnit;eventType:string;target:number;needsEvidence:boolean},orgId=currentOrg()):any{
 const name=String(input.name||'').trim().slice(0,100),funder=String(input.funder||'').trim().slice(0,100),owner=String(input.owner||'').trim().slice(0,80);
 const allowedUnits=['distinct_people','attendance_instances','enrollments','completions','placements'];
 if(!name||!funder||!owner)fail('Grant name, funder and owner are required');
 if(!validateDate(input.startsOn)||!validateDate(input.endsOn)||!validateDate(input.reportDueOn)||input.startsOn>input.endsOn||input.reportDueOn<input.startsOn)fail('Review the start, end, and reporting-due dates');
 if(!allowedUnits.includes(input.unit)||!VALID_EVENTS.includes(input.eventType))fail('Unknown counting unit or event type');
 if(!Number.isInteger(input.target)||input.target<0||input.target>1_000_000)fail('Target must be a nonnegative integer');
 if(!one(db,'SELECT id FROM record_mappings WHERE org_id=? AND source_code=? AND active=1',orgId,input.programCode))fail('Program code must have a reviewed source mapping');
 const code=String(input.programCode),id=uid('grant'),key='custom-'+uid('o'),period=uid('period'),metric=uid('metric'),ob=uid('ob');
 return tx(db,()=>{
  db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)').run(id,orgId,name,funder,code,owner,input.startsOn,input.endsOn);
  db.prepare('INSERT INTO grant_periods VALUES(?,?,?,?,?,?)').run(period,id,'Configured reporting period',input.startsOn,input.endsOn,input.reportDueOn);
  db.prepare('INSERT INTO metric_definition_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(metric,orgId,key,1,input.unit,input.eventType,code,Number(input.needsEvidence),json({participant:'participant_id',record:'external_id',program:'program_code',type:'event_type',date:'event_date',status:'status',evidence:'evidence_ref'}),'draft',now());
  db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ob,id,period,metric,key,1,input.target,input.startsOn,owner,input.needsEvidence?'Evidence reference expected':'Verified status required','draft');
  audit(db,orgId,'config.draft_created','obligation_version',ob,{grant:id,key,unit:input.unit,target:input.target});
  return {grantId:id,key,obligationVersionId:ob,status:'draft'};
 });
}
export function previewDraft(db:DB,key:string,batchId:string,asOf:string,orgId=currentOrg()):any{
 const result=previewMetric(db,key,batchId,asOf,orgId,true);
 if(result.obligation.status!=='draft')fail('Preview endpoint is only for draft definitions',409);
 audit(db,orgId,'config.previewed','obligation_version',result.obligation.id,{batchId,asOf,achieved:result.achieved,metricVersion:result.obligation.metric_version_id});
 return result;
}
export function enableDraft(db:DB,key:string,orgId=currentOrg()):any{
 const row=one(db,`SELECT ov.*,g.org_id,m.status metric_status FROM obligation_versions ov JOIN grants g ON ov.grant_id=g.id JOIN metric_definition_versions m ON ov.metric_version_id=m.id WHERE g.org_id=? AND ov.obligation_key=? ORDER BY ov.version DESC LIMIT 1`,orgId,key);
 if(!row)fail('Draft not found',404);
 if(row.status!=='draft'||row.metric_status!=='draft')fail('Only a draft metric may be enabled',409);
 const prior=one(db,"SELECT id FROM audit_events WHERE org_id=? AND entity_id=? AND kind='config.previewed' ORDER BY rowid DESC LIMIT 1",orgId,row.id);
 if(!prior)fail('A recorded source-data preview is required before enabling this metric',409);
 return tx(db,()=>{
  db.prepare("UPDATE metric_definition_versions SET status='enabled' WHERE id=? AND org_id=?").run(row.metric_version_id,orgId);
  db.prepare("UPDATE obligation_versions SET status='enabled' WHERE id=?").run(row.id);
  audit(db,orgId,'config.enabled','obligation_version',row.id,{key,reviewedPreview:true});
  return {...row,status:'enabled',note:'Enabled configuration takes effect on the next published complete snapshot'};
 });
}
export function dashboard(db:DB,orgId=currentOrg()):any{
 const snap=one(db,'SELECT * FROM calculation_snapshots WHERE org_id=? ORDER BY rowid DESC LIMIT 1',orgId);
 const grants=q(db,'SELECT * FROM grants WHERE org_id=? ORDER BY name',orgId);
 const datasets=q(db,'SELECT * FROM source_datasets WHERE org_id=?',orgId);
 const mappings=q(db,'SELECT source_code,normalized_code FROM record_mappings WHERE org_id=? AND active=1 ORDER BY source_code',orgId);
 const drafts=q(db,`SELECT ov.obligation_key,ov.id obligation_version_id,ov.target,ov.owner,g.name grant_name,g.funder,g.program_code,m.unit,m.event_type,m.needs_evidence,p.starts_on,p.ends_on,p.report_due_on FROM obligation_versions ov JOIN grants g ON ov.grant_id=g.id JOIN metric_definition_versions m ON ov.metric_version_id=m.id JOIN grant_periods p ON ov.period_id=p.id WHERE g.org_id=? AND ov.status='draft' ORDER BY ov.rowid DESC`,orgId);
 const imports=q(db,`SELECT b.id,b.status,b.source_as_of,b.imported_at,b.row_count,b.valid_count,b.issue_count,b.is_complete,b.expected_rows,s.name source_name,s.adapter source_adapter FROM import_batches b JOIN source_datasets s ON s.id=b.source_dataset_id WHERE b.org_id=? ORDER BY b.rowid DESC LIMIT 20`,orgId);
 const alerts=q(db,"SELECT * FROM alerts WHERE org_id=? ORDER BY CASE state WHEN 'open' THEN 0 WHEN 'acknowledged' THEN 1 ELSE 2 END, created_at DESC",orgId);
 const auditTrail=q(db,'SELECT at,kind,entity_type,entity_id,details_json FROM audit_events WHERE org_id=? ORDER BY rowid DESC LIMIT 24',orgId);
 const snapshot=snap?snapshotDetail(db,snap.id,orgId):null;
 return {mappings,drafts,organization:{id:orgId,name:(one(db,'SELECT name FROM organizations WHERE id=?',orgId)?.name||'Unknown organization')+(orgId=== 'cedar-demo'?' · DEMO':'')},grants,alerts,imports,datasets,auditTrail,snapshot,reports:q(db,'SELECT id,snapshot_id,created_at,status FROM report_drafts WHERE org_id=? ORDER BY rowid DESC LIMIT 15',orgId),connection:{status:'demo_csv_and_fixture_only',crm:'Not connected',fixture:'SIMULATED · no CRM connection',model:'Not enabled'}};
}
