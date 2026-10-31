import http, {type IncomingMessage,type ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openDB,DEMO_ORG,withIdentity} from './db.ts';
import {reportCsv} from './domain.ts';
import {crmConnectionStatus,FixtureCRMAdapter} from './adapters.ts';
import {status as authStatus,login as authLogin,logout as authLogout,checkAccess} from './auth.ts';
import {seedDemo,resetDemo,writeFixtures} from './seed.ts';
import {dashboard,stageImport,stageCRMFixture,commitImport,importDetail,snapshotDetail,verifySnapshot,compareSnapshots,previewMetric,alertAction,reportDraft,getReport,createAmendment,createGrantDraft,previewDraft,enableDraft} from './service.ts';
const db=openDB();seedDemo(db);writeFixtures(path.resolve('fixtures'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const port=Number(process.env.PORT||4173),host=process.env.HOST||'127.0.0.1';
if(!['127.0.0.1','localhost'].includes(host))throw Error('Cedar demo must bind to a loopback host only');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be a valid TCP port');
const csp="default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
function send(res:ServerResponse,status:number,body:string|object,contentType='application/json; charset=utf-8',extra:Record<string,string>={}){
 res.writeHead(status,{'Content-Type':contentType,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':csp,'Referrer-Policy':'no-referrer',...extra});
 res.end(typeof body==='string'?body:JSON.stringify(body));
}
function parseJson(req:IncomingMessage):Promise<any>{return new Promise((resolve,reject)=>{
 let size=0,settled=false;const chunks:Buffer[]=[];
 req.on('data',chunk=>{
  if(settled)return;
  size+=chunk.length;
  if(size>2_100_000){
   settled=true;chunks.length=0;
   // Respond 413 rather than destroying the socket and hiding the failure.
   reject(Object.assign(Error('Request exceeds 2.1MB'),{status:413}));
   req.resume();return;
  }
  chunks.push(chunk);
 });
 req.on('end',()=>{if(settled)return;settled=true;
  try{const text=Buffer.concat(chunks).toString('utf8');resolve(text?JSON.parse(text):{});}
  catch{reject(Object.assign(Error('Invalid JSON'),{status:400}));}
 });
 req.on('error',e=>{if(!settled){settled=true;reject(e);}});
});}
function match(url:string,re:RegExp):string[]|null {const m=url.match(re);return m?m.slice(1).map(decodeURIComponent):null;}
async function router(req:IncomingMessage,res:ServerResponse){
 const u=new URL(req.url||'/',`http://${host}:${port}`),url=u.pathname,method=req.method||'GET';
 try{
  if(!new Set([`${host}:${port}`,`127.0.0.1:${port}`,`localhost:${port}`]).has(req.headers.host||''))throw Object.assign(Error('Host not permitted for local demo'),{status:403});
  // Authentication is optional in synthetic-only mode; protected mode uses an ephemeral server-side session.
  if(method==='GET'&&url==='/api/auth/status')return send(res,200,authStatus(req));
  if(method==='POST'){
   const origin=req.headers.origin;
   if(origin&&origin!==`http://${req.headers.host}`)throw Object.assign(Error('Cross-origin write rejected'),{status:403});
   if(req.headers['sec-fetch-site']==='cross-site')throw Object.assign(Error('Cross-site write rejected'),{status:403});
   if(!['application/json','application/json; charset=utf-8'].includes(req.headers['content-type']||''))throw Object.assign(Error('Expected application/json'),{status:415});
   if(url==='/api/auth/login'){const body=await parseJson(req);const result=authLogin(req,body.role,body.password,body.username);if(!db.prepare('SELECT id FROM organizations WHERE id=?').get(result.identity.orgId))throw Object.assign(Error('Account organization not configured'),{status:403});return send(res,200,{authenticated:true,role:result.identity.role,userId:result.identity.userId,orgId:result.identity.orgId,csrfToken:result.csrfToken},undefined,{'Set-Cookie':result.cookie});}
  }
  // The application shell has no private data; all API and fixture access is checked server-side.
  const session=(url.startsWith('/api/')||url.startsWith('/fixtures/'))?checkAccess(req,method,url):null;
  if(session&&!db.prepare('SELECT id FROM organizations WHERE id=?').get(session.orgId))throw Object.assign(Error('Account organization not configured'),{status:403});
  return await withIdentity({actor:session?.userId||'anonymous',orgId:session?.orgId||DEMO_ORG},async()=>{
  if(url.startsWith('/fixtures/')&&session?.orgId!==DEMO_ORG)throw Object.assign(Error('Demo fixture not available to this organization'),{status:404});
  if(method==='POST'&&url==='/api/auth/logout'){return send(res,200,{authenticated:false},undefined,{'Set-Cookie':authLogout(req)});}
  if(method==='GET'&&url==='/api/adapters/status')return send(res,200,crmConnectionStatus());
  if(method==='GET'&&url==='/api/bootstrap')return send(res,200,dashboard(db));
  if(method==='GET'&&match(url,/^\/api\/imports\/([\w-]+)$/))return send(res,200,importDetail(db,match(url,/^\/api\/imports\/([\w-]+)$/)![0]));
  if(method==='GET'&&match(url,/^\/api\/snapshots\/([\w-]+)\/compare\/([\w-]+)$/)){
   const [fromId,toId]=match(url,/^\/api\/snapshots\/([\w-]+)\/compare\/([\w-]+)$/)!;
   return send(res,200,compareSnapshots(db,fromId,toId));
  }
  if(method==='GET'&&match(url,/^\/api\/snapshots\/([\w-]+)\/verify$/))return send(res,200,verifySnapshot(db,match(url,/^\/api\/snapshots\/([\w-]+)\/verify$/)![0]));
  if(method==='GET'&&match(url,/^\/api\/snapshots\/([\w-]+)$/))return send(res,200,snapshotDetail(db,match(url,/^\/api\/snapshots\/([\w-]+)$/)![0]));
  if(method==='GET'&&match(url,/^\/api\/preview\/([\w-]+)$/)){
   const key=match(url,/^\/api\/preview\/([\w-]+)$/)![0],batch=u.searchParams.get('batch'),asOf=u.searchParams.get('asOf')||'2026-10-29';
   if(!batch)throw Object.assign(Error('Missing batch query parameter'),{status:400});
   return send(res,200,previewMetric(db,key,batch,asOf));
  }
  if(method==='GET'&&match(url,/^\/api\/reports\/([\w-]+)\/manifest$/)){
   const report=getReport(db,match(url,/^\/api\/reports\/([\w-]+)\/manifest$/)![0]);
   const json=JSON.stringify(report.contents,null,2);
   const csv=reportCsv(report);
   const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
   return send(res,200,{schema:'cedar.report-export-manifest.v1',report_id:report.id,
    snapshot_id:report.contents.snapshot_id,as_of:report.contents.as_of,
    exports:{json:{sha256:digest(json),bytes:Buffer.byteLength(json)},csv:{sha256:digest(csv),bytes:Buffer.byteLength(csv)}},
    note:'Checksums verify exported bytes only; this manifest is not a digital signature or independent proof of data authenticity.'});
  }
  if(method==='GET'&&match(url,/^\/api\/reports\/([\w-]+)\/export\.csv$/)){
   const report=getReport(db,match(url,/^\/api\/reports\/([\w-]+)\/export\.csv$/)![0]);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="cedar-draft-${report.id}.csv"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':csp});
   return res.end(reportCsv(report));
  }
  if(method==='GET'&&match(url,/^\/api\/reports\/([\w-]+)\/export$/)){
   const report=getReport(db,match(url,/^\/api\/reports\/([\w-]+)\/export$/)![0]);
   res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':`attachment; filename="cedar-draft-${report.id}.json"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
   return res.end(JSON.stringify(report.contents,null,2));
  }
  if(method==='GET'&&match(url,/^\/api\/reports\/([\w-]+)$/))return send(res,200,getReport(db,match(url,/^\/api\/reports\/([\w-]+)$/)![0]));
  if(method==='POST'){
   if(!['application/json','application/json; charset=utf-8'].includes(req.headers['content-type']||''))throw Object.assign(Error('Expected application/json'),{status:415});
   // Same-origin local demo only; requests from unrelated web origins are never authorized.
   const body=await parseJson(req);
   if(url==='/api/adapters/fixture/stage'){
    if(session?.orgId!==DEMO_ORG)throw Object.assign(Error('Fixture adapter is Cedar demo only'),{status:403});
    const kind=body.kind;
    if(!['full','partial','late'].includes(kind))throw Object.assign(Error('Unknown synthetic fixture'),{status:400});
    const exported=await new FixtureCRMAdapter().readFullExport(kind);
    return send(res,201,stageCRMFixture(db,exported));
   }
   if(url==='/api/imports/stage')return send(res,201,stageImport(db,{csv:String(body.csv||''),sourceAsOf:String(body.sourceAsOf||''),expectedRows:body.expectedRows,notes:body.notes}));
   if(match(url,/^\/api\/imports\/([\w-]+)\/commit$/))return send(res,201,commitImport(db,match(url,/^\/api\/imports\/([\w-]+)\/commit$/)![0],{acceptQuarantine:body.acceptQuarantine===true,asOf:body.asOf}));
   if(match(url,/^\/api\/alerts\/([\w-]+)\/(acknowledge|assign|snooze|resolve)$/)){
    const [id,action]=match(url,/^\/api\/alerts\/([\w-]+)\/(acknowledge|assign|snooze|resolve)$/)!;
    return send(res,200,alertAction(db,id,action,body));
   }
   if(url==='/api/config/grants')return send(res,201,createGrantDraft(db,{name:body.name,funder:body.funder,programCode:body.programCode,owner:body.owner,startsOn:body.startsOn,endsOn:body.endsOn,reportDueOn:body.reportDueOn,unit:body.unit,eventType:body.eventType,target:Number(body.target),needsEvidence:body.needsEvidence===true}));
   if(url==='/api/config/preview')return send(res,200,previewDraft(db,String(body.key||''),String(body.batchId||''),String(body.asOf||'')));
   if(match(url,/^\/api\/config\/obligations\/([\w-]+)\/enable$/))return send(res,200,enableDraft(db,match(url,/^\/api\/config\/obligations\/([\w-]+)\/enable$/)![0]));
   if(url==='/api/reports')return send(res,201,reportDraft(db,String(body.snapshotId||'')));
   if(match(url,/^\/api\/config\/obligations\/([\w-]+)\/amend$/))return send(res,201,createAmendment(db,match(url,/^\/api\/config\/obligations\/([\w-]+)\/amend$/)![0],{target:Number(body.target),effectiveOn:String(body.effectiveOn||''),owner:body.owner}));
   if(url==='/api/demo/reset'){
    if(session?.orgId!==DEMO_ORG)throw Object.assign(Error('Demo reset is only available to the synthetic demo organization'),{status:403});
    if(body.confirm!=='RESET DEMO')throw Object.assign(Error('Type RESET DEMO to reset only the synthetic organization'),{status:400});
    resetDemo(db);seedDemo(db);return send(res,200,{ok:true,message:'Synthetic demo restored; other organizations unchanged.'});
   }
  }
  if(method==='GET' && ['/','/index.html','/app.js','/styles.css'].includes(url)){
   const file=path.join(root,url==='/'?'index.html':url.slice(1));
   const type=url.endsWith('.js')?'text/javascript; charset=utf-8':url.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8';
   return send(res,200,fs.readFileSync(file,'utf8'),type);
  }
  if(method==='GET'&&match(url,/^\/fixtures\/(program_export_120|partial_export_35_of_120|late_arrival_full_export_121|spring_completed_period_40)\.csv$/)){
   const filename=path.basename(url);return send(res,200,fs.readFileSync(path.resolve('fixtures',filename),'utf8'),'text/csv; charset=utf-8');
  }
  return send(res,404,{error:'Not found'});
  });
 }catch(e:any){console.error('Request error:',e?.message);if(!res.headersSent)send(res,e.status||500,{error:e.status?e.message:'Internal error; operation not completed'});}
}
export const server=http.createServer(router);
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 server.listen(port,host,()=>console.log(`Cedar Pathways demo running at http://${host}:${port} (local only)`));
 const shutdown=()=>{server.close();db.close();};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
