import test from 'node:test';
import assert from 'node:assert/strict';
import {openDB} from '../src/db.ts';
import {seedDemo} from '../src/seed.ts';
import {stageCRMFixture,commitImport,importDetail,reportDraft,getReport} from '../src/service.ts';
import {reportCsv} from '../src/domain.ts';
import {DisconnectedCRMAdapter,FixtureCRMAdapter,crmConnectionStatus} from '../src/adapters.ts';

test('CRM adapter reports disconnected, while fixture is explicitly simulated and read-only',async()=>{
 const state=crmConnectionStatus();assert.equal(state.connected,false);assert.equal(state.status,'disconnected');
 assert.equal(state.fixture.connected,false);
 await assert.rejects(new DisconnectedCRMAdapter().readFullExport(),/No production CRM configured/);
 const adapter=new FixtureCRMAdapter();assert.equal(adapter.status,'fixture_only');
 const full=await adapter.readFullExport('full');
 assert.equal(full.source,'fixture');assert.equal(full.expectedRows,120);assert.match(full.notes,/NOT CONNECTED/);
 await assert.rejects(adapter.readFullExport('unknown' as any),/Unknown fixture export/);
});

test('simulated read-only export uses immutable staging, quarantine, and partial-export rejection',async()=>{
 const db=openDB(':memory:');seedDemo(db);
 const adapter=new FixtureCRMAdapter();
 const partial=stageCRMFixture(db,await adapter.readFullExport('partial'));
 assert.equal(partial.row_count,35);assert.equal(partial.expected_rows,120);
 assert.equal(partial.is_complete,0);assert.equal(partial.source_adapter,'crm_readonly');
 assert.throws(()=>commitImport(db,partial.id,{acceptQuarantine:true}),/Partial source export cannot replace/);
 const full=stageCRMFixture(db,await adapter.readFullExport('full'));
 assert.equal(full.row_count,120);assert.equal(full.quarantined,2);
 assert.equal(full.source_name,'Simulated CRM read-only export (not connected)');
 assert.equal(stageCRMFixture(db,await adapter.readFullExport('full')).id,full.id);
 assert.throws(()=>commitImport(db,full.id),/Quarantined rows require explicit/);
 const snap=commitImport(db,full.id,{acceptQuarantine:true});
 assert.equal(snap.batch_id,full.id);
 assert.equal(importDetail(db,full.id).status,'committed');
 const report=reportDraft(db,snap.id);const frozen=getReport(db,report.id);
 assert.equal(frozen.contents.source_adapter,'crm_readonly');
 assert.equal(frozen.contents.source_connection,'SIMULATED - NOT CONNECTED');
 assert.match(reportCsv(frozen),/SIMULATED - NOT CONNECTED/);
 const late=stageCRMFixture(db,await adapter.readFullExport('late'));
 assert.equal(late.row_count,121);assert.equal(late.is_complete,1);
 assert.throws(()=>db.prepare('UPDATE program_records SET event_date=? WHERE batch_id=?').run('2027-01-01',full.id),/Program records are immutable/);
 assert.throws(()=>stageCRMFixture(db,{...full},'other-org'),/Fixture adapter only available/);
 seedDemo(db);assert.equal((db.prepare('SELECT COUNT(*) n FROM source_datasets WHERE id=?').get('source-crm-readonly-fixture') as any).n,1);
 db.close();
});
