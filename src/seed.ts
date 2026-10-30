import fs from 'node:fs';
import type {DB} from './db.ts';
import {openDB,DEMO_ORG,DEMO_USER,now,tx,audit} from './db.ts';
import {AS_OF,GRANTS,OBLIGATIONS,SOURCE_CODES,sampleCsv,partialCsv,lateArrivalCsv,springCsv} from './fixtures.ts';
import {stageImport,commitImport,reportDraft} from './service.ts';
export function resetDemo(db:DB):void {
 // Destructive only to the explicitly flagged demo organization; other organizations are untouched.
 const demo=db.prepare('SELECT is_demo FROM organizations WHERE id=?').get(DEMO_ORG) as any;
 if(!demo)return;
 if(demo.is_demo!==1)throw Error('Refusing reset of a non-demo organization');
 tx(db,()=>{
  db.prepare('DELETE FROM audit_events WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM assignments WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM report_drafts WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM alerts WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM snapshot_totals WHERE snapshot_id IN (SELECT id FROM calculation_snapshots WHERE org_id=?)').run(DEMO_ORG);
  db.prepare('DELETE FROM calculation_snapshots WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM program_records WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM import_batches WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM obligation_versions WHERE grant_id IN (SELECT id FROM grants WHERE org_id=?)').run(DEMO_ORG);
  db.prepare('DELETE FROM metric_definition_versions WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM grant_periods WHERE grant_id IN (SELECT id FROM grants WHERE org_id=?)').run(DEMO_ORG);
  db.prepare('DELETE FROM grants WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM record_mappings WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM source_datasets WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM users WHERE org_id=?').run(DEMO_ORG);
  db.prepare('DELETE FROM organizations WHERE id=? AND is_demo=1').run(DEMO_ORG);
 });
}
export function seedDemo(db:DB,{reset=false}:{reset?:boolean}={}):void {
 if(reset)resetDemo(db);
 if(db.prepare('SELECT id FROM organizations WHERE id=?').get(DEMO_ORG))return;
 tx(db,()=>{
  db.prepare('INSERT INTO organizations VALUES(?,?,?)').run(DEMO_ORG,'Cedar Pathways',1);
  db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(DEMO_USER,DEMO_ORG,'Demo Grants Lead','admin');
  db.prepare('INSERT INTO source_datasets VALUES(?,?,?,?,?)').run('source-crm-csv',DEMO_ORG,'Program activity export','csv',10);
  for(const code of SOURCE_CODES)db.prepare('INSERT INTO record_mappings VALUES(?,?,?,?,?,?)').run('map-'+code,DEMO_ORG,code,code,1,1);
  for(const g of GRANTS){
   db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)').run(g.id,DEMO_ORG,g.name,g.funder,g.program_code,g.owner,'2026-04-01','2026-12-13');
   // Three windows, one fully complete, a bridge period, and one 90-day current period.
   for(const [i,label,start,end,due] of [
    [1,'Spring 2026','2026-04-01','2026-06-29','2026-07-10'],
    [2,'Summer 2026','2026-06-30','2026-09-14','2026-09-25'],
    [3,'Autumn 2026','2026-09-15','2026-12-13',g.id==='grant-digital'?'2026-11-04':'2026-12-20'],
   ] as [number,string,string,string,string][])db.prepare('INSERT INTO grant_periods VALUES(?,?,?,?,?,?)').run('period-'+g.id+'-'+i,g.id,label,start,end,due);
  }
  for(const o of OBLIGATIONS){
   const g=GRANTS.find(g=>g.id===o.grant)!;
   const metric='metric-'+o.key+'-v1';
   db.prepare('INSERT INTO metric_definition_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(metric,DEMO_ORG,o.key,1,o.unit,o.event,g.program_code,Number(o.evidence),JSON.stringify({participant:'participant_id',record:'external_id',program:'program_code',type:'event_type',date:'event_date',evidence:'evidence_ref',status:'status'}),'enabled',now());
   db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('ob-'+o.key+'-v1',o.grant,'period-'+o.grant+'-3',metric,o.key,1,o.target,'2026-09-15',g.owner,o.evidence?'Evidence reference expected':'Verified status required','enabled');
  }
  // Three real obligations in the completed Spring window enable deterministic historical replay.
  for(const [key,grant,unit,event,target] of [
   ['spring-jobs-placements','grant-jobs','placements','placement',12],
   ['spring-digital-completions','grant-digital','completions','completion',8],
   ['spring-bridge-attendance','grant-bridge','attendance_instances','attendance',16],
  ] as [string,string,string,string,number][]){
   const g=GRANTS.find(x=>x.id===grant)!;
   db.prepare('INSERT INTO metric_definition_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('metric-'+key+'-v1',DEMO_ORG,key,1,unit,event,g.program_code,1,JSON.stringify({participant:'participant_id',record:'external_id',date:'event_date',evidence:'evidence_ref'}),'enabled',now());
   db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('ob-'+key+'-v1',grant,'period-'+grant+'-1','metric-'+key+'-v1',key,1,target,'2026-04-01',g.owner,'Evidence reference expected','enabled');
  }
  // Historical amendment remains effective from 15 October, replacing only the new target.
  const old=OBLIGATIONS.find(o=>o.key==='neighbor-enrollments')!;
  db.prepare('INSERT INTO obligation_versions VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('ob-neighbor-enrollments-v2',old.grant,'period-'+old.grant+'-3','metric-neighbor-enrollments-v1','neighbor-enrollments',2,27,'2026-10-15','Operations Lead','Verified status required','enabled');
  audit(db,DEMO_ORG,'demo.seed','organization',DEMO_ORG,{grants:6,obligations:12,synthetic:true});
 });
 const spring=stageImport(db,{csv:springCsv(),sourceAsOf:'2026-06-29',expectedRows:40,notes:'Completed spring reporting-period replay · synthetic'});
 const springSnapshot=commitImport(db,spring.id,{acceptQuarantine:true,asOf:'2026-06-29'});
 reportDraft(db,springSnapshot.id);
 const staged=stageImport(db,{csv:sampleCsv(),sourceAsOf:AS_OF,expectedRows:120,notes:'Synthetic full CRM export · includes two quarantined rows'});
 commitImport(db,staged.id,{acceptQuarantine:true,asOf:AS_OF});
 stageImport(db,{csv:partialCsv(),sourceAsOf:AS_OF,expectedRows:120,notes:'Deliberately incomplete source · cannot replace portfolio snapshot'});
}
export function writeFixtures(folder='fixtures'):void {
 fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(folder+'/spring_completed_period_40.csv',springCsv());
 fs.writeFileSync(folder+'/program_export_120.csv',sampleCsv());
 fs.writeFileSync(folder+'/partial_export_35_of_120.csv',partialCsv());
 fs.writeFileSync(folder+'/late_arrival_full_export_121.csv',lateArrivalCsv());
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 const db=openDB();seedDemo(db,{reset:process.argv.includes('--reset')});writeFixtures();
 console.log('Seeded Cedar Pathways demo; 6 grants, 12 obligations, 3 reporting windows per grant, 120 source records.');db.close();
}
