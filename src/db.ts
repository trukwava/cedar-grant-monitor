import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import {AsyncLocalStorage} from 'node:async_hooks';
import path from 'node:path';

export const DEMO_ORG='cedar-demo';
export const DEMO_USER='cedar-lead';
const requestIdentity = new AsyncLocalStorage<{actor:string;orgId:string}>();
export const currentOrg=()=>requestIdentity.getStore()?.orgId||DEMO_ORG;
export const withIdentity=<T>(identity:{actor:string;orgId:string},fn:()=>T):T=>requestIdentity.run(identity,fn);
export const DEFAULT_AS_OF='2026-10-29';
export type DB = DatabaseSync;
export function openDB(filename = process.env.DB_PATH || './data/cedar.sqlite'): DB {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(filename)), {recursive:true});
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
  migrate(db); return db;
}
export function tx<T>(db:DB, fn:()=>T):T {
  db.exec('BEGIN IMMEDIATE');
  try {const res=fn();db.exec('COMMIT');return res;} catch(e){db.exec('ROLLBACK');throw e;}
}
export function migrate(db:DB):void {
 db.exec(`
CREATE TABLE IF NOT EXISTS organizations(id TEXT PRIMARY KEY,name TEXT NOT NULL,is_demo INTEGER NOT NULL CHECK(is_demo IN (0,1)));
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),display_name TEXT NOT NULL,role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grants(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,funder TEXT NOT NULL,program_code TEXT NOT NULL,owner TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS grant_periods(id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES grants(id),label TEXT NOT NULL,starts_on TEXT NOT NULL,ends_on TEXT NOT NULL,report_due_on TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS source_datasets(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),name TEXT NOT NULL,adapter TEXT NOT NULL CHECK(adapter IN ('csv','crm_readonly')),freshness_days INTEGER NOT NULL DEFAULT 10);
CREATE TABLE IF NOT EXISTS record_mappings(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),source_code TEXT NOT NULL,normalized_code TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,active INTEGER NOT NULL DEFAULT 1, UNIQUE(org_id,source_code,version));
CREATE TABLE IF NOT EXISTS metric_definition_versions(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),metric_key TEXT NOT NULL,version INTEGER NOT NULL,unit TEXT NOT NULL CHECK(unit IN ('distinct_people','attendance_instances','enrollments','completions','placements')),event_type TEXT NOT NULL,program_code TEXT NOT NULL,needs_evidence INTEGER NOT NULL DEFAULT 0,source_mapping_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','enabled','retired')),created_at TEXT NOT NULL,UNIQUE(org_id,metric_key,version));
CREATE TABLE IF NOT EXISTS obligation_versions(id TEXT PRIMARY KEY,grant_id TEXT NOT NULL REFERENCES grants(id),period_id TEXT NOT NULL REFERENCES grant_periods(id),metric_version_id TEXT NOT NULL REFERENCES metric_definition_versions(id),obligation_key TEXT NOT NULL,version INTEGER NOT NULL,target INTEGER NOT NULL CHECK(target>=0),effective_on TEXT NOT NULL,owner TEXT NOT NULL,evidence_rule TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','enabled','retired')),UNIQUE(obligation_key,version));
CREATE TABLE IF NOT EXISTS import_batches(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),source_dataset_id TEXT NOT NULL REFERENCES source_datasets(id),sha256 TEXT NOT NULL,source_as_of TEXT NOT NULL,imported_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('staged','committed','rejected')),expected_rows INTEGER NOT NULL,row_count INTEGER NOT NULL,valid_count INTEGER NOT NULL,issue_count INTEGER NOT NULL,is_complete INTEGER NOT NULL CHECK(is_complete IN (0,1)),raw_csv TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',UNIQUE(org_id,source_dataset_id,sha256));
CREATE TABLE IF NOT EXISTS program_records(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES import_batches(id),org_id TEXT NOT NULL REFERENCES organizations(id),row_number INTEGER NOT NULL,external_id TEXT NOT NULL,participant_id TEXT NOT NULL,program_code TEXT NOT NULL,event_type TEXT NOT NULL,event_date TEXT NOT NULL,status TEXT NOT NULL,evidence_ref TEXT NOT NULL,raw_json TEXT NOT NULL,normalized_json TEXT NOT NULL,issues_json TEXT NOT NULL,is_valid INTEGER NOT NULL CHECK(is_valid IN (0,1)),UNIQUE(batch_id,row_number));
CREATE TABLE IF NOT EXISTS calculation_snapshots(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),batch_id TEXT NOT NULL REFERENCES import_batches(id),as_of TEXT NOT NULL,created_at TEXT NOT NULL,source_hash TEXT NOT NULL,metric_versions_json TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('published','superseded')),UNIQUE(batch_id,as_of,metric_versions_json));
CREATE TABLE IF NOT EXISTS snapshot_totals(id TEXT PRIMARY KEY,snapshot_id TEXT NOT NULL REFERENCES calculation_snapshots(id),obligation_version_id TEXT NOT NULL REFERENCES obligation_versions(id),obligation_key TEXT NOT NULL,achieved INTEGER NOT NULL,target INTEGER NOT NULL,baseline REAL NOT NULL,source_count INTEGER NOT NULL,excluded_count INTEGER NOT NULL,missing_evidence_count INTEGER NOT NULL,included_rows_json TEXT NOT NULL,excluded_examples_json TEXT NOT NULL,missing_evidence_refs_json TEXT NOT NULL,UNIQUE(snapshot_id,obligation_key));
CREATE TABLE IF NOT EXISTS alerts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),obligation_key TEXT NOT NULL,snapshot_id TEXT NOT NULL REFERENCES calculation_snapshots(id),kind TEXT NOT NULL,trigger_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('open','acknowledged','snoozed','resolved')),severity TEXT NOT NULL,explanation TEXT NOT NULL,assignee TEXT NOT NULL DEFAULT '',snoozed_until TEXT,snooze_reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(org_id,obligation_key,kind,trigger_hash));
CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),alert_id TEXT NOT NULL REFERENCES alerts(id),assignee TEXT NOT NULL,assigned_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS report_drafts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),snapshot_id TEXT NOT NULL REFERENCES calculation_snapshots(id),created_at TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('draft','accepted','rejected')),contents_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,org_id TEXT NOT NULL REFERENCES organizations(id),actor TEXT NOT NULL,at TEXT NOT NULL,kind TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,details_json TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS prevent_source_mutation BEFORE UPDATE OF sha256,source_as_of,expected_rows,row_count,valid_count,issue_count,is_complete,raw_csv ON import_batches BEGIN SELECT RAISE(ABORT,'Import contents are immutable'); END;
CREATE TRIGGER IF NOT EXISTS prevent_record_mutation BEFORE UPDATE ON program_records BEGIN SELECT RAISE(ABORT,'Program records are immutable'); END;
CREATE INDEX IF NOT EXISTS idx_records_batch ON program_records(batch_id,is_valid,event_type,event_date);
CREATE INDEX IF NOT EXISTS idx_snapshots_org ON calculation_snapshots(org_id,created_at);
CREATE INDEX IF NOT EXISTS idx_alerts_org ON alerts(org_id,state);
`);
 installScopeGuards(db);
 installImmutableDefinitionGuards(db);
}
/** Defense in depth: SQLite FKs verify that referenced rows exist, but not that
 * both sides belong to the same organization. These guards enforce tenancy at
 * the data boundary, including writes from future adapters and migrations.
 * All guard names/SQL expressions below are constant application code.
 */
