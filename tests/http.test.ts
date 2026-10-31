import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort():Promise<number>{
 const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));
 const port=(listener.address() as any).port;await new Promise<void>(r=>listener.close(()=>r()));return port;
}
function call(port:number,method:string,url:string,body?:unknown,headers:Record<string,string>={}){
 return new Promise<{status:number;body:string;headers:any}>((resolve,reject)=>{
  const text=body===undefined?'':JSON.stringify(body);
  const req=httpRequest({hostname:'127.0.0.1',port,method,path:url,headers:{...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}),...headers}},res=>{
   let payload='';res.setEncoding('utf8');res.on('data',chunk=>payload+=chunk);res.on('end',()=>resolve({status:res.statusCode||0,body:payload,headers:res.headers}));
  });req.on('error',reject);req.end(text);
 });
}
test('HTTP: immutable draft CSV reconciles to JSON; untrusted Host and Origin rejected',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'cedar-http-'));const port=await freePort();
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--experimental-sqlite','--experimental-strip-types',path.join(root,'src/server.ts')],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',(b)=>stderr+=b.toString());
 try{
  let ready=false;
  for(let i=0;i<60;i++){
   if(child.exitCode!==null)break;
   try{if((await call(port,'GET','/api/bootstrap')).status===200){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,75));
  }
  assert.equal(ready,true,'server should start '+stderr.slice(0,500));
  const bootstrap=JSON.parse((await call(port,'GET','/api/bootstrap')).body);
  assert.equal(bootstrap.grants.length,6);
  const historicalVerify=await call(port,'GET',`/api/snapshots/${bootstrap.snapshot.snapshot.id}/verify`);
  assert.equal(historicalVerify.status,200);
  assert.equal(JSON.parse(historicalVerify.body).verified,true);
  assert.ok(bootstrap.snapshotHistory.length>=2);
  const earlier=bootstrap.snapshotHistory.find((s:any)=>s.id!==bootstrap.snapshot.snapshot.id);
  const compareHttp=await call(port,'GET',`/api/snapshots/${earlier.id}/compare/${bootstrap.snapshot.snapshot.id}`);
  assert.equal(compareHttp.status,200);
  const comparison=JSON.parse(compareHttp.body);
  assert.equal(comparison.verified,true);
  assert.ok(comparison.changes.some((x:any)=>!x.comparable));
  assert.equal((await call(port,'GET',`/api/snapshots/${earlier.id}/compare/not-real`)).status,404);
  assert.equal((await call(port,'GET',`/api/snapshots/${earlier.id}/compare/${earlier.id}`)).status,400);
  const snapshotId=bootstrap.snapshot.snapshot.id;
  const created=await call(port,'POST','/api/reports',{snapshotId});assert.equal(created.status,201);
  const reportId=JSON.parse(created.body).id;
  const json=await call(port,'GET',`/api/reports/${reportId}/export`);
  const csv=await call(port,'GET',`/api/reports/${reportId}/export.csv`);
  assert.equal(json.status,200);assert.equal(csv.status,200);
  const manifestResponse=await call(port,'GET',`/api/reports/${reportId}/manifest`);
  assert.equal(manifestResponse.status,200);
  const manifest=JSON.parse(manifestResponse.body);
  assert.equal(manifest.schema,'cedar.report-export-manifest.v1');
  const sha256=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
  assert.equal(manifest.exports.json.sha256,sha256(json.body));
  assert.equal(manifest.exports.csv.sha256,sha256(csv.body));
  assert.equal(manifest.exports.csv.bytes,Buffer.byteLength(csv.body));
  assert.equal(manifest.snapshot_id,snapshotId);
  assert.match(manifest.note,/not a digital signature/);
  assert.equal((await call(port,'GET','/api/reports/not-a-report/manifest')).status,404);

  assert.match(String(csv.headers['content-type']),/^text\/csv/);
  assert.equal(csv.body.split('\n').filter(Boolean).length,13);
  assert.ok(csv.body.includes(snapshotId));
  const draft=JSON.parse(json.body);
  assert.equal(draft.snapshot_id,snapshotId);
  assert.equal(draft.obligations.length,12);
  for(const obligation of draft.obligations){assert.ok(csv.body.includes(obligation.definition_version));}
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Host:'attacker.example'})).status,403);
  assert.equal((await call(port,'POST','/api/reports',{snapshotId},{Origin:'https://attacker.example'})).status,403);
  const invalid=await call(port,'POST','/api/imports/stage',{csv:'external_id,participant_id,program_code,event_type,event_date,status,evidence_ref\n\"r1\"junk,P1,CP-JOBS,placement,2026-10-29,verified,EV1',sourceAsOf:'2026-10-29',expectedRows:1});
  assert.equal(invalid.status,400);assert.match(invalid.body,/Malformed CSV quoting/);
  const oversized=await call(port,'POST','/api/imports/stage',{csv:'x'.repeat(2_100_200),sourceAsOf:'2026-10-29'});
  assert.equal(oversized.status,413);
  assert.equal((await call(port,'GET','/api/bootstrap')).status,200);
 }finally{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
