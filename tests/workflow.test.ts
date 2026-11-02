import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer, request as httpRequest} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=(name:string)=>readFileSync(path.join(project,'fixtures',name),'utf8');
async function freePort():Promise<number>{
 const server=createServer();
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const p=(server.address() as any).port;
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 return p;
}
function call(port:number,method:string,url:string,body?:unknown):Promise<{status:number;body:string}>{
 return new Promise((resolve,reject)=>{
  const serialized=body===undefined?'':JSON.stringify(body);
  const req=httpRequest({hostname:'127.0.0.1',port,method,path:url,
   headers:body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(serialized)}},res=>{
   const chunks:Buffer[]=[];
   res.on('data',chunk=>chunks.push(Buffer.from(chunk)));
   res.on('end',()=>resolve({status:res.statusCode||0,body:Buffer.concat(chunks).toString('utf8')}));
  });
  req.on('error',reject);req.end(serialized);
 });
}
const sha256=(body:string)=>createHash('sha256').update(body,'utf8').digest('hex');

test('complete HTTP workflow: recover from partial import, approve exceptions, publish, verify and export',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'cedar-workflow-'));
 const port=await freePort();
 const env={...process.env,PORT:String(port),HOST:'127.0.0.1',DB_PATH:path.join(dir,'cedar.sqlite')};
 for(const key of ['CEDAR_USERS_JSON','CEDAR_ADMIN_PASSWORD','CEDAR_REVIEWER_PASSWORD','CEDAR_VIEWER_PASSWORD'])delete env[key];
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--experimental-sqlite','--experimental-strip-types',path.join(project,'src/server.ts')],
  {cwd:dir,env,stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',chunk=>{stderr+=(chunk.toString()).slice(0,1000);});
 try{
  let ready=false;
  for(let n=0;n<70;n++){
   if(child.exitCode!==null)break;
   try{if((await call(port,'GET','/api/bootstrap')).status===200){ready=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,70));
  }
  assert.equal(ready,true,`server should become healthy: ${stderr.slice(0,400)}`);
  const initial=JSON.parse((await call(port,'GET','/api/bootstrap')).body);
  const priorSnapshot=initial.snapshot.snapshot.id;
  const priorDraft=await call(port,'POST','/api/reports',{snapshotId:priorSnapshot});
  assert.equal(priorDraft.status,201);
  const priorDraftId=JSON.parse(priorDraft.body).id;
  const originalExport=(await call(port,'GET',`/api/reports/${priorDraftId}/export`)).body;
  assert.equal(JSON.parse(originalExport).obligations.find((o:any)=>o.key==='jobs-placements').achieved,23);

  // An incomplete export can be staged and reviewed, but never replace the current portfolio.
  const partial=await call(port,'POST','/api/imports/stage',{
   csv:fixture('partial_export_35_of_120.csv'),sourceAsOf:'2026-10-29',expectedRows:120});
  assert.equal(partial.status,201);
  const partialData=JSON.parse(partial.body);
  assert.equal(partialData.is_complete,0);
  const blocked=await call(port,'POST',`/api/imports/${partialData.id}/commit`,{acceptQuarantine:true,asOf:'2026-10-29'});
  assert.equal(blocked.status,409);
  assert.match(blocked.body,/Partial source export/);
  assert.equal(JSON.parse((await call(port,'GET','/api/bootstrap')).body).snapshot.snapshot.id,priorSnapshot);

  // A late full export must be explicitly accepted because it contains quarantined source rows.
  const fullCsv=fixture('late_arrival_full_export_121.csv');
  const full=await call(port,'POST','/api/imports/stage',{csv:fullCsv,sourceAsOf:'2026-10-29',expectedRows:121});
  assert.equal(full.status,201);
  const batch=JSON.parse(full.body);
  assert.equal(batch.row_count,121);
  assert.equal(batch.quarantined,2);
  assert.equal(batch.is_complete,1);
  assert.equal((await call(port,'POST',`/api/imports/${batch.id}/commit`,{asOf:'2026-10-29'})).status,409);
  const preview=await call(port,'GET',`/api/preview/jobs-placements?batch=${batch.id}&asOf=2026-10-29`);
  assert.equal(preview.status,200);
  assert.equal(JSON.parse(preview.body).achieved,24);
  const published=await call(port,'POST',`/api/imports/${batch.id}/commit`,{acceptQuarantine:true,asOf:'2026-10-29'});
  assert.equal(published.status,201);
  const newSnapshot=JSON.parse(published.body).id;
  assert.notEqual(newSnapshot,priorSnapshot);
  const retry=await call(port,'POST',`/api/imports/${batch.id}/commit`,{acceptQuarantine:true,asOf:'2026-10-29'});
  assert.equal(JSON.parse(retry.body).id,newSnapshot,'retry must be idempotent');
  const current=JSON.parse((await call(port,'GET','/api/bootstrap')).body);
  assert.equal(current.snapshot.snapshot.id,newSnapshot);
  assert.equal(current.snapshot.totals.find((t:any)=>t.obligation_key==='jobs-placements').achieved,24);
  const verified=JSON.parse((await call(port,'GET',`/api/snapshots/${newSnapshot}/verify`)).body);
  assert.equal(verified.verified,true);
  const comparison=JSON.parse((await call(port,'GET',`/api/snapshots/${priorSnapshot}/compare/${newSnapshot}`)).body);
  assert.equal(comparison.verified,true);
  assert.equal((await call(port,'GET',`/api/reports/${priorDraftId}/export`)).body,originalExport,'old report bytes must remain unchanged');

  const draft=await call(port,'POST','/api/reports',{snapshotId:newSnapshot});
  assert.equal(draft.status,201);
  const reportId=JSON.parse(draft.body).id;
  const [json,csv,manifestResponse]=await Promise.all([
   call(port,'GET',`/api/reports/${reportId}/export`),
   call(port,'GET',`/api/reports/${reportId}/export.csv`),
   call(port,'GET',`/api/reports/${reportId}/manifest`),
  ]);
  for(const response of [json,csv,manifestResponse])assert.equal(response.status,200);
  const report=JSON.parse(json.body),manifest=JSON.parse(manifestResponse.body);
  assert.equal(report.snapshot_id,newSnapshot);
  assert.equal(report.obligations.find((o:any)=>o.key==='jobs-placements').achieved,24);
  assert.equal(manifest.exports.json.sha256,sha256(json.body));
  assert.equal(manifest.exports.csv.sha256,sha256(csv.body));
  assert.equal(manifest.exports.csv.bytes,Buffer.byteLength(csv.body));
  assert.equal((await call(port,'GET','/api/bootstrap')).status,200);
 }finally{
  child.kill('SIGTERM');
  await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve(null);child.once('exit',resolve);setTimeout(resolve,500);});
  rmSync(dir,{recursive:true,force:true});
 }
});

test('browser commit uses selected source date and exposes actionable failure state',()=>{
 const code=readFileSync(path.join(project,'public/app.js'),'utf8');
 assert.match(code,/id="commit-asof"/);
 assert.match(code,/getField\('commit-asof'\)/);
 assert.match(code,/id="commit-error"/);
 assert.doesNotMatch(code,/asOf:getField\('source-asof'\)\|\|new Date\(\)/);
});