const scopedReferences: Array<{table:string; updateColumns:string; valid:string}> = [
 {table:'import_batches',updateColumns:'org_id, source_dataset_id',valid:'NEW.org_id = (SELECT org_id FROM source_datasets WHERE id=NEW.source_dataset_id)'},
 {table:'program_records',updateColumns:'org_id, batch_id',valid:'NEW.org_id = (SELECT org_id FROM import_batches WHERE id=NEW.batch_id)'},
 {table:'calculation_snapshots',updateColumns:'org_id, batch_id',valid:'NEW.org_id = (SELECT org_id FROM import_batches WHERE id=NEW.batch_id)'},
 {table:'report_drafts',updateColumns:'org_id, snapshot_id',valid:'NEW.org_id = (SELECT org_id FROM calculation_snapshots WHERE id=NEW.snapshot_id)'},
 {table:'alerts',updateColumns:'org_id, snapshot_id, obligation_key',valid:`NEW.org_id = (SELECT org_id FROM calculation_snapshots WHERE id=NEW.snapshot_id)
 AND EXISTS(SELECT 1 FROM obligation_versions ov JOIN grants g ON g.id=ov.grant_id WHERE g.org_id=NEW.org_id AND ov.obligation_key=NEW.obligation_key)`},
 {table:'assignments',updateColumns:'org_id, alert_id',valid:'NEW.org_id = (SELECT org_id FROM alerts WHERE id=NEW.alert_id)'},
 {table:'obligation_versions',updateColumns:'grant_id, period_id, metric_version_id',valid:`NEW.grant_id = (SELECT grant_id FROM grant_periods WHERE id=NEW.period_id)
 AND (SELECT org_id FROM grants WHERE id=NEW.grant_id) = (SELECT org_id FROM metric_definition_versions WHERE id=NEW.metric_version_id)`},
 {table:'snapshot_totals',updateColumns:'snapshot_id, obligation_version_id',valid:`(SELECT org_id FROM calculation_snapshots WHERE id=NEW.snapshot_id) =
 (SELECT g.org_id FROM obligation_versions ov JOIN grants g ON g.id=ov.grant_id WHERE ov.id=NEW.obligation_version_id)`},
];
function installScopeGuards(db:DB):void {
 if(db.prepare('PRAGMA foreign_key_check').get())throw new Error('Existing database contains invalid foreign keys; restore a reviewed backup');
 // CREATE TRIGGER is not retroactive. Refuse an existing database with broken
 // ownership relationships rather than quietly trusting previously written rows.
 for(const {table,valid} of scopedReferences){
  const predicate=valid.replace(/\bNEW\./g,'candidate.');
  const bad=db.prepare(`SELECT id FROM ${table} AS candidate WHERE NOT (${predicate}) LIMIT 1`).get();
  if(bad)throw new Error(`Organization relationship mismatch in ${table}; repair from a reviewed backup before starting`);
 }
 for(const {table,updateColumns,valid} of scopedReferences){
  for(const [action,suffix] of [['INSERT','insert'],[`UPDATE OF ${updateColumns}`,'update']]){
   db.exec(`CREATE TRIGGER IF NOT EXISTS scope_${table}_${suffix} BEFORE ${action} ON ${table}
     WHEN NOT (${valid}) BEGIN SELECT RAISE(ABORT,'Cross-organization reference rejected'); END;`);
  }
 }
}

