import {writeCsv,type RecordInput} from './domain.ts';
export const AS_OF='2026-10-29';
export const SOURCE_CODES=['CP-JOBS','CP-DIGITAL','CP-BRIDGE','CP-NEIGHBOR','CP-TECH','CP-ADULT'];
export const GRANTS=[
 {id:'grant-jobs',name:'Career Launch',funder:'Metro Workforce Fund',program_code:'CP-JOBS',owner:'Grants Lead'},
 {id:'grant-digital',name:'Digital Skills Lab',funder:'Future Skills Trust',program_code:'CP-DIGITAL',owner:'Program Director'},
 {id:'grant-bridge',name:'Bridge to Work',funder:'Opportunity Foundation',program_code:'CP-BRIDGE',owner:'Career Services'},
 {id:'grant-neighbor',name:'Neighborhood Pathways',funder:'Community Futures',program_code:'CP-NEIGHBOR',owner:'Operations Lead'},
 {id:'grant-tech',name:'Tech Returnship',funder:'Inclusive Tech Fund',program_code:'CP-TECH',owner:'Data Manager'},
 {id:'grant-adult',name:'Adult Workforce Access',funder:'City Employment Initiative',program_code:'CP-ADULT',owner:'Program Analyst'},
] as const;
export const OBLIGATIONS=[
 {key:'jobs-placements',grant:'grant-jobs',unit:'placements',event:'placement',target:40,evidence:true},
 {key:'jobs-attendance',grant:'grant-jobs',unit:'attendance_instances',event:'attendance',target:20,evidence:false},
 {key:'digital-completions',grant:'grant-digital',unit:'completions',event:'completion',target:18,evidence:true},
 {key:'digital-enrollments',grant:'grant-digital',unit:'enrollments',event:'enrollment',target:25,evidence:false},
 {key:'bridge-placements',grant:'grant-bridge',unit:'placements',event:'placement',target:16,evidence:true},
 {key:'bridge-attendance',grant:'grant-bridge',unit:'attendance_instances',event:'attendance',target:25,evidence:false},
 {key:'neighbor-enrollments',grant:'grant-neighbor',unit:'enrollments',event:'enrollment',target:24,evidence:false},
 {key:'neighbor-attendance',grant:'grant-neighbor',unit:'attendance_instances',event:'attendance',target:28,evidence:false},
 {key:'tech-completions',grant:'grant-tech',unit:'completions',event:'completion',target:12,evidence:true},
 {key:'tech-placements',grant:'grant-tech',unit:'placements',event:'placement',target:18,evidence:true},
 {key:'adult-attendance',grant:'grant-adult',unit:'attendance_instances',event:'attendance',target:32,evidence:false},
 {key:'adult-people',grant:'grant-adult',unit:'distinct_people',event:'coaching',target:20,evidence:true},
] as const;
export function baseRecords():RecordInput[] {
 const data:RecordInput[]=[];
 // Exactly 25 qualifying placement source records, including 2 repeat people, resulting in 23 distinct placements.
 for(let i=1;i<=25;i++)data.push({
   external_id:'JOB-'+String(i).padStart(3,'0'),
   participant_id:'PERSON-'+String(i<=23?i:i-23).padStart(3,'0'),
   program_code:'CP-JOBS',event_type:'placement',event_date:'2026-10-'+String(1+(i%28)).padStart(2,'0'),status:'verified',evidence_ref:'EVID-JOB-'+i,
 });
 const programs=SOURCE_CODES.slice(1);const events=['attendance','enrollment','completion','placement','coaching'];
 for(let i=0;i<95;i++){
   const program=programs[i%programs.length];
   const event=events[Math.floor(i/5)%events.length];
   const day=1+(i%27);
   data.push({external_id:'ACT-'+String(i+1).padStart(3,'0'),participant_id:'PERSON-'+String(100+Math.floor(i/2)).padStart(3,'0'),program_code:program,event_type:event,event_date:'2026-10-'+String(day).padStart(2,'0'),status:i%19===0?'pending':'verified',evidence_ref:i%11===0?'':'EVID-ACT-'+(i+1)});
 }
 // Reconciliation edge cases are attached to the non-placement fixture records.
 data[108].external_id=data[107].external_id; // duplicate external record identifier, row quarantined
 data[111].program_code='CP-UNKNOWN'; // unmapped code, row quarantined
 data[115].event_date='2026-09-20';data[115].evidence_ref='LATE-ARRIVING-OUTCOME';
 return data;
}
export function sampleCsv():string{return writeCsv(baseRecords());}
export function springRecords():RecordInput[]{
 const values:RecordInput[]=[];
 for(let i=1;i<=40;i++){
  const program=i<=14?'CP-JOBS':i<=24?'CP-DIGITAL':'CP-BRIDGE';
  const event=i<=14?'placement':i<=24?'completion':'attendance';
  values.push({external_id:'SPR-'+String(i).padStart(3,'0'),participant_id:'SPR-P'+String(i<=24?i:i%5+25),program_code:program,event_type:event,event_date:'2026-05-'+String(1+i%27).padStart(2,'0'),status:'verified',evidence_ref:'SPR-EVID-'+i});
 }
 return values;
}
export function springCsv():string{return writeCsv(springRecords());}
export function partialCsv():string{return writeCsv(baseRecords().slice(0,35));}
export function lateArrivalCsv():string{
 return writeCsv([...baseRecords(),{external_id:'JOB-026',participant_id:'PERSON-024',program_code:'CP-JOBS',event_type:'placement',event_date:'2026-10-10',status:'verified',evidence_ref:'LATE-PLACEMENT-NEW'}]);
}
export const EXPECTED={grants:6,obligations:12,reportingWindowsPerGrant:3,records:120,placementSourceRecords:25,placementPeople:23,baselineAtDay45:20,quarantined:2};
