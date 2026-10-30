import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer,request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {openDB} from '../src/db.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
async function freePort(){const s=createServer();await new Promise<void>(ok=>s.listen(0,'127.0.0.1',ok));const port=(s.address() as any).port;await new Promise<void>(ok=>s.close(()=>ok()));return port;}
function call(port:number,method:string,route:string,body?:unknown,headers:Record<string,string>={}){
 return new Promise<{status:number,json:any,headers:any}>((ok,fail)=>{
  const payload=body===undefined?'':JSON.stringify(body);
  const req=request({hostname:'127.0.0.1',port,method,path:route,headers:{...(body===undefined?{}:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}),...headers}},r=>{
   let content='';r.setEncoding('utf8');r.on('data',x=>content+=x);r.on('end',()=>{let parsed:any=content;try{parsed=JSON.parse(content);}catch{}ok({status:r.statusCode||0,json:parsed,headers:r.headers});});
  });req.on('error',fail);req.end(payload);
 });
}
test('HTTP protected mode: sign-in, viewer/reviewer/admin authorization, CSRF, logout and cross-site rejection',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'cedar-auth-'));
 const port=await freePort(),pass='a-very-long-demo-password';
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--experimental-sqlite','--experimental-strip-types',path.join(root,'src/server.ts')],{
  cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',CEDAR_ADMIN_PASSWORD:'admin-'+pass,CEDAR_REVIEWER_PASSWORD:'reviewer-'+pass,CEDAR_VIEWER_PASSWORD:'viewer-'+pass},stdio:['ignore','pipe','pipe']
 });
 let stderr='';child.stderr.on('data',x=>stderr+=x.toString());
 try{
  let ready=false;
  for(let i=0;i<70;i++){
   if(child.exitCode!==null)break;
   try{if((await call(port,'GET','/api/auth/status')).status===200){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,70));
  }
  assert.equal(ready,true,stderr);
  assert.deepEqual((await call(port,'GET','/api/auth/status')).json,{enabled:true,mode:'role',authenticated:false,role:null,userId:null,orgId:null,availableRoles:['viewer','reviewer','admin'],csrfToken:null});
  assert.equal((await call(port,'GET','/api/bootstrap')).status,401);
  assert.equal((await call(port,'GET','/fixtures/program_export_120.csv')).status,401);
  assert.equal((await call(port,'GET','/')).status,200);
  assert.equal((await call(port,'POST','/api/auth/login',{role:'admin',password:'admin-'+pass},{Origin:'https://bad.example'})).status,403);
  assert.equal((await call(port,'POST','/api/auth/login',{role:'admin',password:'incorrect'})).status,401);
  async function session(role:'viewer'|'reviewer'|'admin'){
   const login=await call(port,'POST','/api/auth/login',{role,password:role+'-'+pass});
   assert.equal(login.status,200);
   assert.equal(login.json.role,role);
   const cookie=String(login.headers['set-cookie']?.[0]||'').split(';')[0];
   assert.match(cookie,/^cedar_session=[a-f0-9]{64}$/);
   assert.match(String(login.headers['set-cookie']?.[0]),/HttpOnly; SameSite=Strict/);
   return {cookie,csrf:login.json.csrfToken as string};
  }
  const viewer=await session('viewer');
  const v={Cookie:viewer.cookie,'X-Cedar-CSRF':viewer.csrf};
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Cookie:viewer.cookie})).status,200);
  const status=(await call(port,'GET','/api/auth/status',undefined,{Cookie:viewer.cookie})).json;
  assert.equal(status.role,'viewer');assert.equal(status.csrfToken,viewer.csrf);
  const bootstrap=(await call(port,'GET','/api/bootstrap',undefined,{Cookie:viewer.cookie})).json;
  const snapshotId=bootstrap.snapshot.snapshot.id;
  assert.equal((await call(port,'POST','/api/reports',{snapshotId},v)).status,403);
  assert.equal((await call(port,'POST','/api/reports',{snapshotId},{Cookie:viewer.cookie})).status,403);
  assert.equal((await call(port,'POST','/api/auth/logout',{},v)).status,200);
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Cookie:viewer.cookie})).status,401);
  const reviewer=await session('reviewer');
  const rv={Cookie:reviewer.cookie,'X-Cedar-CSRF':reviewer.csrf};
  assert.equal((await call(port,'POST','/api/reports',{snapshotId},rv)).status,201);
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'RESET DEMO'},rv)).status,403);
  assert.equal((await call(port,'POST','/api/config/obligations/placement-cohort/amend',{target:41,effectiveOn:'2026-10-29'},rv)).status,403);
  const admin=await session('admin');
  const av={Cookie:admin.cookie,'X-Cedar-CSRF':admin.csrf};
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'wrong'},av)).status,400);
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'RESET DEMO'},av)).status,200);
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'RESET DEMO'},{...av,Origin:'https://malicious.example'})).status,403);
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'RESET DEMO'},{...av,'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Host:'evil.example',Cookie:admin.cookie})).status,403);
 }finally{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});