/** Domain definitions and time windows are versioned facts, not mutable configuration.
 * Both imported history and successor calculations depend on stable versions.
 * Demo reset explicitly deletes the demo-only rows; ordinary UPDATE is barred.
 */
function installImmutableDefinitionGuards(db:DB):void {
 const immutable:Record<string,string>={
  metric_definition_versions:'org_id, metric_key, version, unit, event_type, program_code, needs_evidence, source_mapping_json, created_at',
  obligation_versions:'grant_id, period_id, metric_version_id, obligation_key, version, target, effective_on, owner, evidence_rule',
  grant_periods:'grant_id, label, starts_on, ends_on, report_due_on',
  calculation_snapshots:'org_id, batch_id, as_of, created_at, source_hash, metric_versions_json',
  snapshot_totals:'snapshot_id, obligation_version_id, obligation_key, achieved, target, baseline, source_count, excluded_count, missing_evidence_count, included_rows_json, excluded_examples_json, missing_evidence_refs_json',
  report_drafts:'snapshot_id, created_at, contents_json',
  audit_events:'org_id, actor, at, kind, entity_type, entity_id, details_json',
 };
 for(const [table,columns] of Object.entries(immutable)){
  db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_${table} BEFORE UPDATE OF ${columns} ON ${table}
   BEGIN SELECT RAISE(ABORT,'Historical definition fields are immutable; create a new version'); END;`);
 }
 // Parent ownership mutations would undermine the child-scoped FK guards.
 for(const table of ['grants','source_datasets','record_mappings','users','audit_events']){
  db.exec(`CREATE TRIGGER IF NOT EXISTS fixed_ownership_${table} BEFORE UPDATE OF org_id ON ${table}
   WHEN NEW.org_id != OLD.org_id BEGIN SELECT RAISE(ABORT,'Organization ownership is immutable'); END;`);
 }
 db.exec(`CREATE TRIGGER IF NOT EXISTS fixed_demo_flag BEFORE UPDATE OF is_demo ON organizations
  WHEN NEW.is_demo != OLD.is_demo BEGIN SELECT RAISE(ABORT,'Demo organization designation is immutable'); END;`);
}

export function assertOrg(db:DB, entityTable:'grants'|'alerts'|'report_drafts'|'import_batches'|'calculation_snapshots', entityId:string, orgId:string):void {
 const found = db.prepare(`SELECT id FROM ${entityTable} WHERE id=? AND org_id=?`).get(entityId,orgId);
 if(!found) throw Object.assign(new Error('Not found in current organization'),{status:404});
}
export const now = ()=>new Date().toISOString();
export const uid = (p:string)=>p+'-'+crypto.randomUUID().slice(0,12);
export function audit(db:DB, orgId:string, kind:string, entityType:string, entityId:string, details:object={},actor=DEMO_USER):void {
 db.prepare('INSERT INTO audit_events VALUES(?,?,?,?,?,?,?,?)').run(uid('aud'),orgId,requestIdentity.getStore()?.actor||actor,now(),kind,entityType,entityId,JSON.stringify(details));
}
