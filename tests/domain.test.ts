import test from 'node:test';
import assert from 'node:assert/strict';
import {csvParse,reportCsv,countUnit,linearBaseline,validateDate} from '../src/domain.ts';
import {baseRecords} from '../src/fixtures.ts';
test('exact placement example: 25 qualifying records, 23 distinct people',()=>{
 const p=baseRecords().filter(r=>r.program_code==='CP-JOBS'&&r.event_type==='placement');
 const counted=countUnit(p,'placements');assert.equal(p.length,25);assert.equal(counted.count,23);assert.equal(counted.duplicates,2);
});
test('attendance can count repeat people but distinct person metric cannot',()=>{
 const rows=[{external_id:'E1',participant_id:'P1'},{external_id:'E2',participant_id:'P1'}] as any;
 assert.equal(countUnit(rows,'attendance_instances').count,2);assert.equal(countUnit(rows,'distinct_people').count,1);
});
test('day 45 of inclusive 90 day period, target 40 => baseline 20',()=>{
 assert.equal(linearBaseline(40,'2026-09-15','2026-12-13','2026-10-29'),20);
 assert.equal(linearBaseline(40,'2026-09-15','2026-12-13','2026-09-14'),0);
 assert.equal(linearBaseline(40,'2026-09-15','2026-12-13','2026-12-31'),40);
});
test('CSV parser keeps quoted commas, escaped quotes and embedded line breaks',()=>{
 assert.deepEqual(csvParse('a,b\n"x,y","quote ""one"""\n"line\nbreak",ok\n'),[['a','b'],['x,y','quote "one"'],['line\nbreak','ok']]);
});
test('rejects impossible calendar dates',()=>{assert.equal(validateDate('2026-02-30'),false);assert.equal(validateDate('2026-10-29'),true);});


test('CSV report is pinned to draft fields and guards against formula injection',()=>{
 const r={contents:{kind:'DRAFT',as_of:'2026-10-29',snapshot_timestamp:'2026-10-29T12:00:00Z',snapshot_id:'snap-1',source_sha256:'abc',source_batch:'batch-1',source_export_as_of:'2026-10-28',source_rows:120,quarantined_rows:2,obligations:[{key:'=HYPERLINK("bad")',grant:'Cedar',period:'Autumn',metric:'placement',counting_unit:'distinct_people',definition_version:'ov1',target:40,achieved:23,pacing_assumption:20,evidence_missing:['e1'],records:['r1','r2'],exceptions:['excluded']}]}};
 const csv=reportCsv(r);
 assert.match(csv,/snapshot_timestamp,snapshot_id,source_sha256/);
 assert.match(csv,/2026-10-29T12:00:00Z,snap-1,abc/);
 assert.ok(csv.includes("'=HYPERLINK"));
 assert.match(csv,/,40,23,20,1,e1,2,r1;r2,1,/);
});
