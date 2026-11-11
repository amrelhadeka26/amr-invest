// ZD Business HQ, private authentication, storage and calendar integration.
// All /hq routes fail closed unless an allowed Google account has authenticated.
const CLIENT_ID = "322859135457-3prdc4b02hm4d1piguamdve1pbs2anf1.apps.googleusercontent.com";
const OWNER = "amrelhadeka@gmail.com";
const ALLOWED_ACCOUNTS = new Set([OWNER, "amr@amrelhadeka.com"]);
const ORIGIN = "https://invest.amrelhadeka.com";
const CALLBACK = ORIGIN + "/hq/auth/callback";
const SESSION_NAME = "zd_hq_session";
const OAUTH_NAME = "zd_hq_oauth";
const te = new TextEncoder();
const td = new TextDecoder();
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), c => c.charCodeAt(0));
const cookies = req => Object.fromEntries((req.headers.get("Cookie") || "").split(";").map(x => x.trim().split(/=(.*)/s).slice(0,2)).filter(x => x.length===2).map(([k,v])=>[k,decodeURIComponent(v)]));
const cookie = (n,v,maxAge) => n+"="+encodeURIComponent(v)+"; Path=/hq; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge;
const htmlHeaders = {"Cache-Control":"private, no-store", "X-Robots-Tag":"noindex, nofollow", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer"};
const redirect = (to,setCookies=[]) => {const h=new Headers({...htmlHeaders,Location:to});for(const v of setCookies)h.append("Set-Cookie",v);return new Response(null,{status:302,headers:h})};
const json = (data,status=200) => new Response(JSON.stringify(data),{status,headers:{...htmlHeaders,"Content-Type":"application/json; charset=utf-8"}});
async function hmac(value,secret) {
  const key=await crypto.subtle.importKey("raw",te.encode("zd-hq-v1|"+secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC",key,te.encode(value))));
}
async function verifySig(value,sig,secret) {
  if(!sig)return false;
  const expected=await hmac(value,secret);
  if(expected.length!==sig.length)return false;
  let diff=0;for(let i=0;i<sig.length;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);
  return diff===0;
}
async function signSession(sub,email,secret) {
  const payload=b64(te.encode(JSON.stringify({sub,email,exp:Math.floor(Date.now()/1000)+604800})));
  return payload+"."+await hmac("session|"+payload,secret);
}
async function sessionUser(req,env) {
  const value=cookies(req)[SESSION_NAME]||"";
  const i=value.lastIndexOf(".");if(i<0)return null;
  const p=value.slice(0,i);
  if(!await verifySig("session|"+p,value.slice(i+1),env.GOOGLE_CLIENT_SECRET||""))return null;
  try {const data=JSON.parse(td.decode(unb64(p)));return data.exp>Date.now()/1000 && ALLOWED_ACCOUNTS.has(data.email) && data.sub ? data : null}catch{return null}
}
function params(mode,state) {
  const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:CALLBACK,response_type:"code",scope:mode==="calendar"?"openid email profile https://www.googleapis.com/auth/calendar":"openid email profile",state,access_type:"offline",prompt:mode==="calendar"?"consent":"select_account"});
  return "https://accounts.google.com/o/oauth2/v2/auth?"+q.toString();
}
async function startOAuth(mode,env) {
  const state=b64(crypto.getRandomValues(new Uint8Array(24)));
  const v=mode+"."+state;
  const signed=v+"."+await hmac("oauth|"+v,env.GOOGLE_CLIENT_SECRET);
  return redirect(params(mode,state),[cookie(OAUTH_NAME,signed,600)]);
}
async function exchange(code,env) {
  const body=new URLSearchParams({grant_type:"authorization_code",client_id:CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,redirect_uri:CALLBACK,code});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",body,headers:{"Content-Type":"application/x-www-form-urlencoded"}});
  if(!r.ok)throw Error("Google token exchange failed: "+r.status);
  return r.json();
}
async function googleProfile(access_token) {
  const r=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+access_token}});
  if(!r.ok)throw Error("Google identity verification failed");
  const u=await r.json();
  if(!ALLOWED_ACCOUNTS.has(u.email) || u.email_verified!==true || !u.sub)throw Error("This Google account is not authorized");
  return u;
}
async function aesKey(env) {
  const dig=await crypto.subtle.digest("SHA-256",te.encode("zd-hq-calendar-tokens|"+env.GOOGLE_CLIENT_SECRET));
  return crypto.subtle.importKey("raw",dig,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function seal(value,env) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},await aesKey(env),te.encode(JSON.stringify(value)));
  return b64(iv)+"."+b64(new Uint8Array(cipher));
}
async function unseal(value,env) {
  const [a,b]=value.split(".");return JSON.parse(td.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:unb64(a)},await aesKey(env),unb64(b))));
}
async function calendarRow(env) {return env.DB.prepare("SELECT encrypted, calendar_id FROM hq_google_tokens WHERE account=?").bind(OWNER).first()}
async function calendarToken(env) {
  const row=await calendarRow(env);if(!row)return null;
  const tok=await unseal(row.encrypted,env);
  if((tok.expires_at||0)>Date.now()+60000)return {access_token:tok.access_token,calendar_id:row.calendar_id};
  if(!tok.refresh_token)throw Error("Calendar authorization expired, reconnect Google Calendar");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tok.refresh_token,grant_type:"refresh_token"})});
  if(!r.ok)throw Error("Calendar token refresh failed, reconnect Google Calendar");
  const value=await r.json();
  tok.access_token=value.access_token;tok.expires_at=Date.now()+(value.expires_in||3600)*1000;
  await env.DB.prepare("UPDATE hq_google_tokens SET encrypted=?, updated_at=datetime('now') WHERE account=?").bind(await seal(tok,env),OWNER).run();
  return {access_token:tok.access_token,calendar_id:row.calendar_id};
}
async function gcal(token,path,method="GET",body) {
  const r=await fetch("https://www.googleapis.com/calendar/v3"+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
  if(!r.ok) {const data=await r.text();throw Error("Google Calendar "+r.status+": "+data.slice(0,240))}
  if(r.status===204)return null;
  return r.json();
}
async function listWritableCalendars(token) {
  let items=[], pageToken="";
  do {
    const suffix=pageToken?"&pageToken="+encodeURIComponent(pageToken):"";
    const page=await gcal(token,"/users/me/calendarList?maxResults=250"+suffix);
    items.push(...(page.items||[]));
    pageToken=page.nextPageToken||"";
  }while(pageToken && items.length<1000);
  return items.filter(x=>["owner","writer"].includes(x.accessRole) && !x.deleted)
    .map(x=>({id:x.id,name:x.summary||x.id,primary:!!x.primary,accessRole:x.accessRole}));
}
async function ensureCalendar(env,token,existing) {
  // Never choose a calendar or create a new one without an explicit owner selection.
  if(!existing)throw Error("Choose a Google Calendar in HQ before syncing dated actions");
  return existing;
}
const nextDate = date => {const d=new Date(date+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)};
async function syncCalendar(env,doc) {
  const session=await calendarToken(env);if(!session)return {connected:false};
  const cid=await ensureCalendar(env,session.access_token,session.calendar_id);
  const existing=(await env.DB.prepare("SELECT task_id,event_id,digest,calendar_id FROM hq_calendar_events").all()).results||[];
  const old=new Map(existing.map(x=>[x.task_id,x]));
  const planned=new Map();
  for(const [i,t] of (doc.tasks||[]).entries()) {
    if(i>499)break;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(t.due||"") || ["Done","Paused"].includes(t.status))continue;
    const id=String(t.id||"task-"+i+"-"+t.name).slice(0,180);
    planned.set(id,t);
    const digest=JSON.stringify([t.name,t.due,t.notes||"",t.priority||""]);
    const prev=old.get(id);
    if(prev?.digest===digest && prev.calendar_id===cid)continue;
    const event={summary:"ZD HQ | "+String(t.name).slice(0,180),description:"Priority: "+(t.priority||"")+"\\n"+(t.notes||""),start:{date:t.due},end:{date:nextDate(t.due)}};
    const onSameCalendar=prev && prev.calendar_id===cid;
    const path="/calendars/"+encodeURIComponent(cid)+"/events"+(onSameCalendar?"/"+encodeURIComponent(prev.event_id):"");
    const result=await gcal(session.access_token,path,onSameCalendar?"PATCH":"POST",event);
    if(prev && !onSameCalendar){
      // Only remove an HQ-tracked event, never any other event on the old calendar.
      try {await gcal(session.access_token,"/calendars/"+encodeURIComponent(prev.calendar_id)+"/events/"+encodeURIComponent(prev.event_id),"DELETE")}
      catch(err){if(!String(err).includes("404"))throw err}
    }
    await env.DB.prepare("INSERT INTO hq_calendar_events(task_id,event_id,calendar_id,digest) VALUES(?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET event_id=excluded.event_id,calendar_id=excluded.calendar_id,digest=excluded.digest").bind(id,result.id,cid,digest).run();
  }
  for(const e of existing)if(!planned.has(e.task_id)) {
    try {await gcal(session.access_token,"/calendars/"+encodeURIComponent(e.calendar_id)+"/events/"+encodeURIComponent(e.event_id),"DELETE")}catch(err){if(!String(err).includes("404"))throw err}
    await env.DB.prepare("DELETE FROM hq_calendar_events WHERE task_id=?").bind(e.task_id).run();
  }
  return {connected:true,synced:planned.size,calendarId:cid};
}
async function callback(req,env) {
  const url=new URL(req.url);
  const v=cookies(req)[OAUTH_NAME]||"";
  const [mode,state,sig]=v.split(".");
  if(!["login","calendar"].includes(mode)||!state||url.searchParams.get("state")!==state||!await verifySig("oauth|"+mode+"."+state,sig,env.GOOGLE_CLIENT_SECRET))return new Response("Invalid or expired Google sign-in request",{status:403,headers:htmlHeaders});
  if(!url.searchParams.has("code"))return new Response("Google authorization was cancelled",{status:400,headers:htmlHeaders});
  try {
    const tok=await exchange(url.searchParams.get("code"),env);
    const profile=await googleProfile(tok.access_token);
    if(mode==="calendar"){
      if(profile.email!==OWNER)return redirect(ORIGIN+"/hq/?calendar=owner-only",[cookie(OAUTH_NAME,"",0),cookie(SESSION_NAME,await signSession(profile.sub,profile.email,env.GOOGLE_CLIENT_SECRET),604800)]);
      const prev=await calendarRow(env);
      let prior={};if(prev)try{prior=await unseal(prev.encrypted,env)}catch{}
      const stored={access_token:tok.access_token,refresh_token:tok.refresh_token||prior.refresh_token,expires_at:Date.now()+(tok.expires_in||3600)*1000};
      if(!stored.refresh_token)throw Error("Google did not return Calendar refresh permission");
      await env.DB.prepare("INSERT INTO hq_google_tokens(account,encrypted,calendar_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(account) DO UPDATE SET encrypted=excluded.encrypted,updated_at=excluded.updated_at").bind(OWNER,await seal(stored,env),null).run();
    }
    const ses=await signSession(profile.sub,profile.email,env.GOOGLE_CLIENT_SECRET);
    return redirect(ORIGIN+"/hq/"+(mode==="calendar"?"?calendar=connected":""),[cookie(SESSION_NAME,ses,604800),cookie(OAUTH_NAME,"",0)]);
  }catch(e){return new Response("ZD HQ Google login: "+String(e.message||e),{status:401,headers:{...htmlHeaders,"Content-Type":"text/plain; charset=utf-8"}})}
}
export async function onRequest(context) {
  const {request:req,env}=context;
  const url=new URL(req.url),path=url.pathname;
  if(!(path==="/hq" || path.startsWith("/hq/")))return context.next();
  if(!env.GOOGLE_CLIENT_SECRET || !env.DB)return new Response("ZD HQ private access is not configured",{status:503,headers:htmlHeaders});
  if(path==="/hq/auth/login" && req.method==="GET")return startOAuth("login",env);
  if(path==="/hq/auth/callback" && req.method==="GET")return callback(req,env);
  const user=await sessionUser(req,env);
  if(!user){
    if(path.startsWith("/hq/api/"))return json({error:"Unauthorized"},401);
    return redirect(ORIGIN+"/hq/auth/login");
  }
  if(path==="/hq/auth/logout")return redirect(ORIGIN+"/hq/auth/login",[cookie(SESSION_NAME,"",0)]);
  if(path==="/hq/auth/calendar" && req.method==="GET"){if(user.email!==OWNER)return redirect(ORIGIN+"/hq/?calendar=owner-only");return startOAuth("calendar",env)}
  if(path==="/hq")return redirect(ORIGIN+"/hq/");
  if(path.startsWith("/hq/api/")) {
    if(req.method!=="GET" && (req.headers.get("Origin")||ORIGIN)!==ORIGIN)return json({error:"Origin rejected"},403);
    try {
      if(path==="/hq/api/me" && req.method==="GET")return json({email:user.email,canManageCalendar:user.email===OWNER});
      if(path==="/hq/api/data" && req.method==="GET"){
        const row=await env.DB.prepare("SELECT data FROM hq_documents WHERE id=?").bind("main").first();
        return json({data:row?JSON.parse(row.data):null});
      }
      if(path==="/hq/api/data" && req.method==="POST"){
        if(Number(req.headers.get("Content-Length")||0)>1000000)return json({error:"Request too large"},413);
        const data=await req.json();
        if(!data || !Array.isArray(data.tasks) || !Array.isArray(data.kpis) || !Array.isArray(data.ideas) || !Array.isArray(data.decisions))return json({error:"Invalid dashboard document"},400);
        const body=JSON.stringify(data);if(body.length>1000000)return json({error:"Request too large"},413);
        await env.DB.prepare("INSERT INTO hq_documents(id,data,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind("main",body).run();
        let calendar=null;try{calendar=await syncCalendar(env,data)}catch(e){calendar={warning:String(e.message||e)}}
        return json({saved:true,calendar});
      }
      if(path==="/hq/api/calendar/status" && req.method==="GET"){
        const row=await calendarRow(env);
        return json({connected:!!row,calendarId:row?.calendar_id||null,canManageCalendar:user.email===OWNER});
      }
      if(path==="/hq/api/calendar/list" && req.method==="GET"){
        if(user.email!==OWNER)return json({error:"Only the primary owner may choose a calendar"},403);
        const session=await calendarToken(env);
        if(!session)return json({error:"Connect Google Calendar first"},400);
        return json({calendars:await listWritableCalendars(session.access_token),selectedId:session.calendar_id});
      }
      if(path==="/hq/api/calendar/select" && req.method==="POST"){
        if(user.email!==OWNER)return json({error:"Only the primary owner may choose a calendar"},403);
        const session=await calendarToken(env);
        if(!session)return json({error:"Connect Google Calendar first"},400);
        const payload=await req.json();
        if(typeof payload?.calendarId!=="string"||payload.calendarId.length>300)return json({error:"Invalid calendar selection"},400);
        const options=await listWritableCalendars(session.access_token);
        const chosen=options.find(c=>c.id===payload.calendarId);
        if(!chosen)return json({error:"Calendar not found or not writable"},400);
        await env.DB.prepare("UPDATE hq_google_tokens SET calendar_id=?,updated_at=datetime('now') WHERE account=?").bind(chosen.id,OWNER).run();
        const row=await env.DB.prepare("SELECT data FROM hq_documents WHERE id=?").bind("main").first();
        let sync=null;
        if(row){try{sync=await syncCalendar(env,JSON.parse(row.data))}catch(e){sync={warning:String(e.message||e)}}}
        return json({selectedId:chosen.id,selectedName:chosen.name,sync});
      }
      if(path==="/hq/api/calendar/sync" && req.method==="POST"){
        const row=await env.DB.prepare("SELECT data FROM hq_documents WHERE id=?").bind("main").first();
        return json(row?await syncCalendar(env,JSON.parse(row.data)):{error:"No dashboard data to sync"},row?200:400);
      }
      if(path==="/hq/api/calendar/disconnect" && req.method==="POST"){
        if(user.email!==OWNER)return json({error:"Only primary owner may disconnect calendar"},403);
        await env.DB.prepare("DELETE FROM hq_google_tokens WHERE account=?").bind(OWNER).run();
        return json({disconnected:true});
      }
      return json({error:"Unknown HQ API route"},404);
    }catch(e){return json({error:String(e.message||e)},500)}
  }
  const response=await context.next();
  const headers=new Headers(response.headers);
  for(const [k,v] of Object.entries(htmlHeaders))headers.set(k,v);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}