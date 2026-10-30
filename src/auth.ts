import crypto from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import {DEMO_ORG,DEMO_USER} from './db.ts';

export type Role='viewer'|'reviewer'|'admin';
export type Identity={role:Role;orgId:string;userId:string};
type Session=Identity&{csrf:string;expires:number};
type NamedAccount=Identity&{salt:Buffer;key:Buffer};
const names:Role[]=['viewer','reviewer','admin'];
const configured=new Map<Role,string>();
for(const role of names){
 const password=process.env[`CEDAR_${role.toUpperCase()}_PASSWORD`];
 if(password!==undefined){
  if(password.length<12||password.length>256)throw Error(`CEDAR_${role.toUpperCase()}_PASSWORD must be 12–256 characters`);
  configured.set(role,crypto.createHash('sha256').update(password).digest('hex'));
 }
}
if(configured.size&&!configured.has('admin'))throw Error('Protected role mode requires CEDAR_ADMIN_PASSWORD');
const named=new Map<string,NamedAccount>();
if(process.env.CEDAR_USERS_JSON){
 if(configured.size)throw Error('Configure named accounts OR role passwords, not both');
 let users:unknown;
 try{users=JSON.parse(process.env.CEDAR_USERS_JSON);}catch{throw Error('CEDAR_USERS_JSON must contain valid JSON');}
 if(!Array.isArray(users)||users.length===0||users.length>50)throw Error('CEDAR_USERS_JSON must contain 1–50 accounts');
 for(const entry of users){
  const u=entry as Record<string,unknown>;
  if(!u||typeof u.username!=='string'||!/^[a-zA-Z0-9_.-]{3,48}$/.test(u.username)||
   typeof u.orgId!=='string'||!/^[a-zA-Z0-9_-]{3,64}$/.test(u.orgId)||
   !names.includes(u.role as Role)||typeof u.password!=='string'||u.password.length<12||u.password.length>256)
   throw Error('Invalid named account: username, orgId, role and a 12–256-character password required');
  const username=u.username.toLowerCase();if(named.has(username))throw Error('Duplicate named account');
  const salt=crypto.randomBytes(16);
  named.set(username,{userId:username,orgId:u.orgId,role:u.role as Role,salt,key:crypto.scryptSync(u.password,salt,32)});
 }
}
const namedMode=named.size>0;
const sessions=new Map<string,Session>();
const failures=new Map<string,{count:number,until:number}>();
const TTL=8*60*60*1000;
const COOKIE='cedar_session';
const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
function sameHex(a:string,b:string){return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export const authEnabled=namedMode||configured.size>0;
export function currentSession(req:IncomingMessage):Session|null{
 if(!authEnabled)return {role:'admin',orgId:DEMO_ORG,userId:DEMO_USER,csrf:'',expires:Infinity};
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const token=cookie?.slice(COOKIE.length+1);
 if(!token||!/^[a-f0-9]{64}$/.test(token))return null;
 const key=digest(token), session=sessions.get(key);
 if(!session)return null;
 if(session.expires<Date.now()){sessions.delete(key);return null;}
 return session;
}
export function status(req:IncomingMessage){
 const session=currentSession(req);
 return {enabled:authEnabled,mode:namedMode?'named':configured.size?'role':'demo',authenticated:!!session,
  role:session?.role||null,userId:session?.userId||null,orgId:session?.orgId||null,
  availableRoles:namedMode?[]:[...configured.keys()],csrfToken:authEnabled?session?.csrf||null:null};
}
export function login(req:IncomingMessage,role:unknown,password:unknown,username?:unknown){
 if(!authEnabled)throw Object.assign(Error('Login not enabled'),{status:400});
 const client=req.socket.remoteAddress||'loopback';const rate=failures.get(client);
 if(rate&&rate.count>=6&&rate.until>Date.now())throw Object.assign(Error('Too many attempts; retry later'),{status:429});
 const supplied=typeof password==='string'?password:'';
 let identity:Identity|null=null;
 if(namedMode){
  const uname=typeof username==='string'?username.toLowerCase():'';
  const account=named.get(uname);
  // Always derive a key, including for unknown users, to reduce timing distinctions.
  const salt=account?.salt||Buffer.alloc(16);
  const expected=account?.key||Buffer.alloc(32);
  const actual=crypto.scryptSync(supplied,salt,32);
  if(account&&crypto.timingSafeEqual(expected,actual))identity={role:account.role,orgId:account.orgId,userId:account.userId};
 }else{
  const wanted=typeof role==='string'&&names.includes(role as Role)?role as Role:null;
  const actual=wanted?configured.get(wanted):undefined;
  if(actual&&sameHex(actual,digest(supplied)))identity={role:wanted!,orgId:DEMO_ORG,userId:`role-${wanted}`};
 }
 if(!identity){const count=(rate&&rate.until>Date.now()?rate.count:0)+1;failures.set(client,{count,until:Date.now()+15*60*1000});throw Object.assign(Error('Invalid credentials'),{status:401});}
 failures.delete(client);
 const token=crypto.randomBytes(32).toString('hex');
 const session:Session={...identity,csrf:crypto.randomBytes(32).toString('hex'),expires:Date.now()+TTL};
 sessions.set(digest(token),session);
 return {cookie:`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL/1000}`,identity,csrfToken:session.csrf};
}
export function logout(req:IncomingMessage){
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const token=cookie?.slice(COOKIE.length+1);
 if(token&&/^[a-f0-9]{64}$/.test(token))sessions.delete(digest(token));
 return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
export function checkAccess(req:IncomingMessage,method:string,url:string):Session{
 const session=currentSession(req);
 if(!session)throw Object.assign(Error('Sign in required'),{status:401});
 if(method!=='POST')return session;
 if(authEnabled){
  const supplied=String(req.headers['x-cedar-csrf']||'');
  if(!/^[a-f0-9]{64}$/.test(supplied)||!sameHex(supplied,session.csrf))throw Object.assign(Error('CSRF token missing or invalid'),{status:403});
 }
 if(url==='/api/auth/logout')return session;
 const adminOnly=url==='/api/demo/reset'||url.startsWith('/api/config/')||/^\/api\/imports\/[\w-]+\/commit$/.test(url);
 const minRole:Role=adminOnly?'admin':(url==='/api/imports/stage'||url==='/api/adapters/fixture/stage')||url==='/api/reports'||/^\/api\/alerts\//.test(url)?'reviewer':'admin';
 if(names.indexOf(session.role)<names.indexOf(minRole))throw Object.assign(Error('Role not permitted for this operation'),{status:403});
 return session;
}
