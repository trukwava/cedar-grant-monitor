import test from 'node:test';
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
  const snapshotId=bootstrap.snapshot.snapshot.id;
  const created=await call(port,'POST','/api/reports',{snapshotId});assert.equal(created.status,201);
  const reportId=JSON.parse(created.body).id;
  const json=await call(port,'GET',`/api/reports/${reportId}/export`);
  const csv=await call(port,'GET',`/api/reports/${reportId}/export.csv`);
  assert.equal(json.status,200);assert.equal(csv.status,200);
  assert.match(String(csv.headers['content-type']),/^text\/csv/);
  assert.equal(csv.body.split('\n').filter(Boolean).length,13);
  assert.ok(csv.body.includes(snapshotId));
  const draft=JSON.parse(json.body);
  assert.equal(draft.snapshot_id,snapshotId);
  assert.equal(draft.obligations.length,12);
  for(const obligation of draft.obligations){assert.ok(csv.body.includes(obligation.definition_version));}
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Host:'attacker.example'})).status,403);
  assert.equal((await call(port,'POST','/api/reports',{snapshotId},{Origin:'https://attacker.example'})).status,403);
 }finally{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
