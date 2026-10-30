import crypto from 'node:crypto';
import type {IncomingMessage} from 'node:http';

type Role='viewer'|'reviewer'|'admin';
type Session={role:Role,csrf:string,expires:number};
const names:Role[]=['viewer','reviewer','admin'];
const configured=new Map<Role,string>();
for(const role of names){
 const password=process.env[`CEDAR_${role.toUpperCase()}_PASSWORD`];
 if(password!==undefined){
  if(password.length<12||password.length>256)throw Error(`CEDAR_${role.toUpperCase()}_PASSWORD must be 12–256 characters`);
  configured.set(role,crypto.createHash('sha256').update(password).digest('hex'));
 }
}
if(configured.size&&!configured.has('admin'))throw Error('Protected mode requires CEDAR_ADMIN_PASSWORD');
const sessions=new Map<string,Session>();
const failures=new Map<string,{count:number,until:number}>();
const TTL=8*60*60*1000;
const COOKIE='cedar_session';
const digest=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');
function sameHex(a:string,b:string){return crypto.timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export const authEnabled=configured.size>0;
export function currentSession(req:IncomingMessage):Session|null{
 if(!authEnabled)return {role:'admin',csrf:'',expires:Infinity};
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
 return {enabled:authEnabled,authenticated:!!session,role:session?.role||null,availableRoles:[...configured.keys()],csrfToken:authEnabled?session?.csrf||null:null};
}
export function login(req:IncomingMessage,role:unknown,password:unknown){
 if(!authEnabled)throw Object.assign(Error('Login not enabled'),{status:400});
 const client=req.socket.remoteAddress||'loopback';
 const rate=failures.get(client);
 if(rate&&rate.count>=6&&rate.until>Date.now())throw Object.assign(Error('Too many attempts; retry later'),{status:429});
 const wanted=typeof role==='string'&&names.includes(role as Role)?role as Role:null;
 const supplied=typeof password==='string'?password:'';
 const actual=wanted?configured.get(wanted):undefined;
 const acceptable=digest(supplied);
 const valid=!!actual&&sameHex(actual,acceptable);
 if(!valid){
  const count=(rate&&rate.until>Date.now()?rate.count:0)+1;
  failures.set(client,{count,until:Date.now()+15*60*1000});
  throw Object.assign(Error('Invalid credentials'),{status:401});
 }
 failures.delete(client);
 const token=crypto.randomBytes(32).toString('hex');
 const session:Session={role:wanted!,csrf:crypto.randomBytes(32).toString('hex'),expires:Date.now()+TTL};
 sessions.set(digest(token),session);
 return {cookie:`${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL/1000}`,role:session.role,csrfToken:session.csrf};
}
export function logout(req:IncomingMessage){
 const cookie=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
 const token=cookie?.slice(COOKIE.length+1);
 if(token&&/^[a-f0-9]{64}$/.test(token))sessions.delete(digest(token));
 return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
export function checkAccess(req:IncomingMessage,method:string,url:string){
 const session=currentSession(req);
 if(!session)throw Object.assign(Error('Sign in required'),{status:401});
 if(method!=='POST')return session;
 if(authEnabled){
  const supplied=String(req.headers['x-cedar-csrf']||'');
  if(!/^[a-f0-9]{64}$/.test(supplied)||!sameHex(supplied,session.csrf))throw Object.assign(Error('CSRF token missing or invalid'),{status:403});
 }
 if(url==='/api/auth/logout')return session;
 const adminOnly=url==='/api/demo/reset'||url.startsWith('/api/config/')||/^\/api\/imports\/[\w-]+\/commit$/.test(url);
 const minRole:Role=adminOnly?'admin':url==='/api/imports/stage'||url==='/api/reports'||/^\/api\/alerts\//.test(url)?'reviewer':'admin';
 if(names.indexOf(session.role)<names.indexOf(minRole))throw Object.assign(Error('Role not permitted for this operation'),{status:403});
 return session;
}
