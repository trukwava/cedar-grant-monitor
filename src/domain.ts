export type CountingUnit='distinct_people'|'attendance_instances'|'enrollments'|'completions'|'placements';
export type AlertState='open'|'acknowledged'|'snoozed'|'resolved';
export type RecordInput={external_id:string;participant_id:string;program_code:string;event_type:string;event_date:string;status:string;evidence_ref:string};
export const HEADERS=['external_id','participant_id','program_code','event_type','event_date','status','evidence_ref'] as const;
export const VALID_EVENTS=['placement','attendance','enrollment','completion','coaching'];
export const VALID_STATUSES=['verified','pending','void'];
export function dayOffset(a:string,b:string):number { return Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000); }
export function inclusiveDays(a:string,b:string):number {return Math.max(1,dayOffset(b,a)+1);}
export function linearBaseline(target:number,start:string,end:string,asOf:string):number {
 const elapsed=Math.max(0,Math.min(inclusiveDays(start,end),dayOffset(asOf,start)+1));
 return Math.round((target*elapsed/inclusiveDays(start,end))*100)/100;
}
export function csvParse(text:string):string[][] {
 if(text.length>2_000_000)throw Object.assign(new Error('CSV exceeds 2MB limit'),{status:413});
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){
  const c=text[i]; if(quoted){ if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"') {if(cell!=='')throw Error('Malformed CSV quote');quoted=true;}
  else if(c===','){row.push(cell);cell='';}
  else if(c==='\n'){row.push(cell.replace(/\r$/,''));if(row.some(x=>x!==''))rows.push(row);row=[];cell='';}
  else cell+=c;
 }
 if(quoted)throw Error('Unclosed CSV quote');
 row.push(cell.replace(/\r$/,''));if(row.some(x=>x!==''))rows.push(row);
 if(rows.length>10001)throw Object.assign(new Error('CSV exceeds 10,000 rows'),{status:413});
 return rows;
}
export function csvEscape(s:unknown):string { const str=String(s??'');return /[",\r\n]/.test(str)?'"'+str.replace(/"/g,'""')+'"':str; }
export function writeCsv(rows:Record<string,unknown>[]):string {if(!rows.length)return '';const keys=Object.keys(rows[0]);return [keys.join(','),...rows.map(row=>keys.map(key=>csvEscape(row[key])).join(','))].join('\n')+'\n';}
export function validateDate(s:string):boolean {if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;let date=new Date(s+'T00:00:00Z');return !Number.isNaN(+date)&&date.toISOString().slice(0,10)===s;}
export function validateRecord(r:RecordInput, knownCodes:Set<string>, seen:Set<string>):string[] {
 const errors:string[]=[];
 if(!/^[-_a-zA-Z0-9]{1,80}$/.test(r.external_id))errors.push('invalid_external_id');
 if(!/^[-_a-zA-Z0-9]{1,80}$/.test(r.participant_id))errors.push('invalid_participant_id');
 if(!knownCodes.has(r.program_code))errors.push('unmapped_program_code');
 if(!VALID_EVENTS.includes(r.event_type))errors.push('unknown_event_type');
 if(!VALID_STATUSES.includes(r.status))errors.push('unknown_status');
 if(!validateDate(r.event_date))errors.push('invalid_event_date');
 if(seen.has(r.external_id))errors.push('duplicate_external_id'); else if(r.external_id)seen.add(r.external_id);
 if(r.evidence_ref.length>120)errors.push('evidence_reference_too_long');
 return errors;
}
export function countUnit(records:RecordInput[],unit:CountingUnit):{count:number;included:string[];sourceCount:number;duplicates:number}{
 const seen=new Set<string>(),included:string[]=[];let duplicate=0;
 for(const r of records){const key=(unit==='distinct_people'||unit==='placements')?r.participant_id:r.external_id;
  if(seen.has(key)){duplicate++;continue;} seen.add(key);included.push(r.external_id);
 }
 return {count:seen.size,included,sourceCount:records.length,duplicates:duplicate};
}
export function safeRef(s:string):string {return /^[A-Za-z0-9_-]{1,120}$/.test(s)?s:'[unavailable]';}

/** One row per obligation, pinned to the same immutable draft used by the JSON export.
 * Spreadsheet-dangerous *text* is prefixed with a quote to prevent formula execution. */
export function reportCsv(report:{contents:any}):string {
 const source=report.contents;
 const base={report_status:source.kind,as_of:source.as_of,snapshot_timestamp:source.snapshot_timestamp,
  snapshot_id:source.snapshot_id,source_sha256:source.source_sha256,source_batch:source.source_batch,
  source_export_as_of:source.source_export_as_of,source_rows:source.source_rows,
  quarantined_rows:source.quarantined_rows};
 const spreadsheetText=(v:unknown):string=>{
  const s=String(v??'');return /^[\s]*[=+@-]/.test(s)?"'"+s:s;
 };
 const rows=source.obligations.map((ob:any)=>({...base,obligation_key:spreadsheetText(ob.key),
  grant:spreadsheetText(ob.grant),period:spreadsheetText(ob.period),metric:spreadsheetText(ob.metric),
  counting_unit:ob.counting_unit,definition_version:ob.definition_version,
  target:ob.target,achieved:ob.achieved,linear_pacing_baseline:ob.pacing_assumption,
  evidence_missing_count:ob.evidence_missing.length,
  missing_evidence_refs:spreadsheetText(ob.evidence_missing.join(';')),
  included_record_count:ob.records.length,included_record_refs:spreadsheetText(ob.records.join(';')),
  exception_count:ob.exceptions.length,exceptions_json:spreadsheetText(JSON.stringify(ob.exceptions))}));
 return writeCsv(rows);
}
