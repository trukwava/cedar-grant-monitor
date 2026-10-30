import {lateArrivalCsv,partialCsv,sampleCsv,AS_OF} from './fixtures.ts';
import {csvParse} from './domain.ts';

/** A provider adapter may read a full upstream export but never write to a CRM.
 * External implementations must be separately configured and reviewed. */
export type ReadOnlyExport={
 source:'fixture';fixtureId:'full'|'partial'|'late';sourceAsOf:string;
 expectedRows:number;csv:string;notes:string;
};
export interface ReadOnlyCRMAdapter {
 readonly status:'fixture_only'|'disconnected';
 readFullExport(kind:'full'|'partial'|'late'):Promise<ReadOnlyExport>;
}
export class DisconnectedCRMAdapter implements ReadOnlyCRMAdapter {
 readonly status='disconnected' as const;
 async readFullExport():Promise<ReadOnlyExport>{
  throw Object.assign(Error('No production CRM configured; no remote data was fetched'),{status:503});
 }
}
/** Deterministic synthetic fixture; never contacts an external service. */
export class FixtureCRMAdapter implements ReadOnlyCRMAdapter {
 readonly status='fixture_only' as const;
 async readFullExport(kind:'full'|'partial'|'late'):Promise<ReadOnlyExport>{
  if(!['full','partial','late'].includes(kind))throw Object.assign(Error('Unknown fixture export'),{status:400});
  const csv=kind==='full'?sampleCsv():kind==='partial'?partialCsv():lateArrivalCsv();
  // Fixture row counts are asserted to guard accidental fixture drift.
  const count=csvParse(csv).length-1;
  const expected=kind==='partial'?120:kind==='late'?121:120;
  if(count!==(kind==='partial'?35:expected))throw Error('Synthetic CRM fixture count mismatch');
  return {source:'fixture',fixtureId:kind,sourceAsOf:AS_OF,expectedRows:expected,csv,
   notes:`SIMULATED, NOT CONNECTED: deterministic ${kind} synthetic read-only CRM export`};
 }
}
export const crmConnectionStatus=()=>({provider:'crm',status:'disconnected' as const,connected:false,
 fixture:{status:'simulated' as const,connected:false,available:['full','partial','late']}});