test('named identities are org-bound, do not leak demo reports, and appear in audit attribution',async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'cedar-named-'));
 const file=path.join(dir,'named.sqlite');
 const db=openDB(file);
 db.prepare('INSERT INTO organizations(id,name,is_demo) VALUES(?,?,?)').run('partner-local','Fictional Partner',0);
 db.prepare('INSERT INTO grants VALUES(?,?,?,?,?,?,?,?)').run('partner-grant','partner-local','Partner Workforce Program','Partner Funder','CP-PARTNER','Partner Owner','2026-01-01','2026-12-31');
 db.close();
 const port=await freePort(),password='a-unique-local-password';
 const users=[
  {username:'demo-admin',role:'admin',orgId:'cedar-demo',password},
  {username:'partner-admin',role:'admin',orgId:'partner-local',password},
  {username:'partner-viewer',role:'viewer',orgId:'partner-local',password},
 ];
 const env={...process.env,DB_PATH:file,PORT:String(port),HOST:'127.0.0.1',CEDAR_USERS_JSON:JSON.stringify(users)};
 delete env.CEDAR_ADMIN_PASSWORD;delete env.CEDAR_VIEWER_PASSWORD;delete env.CEDAR_REVIEWER_PASSWORD;
 const child=spawn(process.execPath,['--disable-warning=ExperimentalWarning','--experimental-sqlite','--experimental-strip-types',path.join(root,'src/server.ts')],{cwd:dir,env,stdio:['ignore','pipe','pipe']});
 let stderr='';child.stderr.on('data',x=>stderr+=x.toString());
 try{
  let ready=false;
  for(let i=0;i<70;i++){
   if(child.exitCode!==null)break;
   try{if((await call(port,'GET','/api/auth/status')).status===200){ready=true;break;}}catch{}
   await new Promise(r=>setTimeout(r,70));
  }
  assert.equal(ready,true,stderr);
  const first=(await call(port,'GET','/api/auth/status')).json;
  assert.equal(first.mode,'named');assert.deepEqual(first.availableRoles,[]);
  assert.equal((await call(port,'POST','/api/auth/login',{username:'unknown',password})).status,401);
  async function session(username:string){
   const response=await call(port,'POST','/api/auth/login',{username,password});
   assert.equal(response.status,200,JSON.stringify(response.json));
   return {cookie:String(response.headers['set-cookie'][0]).split(';')[0],csrf:response.json.csrfToken,orgId:response.json.orgId};
  }
  const demo=await session('demo-admin');
  const partner=await session('partner-admin');
  const viewer=await session('partner-viewer');
  assert.equal(partner.orgId,'partner-local');
  const d=(await call(port,'GET','/api/bootstrap',undefined,{Cookie:demo.cookie})).json;
  const p=(await call(port,'GET','/api/bootstrap',undefined,{Cookie:partner.cookie})).json;
  assert.equal(d.grants.length,6);assert.equal(p.grants.length,1);
  assert.equal(p.organization.name,'Fictional Partner');
  assert.equal(p.snapshot,null);
  assert.equal((await call(port,'GET',`/api/snapshots/${d.snapshot.snapshot.id}`,undefined,{Cookie:partner.cookie})).status,404);
  assert.equal((await call(port,'GET','/fixtures/program_export_120.csv',undefined,{Cookie:partner.cookie})).status,404);
  assert.equal((await call(port,'POST','/api/demo/reset',{confirm:'RESET DEMO'},{Cookie:partner.cookie,'X-Cedar-CSRF':partner.csrf})).status,403);
  assert.equal((await call(port,'POST','/api/reports',{snapshotId:d.snapshot.snapshot.id},{Cookie:viewer.cookie,'X-Cedar-CSRF':viewer.csrf})).status,403);
  const draft=await call(port,'POST','/api/reports',{snapshotId:d.snapshot.snapshot.id},{Cookie:demo.cookie,'X-Cedar-CSRF':demo.csrf});
  assert.equal(draft.status,201);
  assert.equal((await call(port,'GET',`/api/reports/${draft.json.id}`,undefined,{Cookie:partner.cookie})).status,404);
  const verify=openDB(file);
  assert.equal((verify.prepare('SELECT actor FROM audit_events WHERE kind=? AND entity_id=?').get('report.drafted',draft.json.id) as any)?.actor,'demo-admin');
  verify.close();
  assert.equal((await call(port,'POST','/api/auth/logout',{}, {Cookie:partner.cookie,'X-Cedar-CSRF':partner.csrf})).status,200);
  assert.equal((await call(port,'GET','/api/bootstrap',undefined,{Cookie:partner.cookie})).status,401);
 }finally{child.kill('SIGTERM');rmSync(dir,{recursive:true,force:true});}
});
