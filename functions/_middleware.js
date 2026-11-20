// ZD. Business HQ (built by Claude): private Google sign-in, D1 storage and Google Calendar.
// All /hq routes fail closed unless an allowed Google account has authenticated.
const CLIENT_ID = "322859135457-3prdc4b02hm4d1piguamdve1pbs2anf1.apps.googleusercontent.com";
const OWNER = "amrelhadeka@gmail.com";
const CALENDAR_MANAGER = "amr@amrelhadeka.com";
const ALLOWED_ACCOUNTS = new Set([OWNER, CALENDAR_MANAGER]);
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
  const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:CALLBACK,response_type:"code",scope:mode==="calendar"?"openid email profile https://www.googleapis.com/auth/calendar":"openid email profile",state,access_type:"offline",prompt:mode==="calendar"?"consent select_account":"select_account"});
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
async function googleProfile(access_token,anyAccount=false) {
  const r=await fetch("https://openidconnect.googleapis.com/v1/userinfo",{headers:{Authorization:"Bearer "+access_token}});
  if(!r.ok)throw Error("Google identity verification failed");
  const u=await r.json();
  if((!anyAccount&&!ALLOWED_ACCOUNTS.has(u.email)) || u.email_verified!==true || !u.sub)throw Error("This Google account is not authorized");
  return u;
}
// Money plan tool (/plan): open to the owners plus paying clients listed in plan_clients, each for 90 days.
const PLAN_SESSION="zd_plan_session";
const PLAN_DAYS=90;
const cookieP=(n,v,maxAge)=>n+"="+encodeURIComponent(v)+"; Path=/plan; HttpOnly; Secure; SameSite=Lax; Max-Age="+maxAge;
async function planTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS plan_clients(email TEXT PRIMARY KEY,name TEXT,added_at TEXT NOT NULL,expires_at TEXT NOT NULL)").run()}
async function planAllowed(env,email){if(ALLOWED_ACCOUNTS.has(email))return {owner:true};await planTable(env);
  const r=await env.DB.prepare("SELECT name,expires_at FROM plan_clients WHERE email=? AND expires_at>datetime('now')").bind(String(email||"").toLowerCase()).first();return r||null}
async function planUser(req,env){const value=cookies(req)[PLAN_SESSION]||"";const i=value.lastIndexOf(".");if(i<0)return null;const p=value.slice(0,i);
  if(!await verifySig("session|"+p,value.slice(i+1),env.GOOGLE_CLIENT_SECRET||""))return null;
  try{const d=JSON.parse(td.decode(unb64(p)));return d.exp>Date.now()/1000&&d.sub?d:null}catch{return null}}
function planPage(title,msg,status){return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Money plan</title><style>body{margin:0;font:17px/1.6 system-ui,sans-serif;color:#1D1D1F;background:#fff;display:grid;place-items:center;min-height:100vh;padding:24px}main{max-width:460px}h1{font-size:28px;line-height:1.15}a{color:#1D1D1F;font-weight:600}</style></head><body><main><h1>'+title+'</h1><p>'+msg+'</p></main></body></html>',{status,headers:{...htmlHeaders,"Content-Type":"text/html; charset=utf-8"}})}
async function planRoute(context,env,req,path){
  if(path==="/plan/login")return startOAuth("plan",env);
  const u=await planUser(req,env);
  if(!u)return redirect(ORIGIN+"/plan/login");
  if(path==="/plan/logout")return redirect(ORIGIN+"/",[cookieP(PLAN_SESSION,"",0)]);
  const ok=await planAllowed(env,u.email);
  if(!ok)return planPage("Your access has ended","Your 3 months of access to the money plan tool are over, or this Google account ("+u.email.replace(/[<>&"]/g,"")+") isn’t on the list. To renew, book a follow-up session with Amr: <a href=\"https://invest.amrelhadeka.com/\">invest.amrelhadeka.com</a>. <br><br><a href=\"/plan/logout\">Sign in with another account</a>",403);
  if(path==="/plan")return redirect(ORIGIN+"/plan/");
  const response=await context.next();const headers=new Headers(response.headers);for(const [k,v] of Object.entries(htmlHeaders))headers.set(k,v);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
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
async function calendarRow(env) {await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_google_tokens(account TEXT PRIMARY KEY,encrypted TEXT NOT NULL,calendar_id TEXT,updated_at TEXT)").run();return env.DB.prepare("SELECT encrypted, calendar_id FROM hq_google_tokens WHERE account=?").bind(CALENDAR_MANAGER).first()}
async function calendarToken(env) {
  const row=await calendarRow(env);if(!row)return null;
  const tok=await unseal(row.encrypted,env);
  if((tok.expires_at||0)>Date.now()+60000)return {access_token:tok.access_token,calendar_id:row.calendar_id};
  if(!tok.refresh_token)throw Error("Calendar authorization expired, reconnect Google Calendar");
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({client_id:CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:tok.refresh_token,grant_type:"refresh_token"})});
  if(!r.ok)throw Error("Calendar token refresh failed, reconnect Google Calendar");
  const value=await r.json();
  tok.access_token=value.access_token;tok.expires_at=Date.now()+(value.expires_in||3600)*1000;
  await env.DB.prepare("UPDATE hq_google_tokens SET encrypted=?, updated_at=datetime('now') WHERE account=?").bind(await seal(tok,env),CALENDAR_MANAGER).run();
  return {access_token:tok.access_token,calendar_id:row.calendar_id};
}
async function gcal(token,path,method="GET",body) {
  // Google rate-limits bursts (429, or 403 "rateLimitExceeded") and has short 5xx blips: retry reads with backoff.
  for(let attempt=0;;attempt++){
    const r=await fetch("https://www.googleapis.com/calendar/v3"+path,{method,headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});
    if(r.ok)return r.status===204?null:r.json();
    const data=await r.text();
    const retry=method==="GET"&&attempt<3&&(r.status===429||r.status>=500||(r.status===403&&/rateLimit|userRateLimit|quota/i.test(data)));
    if(!retry)throw Object.assign(Error("Google Calendar "+r.status+": "+data.slice(0,240)),{gstatus:r.status,greason:(data.match(/"reason":\s*"([^"]+)"/)||[])[1]||""});
    await new Promise(res=>setTimeout(res,400*2**attempt+Math.random()*300));
  }
}
// Run fn over items, at most n at a time (Google dislikes many calendars fetched at once).
async function pool(items,n,fn){let i=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(i<items.length){const x=items[i++];await fn(x)}}))}
const COLS=new Set(["settings","depts","actions","decisions","contacts","invoices","money","content","ideas","weekly","links","tools","skills"]);
const ID=/^[A-Za-z0-9_-]{1,64}$/;
async function ensureTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_docs(col TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(col,id))").run()}
const rid=()=>b64(crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g,"x");
async function readBody(req,max){const t=await req.text();if(t.length>max)throw Object.assign(Error("Request too large"),{status:413});try{return JSON.parse(t)}catch{throw Object.assign(Error("Invalid JSON"),{status:400})}}
async function allCalendars(token){let items=[],pageToken="";do{const s=pageToken?"&pageToken="+encodeURIComponent(pageToken):"";const p=await gcal(token,"/users/me/calendarList?maxResults=250"+s);items.push(...(p.items||[]));pageToken=p.nextPageToken||""}while(pageToken&&items.length<500);
  return items.filter(x=>!x.deleted&&x.selected!==false).map(x=>({id:x.id,summary:x.summary||x.id,primary:!!x.primary,writable:["owner","writer"].includes(x.accessRole)}))}
const DT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const DD=/^\d{4}-\d{2}-\d{2}$/;
function eventBody(b){if(typeof b.summary!=="string"||!b.summary.trim()||b.summary.length>300)throw Object.assign(Error("Invalid title"),{status:400});
  const t=s=>s.length===16?s+":00":s;const o={summary:b.summary.trim()};
  if(b.allDay){if(!DD.test(String(b.start).slice(0,10))||!DD.test(String(b.end).slice(0,10)))throw Object.assign(Error("Invalid date"),{status:400});o.start={date:String(b.start).slice(0,10),dateTime:null};o.end={date:String(b.end).slice(0,10),dateTime:null}}
  else{if(!DT.test(b.start||"")||!DT.test(b.end||""))throw Object.assign(Error("Invalid time"),{status:400});o.start={dateTime:t(b.start),timeZone:"Africa/Cairo",date:null};o.end={dateTime:t(b.end),timeZone:"Africa/Cairo",date:null}}
  if(typeof b.description==="string")o.description=b.description.slice(0,4000);if(typeof b.location==="string")o.location=b.location.slice(0,300);return o}

/* ---------- audit trail: every change to HQ data, who and when ---------- */
async function audit(env,who,col,id,action,label){try{await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_audit(at TEXT NOT NULL,who TEXT,col TEXT,doc TEXT,action TEXT,label TEXT)").run();
  await env.DB.prepare("INSERT INTO hq_audit(at,who,col,doc,action,label) VALUES(datetime('now'),?,?,?,?,?)").bind(who||"system",col,id,action,label||"").run()}catch(e){console.log("hq audit failed",String(e.message||e))}}

/* ---------- contacts: ZD AI accounts and newsletter subscribers merged into HQ contacts by email ---------- */
const OWNER_EMAILS=new Set([OWNER,CALENDAR_MANAGER]);
const emailKey=e=>String(e||"").trim().toLowerCase();
async function contactId(email){const h=new Uint8Array(await crypto.subtle.digest("SHA-256",te.encode("hq-contact|"+emailKey(email))));return "c"+b64(h.slice(0,9)).replace(/[^A-Za-z0-9]/g,"x")}
async function zdAccounts(env){if(!env.ZD_DB)return null;
  const r=await env.ZD_DB.prepare("SELECT id,email,display_name,created_at FROM users WHERE email NOT LIKE '%@guest.zd.app' AND is_demo=0").all();
  const granted=async kind=>{const x=await env.ZD_DB.prepare("SELECT c.user_id,c.granted FROM consents c JOIN (SELECT user_id,MAX(created_at) AS m FROM consents WHERE kind=? GROUP BY user_id) l ON l.user_id=c.user_id AND l.m=c.created_at WHERE c.kind=?").bind(kind,kind).all().catch(()=>({results:[]}));return new Set((x.results||[]).filter(y=>Number(y.granted)===1).map(y=>String(y.user_id)))};
  const recap=await granted("monthly_recap"),plus=await granted("plus_notify");
  return (r.results||[]).filter(u=>!OWNER_EMAILS.has(emailKey(u.email))).map(u=>{const n=String(u.display_name||"").trim();return {email:emailKey(u.email),name:n&&n.toLowerCase()!==emailKey(u.email).split("@")[0]&&!/^guest$/i.test(n)?n.slice(0,80):"",since:String(u.created_at||"").slice(0,10),agreed:[recap.has(u.id)&&"Monthly recap",plus.has(u.id)&&"Plus launch news"].filter(Boolean)}})}

/* Calendly: everyone who booked a session (last 12 months and upcoming), with the event and their answers */
async function calendlyBookings(env){const key=env.CALENDLY_TOKEN;if(!key)return null;const H={Authorization:"Bearer "+key,accept:"application/json"};
  const me=await getJSON("https://api.calendly.com/users/me",H);const user=me.resource&&me.resource.uri;if(!user)throw Error("Calendly: no user");
  const out=[];let url="https://api.calendly.com/scheduled_events?user="+encodeURIComponent(user)+"&status=active&count=100&sort=start_time:desc&min_start_time="+encodeURIComponent(new Date(Date.now()-365*864e5).toISOString());
  for(let page=0;url&&page<5;page++){const j=await getJSON(url,H);
    for(const ev of j.collection||[]){const uuid=String(ev.uri||"").split("/").pop();if(!uuid)continue;
      const inv=await getJSON("https://api.calendly.com/scheduled_events/"+uuid+"/invitees?count=100&status=active",H);
      for(const p of inv.collection||[]){if(!p.email)continue;const qa=(p.questions_and_answers||[]).map(x=>(x.question||"")+": "+(x.answer||"")).join(" · ").slice(0,500);
        out.push({email:emailKey(p.email),name:String(p.name||"").slice(0,80),since:String(p.created_at||"").slice(0,10),event:String(ev.name||"Session").slice(0,80),start:String(ev.start_time||""),answers:qa,phone:String(p.text_reminder_number||"").slice(0,30)})}}
    url=j.pagination&&j.pagination.next_page}
  return out}
async function brevoSubscribers(env,key){if(!key)return null;const H={"api-key":key,accept:"application/json"};const list=Number(env.NEWSLETTER_LIST_ID||2);const out=[];
  for(let off=0;off<10000;off+=500){const j=await getJSON("https://api.brevo.com/v3/contacts/lists/"+list+"/contacts?limit=500&offset="+off+"&sort=desc",H);const cs=j.contacts||[];
    for(const c of cs){if(c.emailBlacklisted||!c.email)continue;const a=c.attributes||{};out.push({email:emailKey(c.email),name:[a.FIRSTNAME,a.LASTNAME].filter(x=>typeof x==="string"&&x.trim()).join(" ").trim().slice(0,80),since:String(c.createdAt||"").slice(0,10)})}
    if(cs.length<500)break}
  return out}
async function syncContacts(env,brevoKey){
  await ensureTable(env);
  const errors=[];let zd=null,nl=null,cal=null;
  try{cal=await calendlyBookings(env);if(!cal)errors.push("Calendly: token missing")}catch(e){errors.push("Calendly: "+String(e.message||e).slice(0,160))}
  try{zd=await zdAccounts(env);if(!zd)errors.push("ZD AI: not connected")}catch(e){errors.push("ZD AI: "+String(e.message||e).slice(0,160))}
  try{nl=await brevoSubscribers(env,brevoKey);if(!nl)errors.push("Newsletter: Brevo key missing")}catch(e){errors.push("Newsletter: "+String(e.message||e).slice(0,160))}
  const rows=(await env.DB.prepare("SELECT id,data FROM hq_docs WHERE col='contacts'").all()).results||[];
  const byEmail=new Map();for(const r of rows){let d={};try{d=JSON.parse(r.data)}catch{}if(d.email)byEmail.set(emailKey(d.email),{id:r.id,d})}
  const incoming=new Map();
  const add=(list,src)=>{for(const x of list||[]){const k=x.email;if(!k||OWNER_EMAILS.has(emailKey(k)))continue;const cur=incoming.get(k)||{email:k,name:"",src:{},bookings:[]};if(!cur.name&&x.name)cur.name=x.name;
    if(src==="calendly"){cur.bookings.push(x);if(!cur.src.calendly||x.since<cur.src.calendly)cur.src.calendly=x.since;if(x.phone&&!cur.phone)cur.phone=x.phone}else cur.src[src]=x.since||"";if(x.agreed)cur.agreed=x.agreed;incoming.set(k,cur)}};
  add(zd,"zd");add(nl,"newsletter");add(cal,"calendly");
  const bookLog=x=>x.bookings.map(b=>({at:b.since,text:"Booked on Calendly: "+b.event+(b.start?" for "+b.start.slice(0,10)+" "+b.start.slice(11,16)+" UTC":"")+(b.answers?" · "+b.answers:""),key:"cal:"+b.start}));
  // A booked call that has happened gets a follow-up date (the day after), unless one is set or the deal moved on.
  const afterCall=(d,x)=>{const last=x.bookings.map(b=>b.start||"").filter(Boolean).sort().pop();if(!last||last>=now||d.next||d.stage!=="Call booked")return;const t=new Date(Date.parse(last)+864e5).toISOString().slice(0,10);d.next=t};
  let added=0,updated=0;const now=new Date().toISOString();
  for(const [k,x] of incoming){const hit=byEmail.get(k);
    if(hit){const d=hit.d,before=JSON.stringify(d);
      if(!d.name&&x.name)d.name=x.name;
      if(zd&&"zd" in x.src)d.zdSince=x.src.zd;else if(zd)delete d.zdSince;
      if(nl&&"newsletter" in x.src)d.newsletterSince=x.src.newsletter;else if(nl)delete d.newsletterSince;
      if(zd){if(x.agreed&&x.agreed.length)d.agreed=x.agreed;else delete d.agreed}
      if(cal&&x.bookings.length){d.calendlySince=x.src.calendly;if(!d.phone&&x.phone)d.phone=x.phone;
        const have=new Set((d.log||[]).map(l=>l.key).filter(Boolean));const fresh=bookLog(x).filter(l=>!have.has(l.key));if(fresh.length)d.log=(d.log||[]).concat(fresh);
        if(!d.type||d.type==="Audience")d.type="Session lead";if(fresh.length&&["New","To contact","Contacted","Replied",undefined,""].includes(d.stage))d.stage="Call booked";afterCall(d,x)}
      if(JSON.stringify(d)!==before){d.syncedAt=now;await env.DB.prepare("UPDATE hq_docs SET data=?,updated_at=datetime('now') WHERE col='contacts' AND id=?").bind(JSON.stringify(d),hit.id).run();updated++}}
    else{const id=await contactId(k);const booked=x.bookings.length>0;const d={name:x.name,email:k,type:booked?"Session lead":"Audience",stage:booked?"Call booked":"New",createdAt:now,deletedAt:null,createdBy:"sync",syncedAt:now};
      if("zd" in x.src)d.zdSince=x.src.zd;if("newsletter" in x.src)d.newsletterSince=x.src.newsletter;if(x.agreed&&x.agreed.length)d.agreed=x.agreed;
      if(booked){d.calendlySince=x.src.calendly;if(x.phone)d.phone=x.phone;d.log=bookLog(x);afterCall(d,x)}
      const ins=await env.DB.prepare("INSERT INTO hq_docs(col,id,data,updated_at) VALUES('contacts',?,?,datetime('now')) ON CONFLICT(col,id) DO NOTHING").bind(id,JSON.stringify(d)).run();
      if(ins&&ins.meta&&ins.meta.changes){await audit(env,"sync","contacts",id,"created",(x.name||k).slice(0,80));added++}}}
  // People who left both sources stay as contacts (your notes are kept); their source dates are cleared above.
  return {added,updated,zdAccounts:zd?zd.length:null,subscribers:nl?nl.length:null,bookings:cal?cal.length:null,errors}}

/* ---------- daily copy of all HQ data, kept 30 days ---------- */
async function dailyBackup(env){await ensureTable(env);await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_backups(day TEXT PRIMARY KEY,data TEXT NOT NULL,at TEXT NOT NULL)").run();
  const day=new Date().toISOString().slice(0,10);if(await env.DB.prepare("SELECT 1 FROM hq_backups WHERE day=?").bind(day).first())return;
  const r=(await env.DB.prepare("SELECT col,id,data,updated_at FROM hq_docs").all()).results||[];const data=JSON.stringify(r);
  if(data.length>1800000){console.log("hq backup too large for one row",data.length);return}
  await env.DB.prepare("INSERT INTO hq_backups(day,data,at) VALUES(?,?,datetime('now')) ON CONFLICT(day) DO NOTHING").bind(day,data).run();
  await env.DB.prepare("DELETE FROM hq_backups WHERE day<date('now','-30 days')").run()}

/* ---------- ZD AI numbers for the HQ (counts only: no chat contents) ---------- */
async function zdSummary(env){if(!env.ZD_DB)return {connected:false};
  const one=async(sql,...b)=>{const r=await env.ZD_DB.prepare(sql).bind(...b).first();return r?Object.values(r)[0]:0};
  const d7=new Date(Date.now()-7*864e5).toISOString(),d30=new Date(Date.now()-30*864e5).toISOString();
  const real="email NOT LIKE '%@guest.zd.app' AND is_demo=0 AND lower(email) NOT IN ("+[...OWNER_EMAILS].map(e=>"'"+e.replace(/'/g,"")+"'").join(",")+")";
  return {connected:true,
    accounts:await one(`SELECT COUNT(*) FROM users WHERE ${real}`),
    newAccounts30:await one(`SELECT COUNT(*) FROM users WHERE ${real} AND created_at>=?`,d30),
    guests30:await one("SELECT COUNT(*) FROM audit_log WHERE action='guest.start' AND created_at>=? AND (meta IS NULL OR json_extract(meta,'$.qa') IS NOT 1)",d30),
    active7:await one("SELECT COUNT(DISTINCT user_id) FROM audit_log WHERE action='chat.message' AND created_at>=?",d7),
    messages7:await one("SELECT COUNT(*) FROM audit_log WHERE action='chat.message' AND created_at>=?",d7),
    aiAnswers7:await one("SELECT COUNT(*) FROM audit_log WHERE action='ai.answer' AND created_at>=?",d7),
    visits30:await one("SELECT COUNT(*) FROM audit_log WHERE action='web.view' AND created_at>=?",d30)}}

/* ---------- AI briefing: read-only, from HQ records only; one per day, questions capped ---------- */
const AI_MODEL="claude-haiku-5-5",ASK_PER_DAY=20;
const cairoDay=()=>new Date(Date.now()+2*36e5).toISOString().slice(0,10);
async function hqContext(env){await ensureTable(env);const rows=(await env.DB.prepare("SELECT col,id,data FROM hq_docs WHERE col IN ('actions','decisions','contacts','invoices','money','settings','content')").all()).results||[];
  const by={};for(const r of rows){let d={};try{d=JSON.parse(r.data)}catch{}if(d.deletedAt)continue;(by[r.col]=by[r.col]||[]).push({id:r.id,...d})}
  const t=cairoDay(),mk=t.slice(0,7),set=(by.settings||[])[0]||{},g=set.goal||{};
  const acts=(by.actions||[]).filter(a=>a.status!=="done"),money=by.money||[],sum=l=>l.reduce((s,m)=>s+(+m.amount||0),0);
  const cs=by.contacts||[],open=cs.filter(c=>!["Client","Audience"].includes(c.type)&&!["Won","Lost"].includes(c.stage));
  const zd=await zdSummary(env).catch(()=>null);const m=await env.DB.prepare("SELECT source,data FROM hq_metrics WHERE source IN ('zernio','brevo')").all().then(r=>r.results||[]).catch(()=>[]);
  const soc=m.map(x=>{try{const d=JSON.parse(x.data||"{}");return x.source==="zernio"?{followers:(d.accounts||[]).map(a=>({platform:a.platform,followers:a.followers}))}:{newsletterSubscribers:d.subscribers}}catch{return null}}).filter(Boolean);
  return {today:t,goal:{title:g.title,targetEGP:g.target,start:g.start,end:g.end,moneyInSinceStart:sum(money.filter(x=>x.kind==="in"&&(x.date||"")>=(g.start||"0")))},
    moneyThisMonth:{in:sum(money.filter(x=>x.kind==="in"&&(x.date||"").startsWith(mk))),out:sum(money.filter(x=>x.kind==="out"&&(x.date||"").startsWith(mk))),rows:money.filter(x=>(x.date||"").startsWith(mk)).map(x=>({date:x.date,kind:x.kind,amount:x.amount,for:x.category}))},
    unpaidInvoices:(by.invoices||[]).filter(i=>i.status!=="paid").map(i=>({client:i.client,amount:i.amount,due:i.due||null})),
    openActions:acts.map(a=>({title:a.title,priority:({High:"P1",Medium:"P2",Low:"P3"})[a.prio]||a.prio||"P2",due:a.due||null,overdue:!!a.due&&a.due<t,top3:!!a.star,waitsFor:a.blockedBy?((by.actions||[]).find(x=>x.id===a.blockedBy)||{}).title||null:null,area:a.dept})).slice(0,60),
    decisionsWaiting:(by.decisions||[]).filter(d=>d.status==="waiting").map(d=>({title:d.title,detail:String(d.options||d.context||"").slice(0,300)})).slice(0,20),
    pipeline:open.map(c=>({name:c.name||c.email,type:c.type,stage:c.stage,valueEGP:c.value||0,nextFollowUp:c.next||null})).slice(0,40),
    followUpsDue:cs.filter(c=>c.next&&c.next<=t&&!["Won","Lost"].includes(c.stage)).map(c=>c.name||c.email),
    audience:{contacts:cs.length,newContacts30:cs.filter(c=>(c.createdAt||"")>=new Date(Date.now()-30*864e5).toISOString()).length,social:soc,zdAI:zd},
    contentPlanned:(by.content||[]).filter(c=>c.status!=="Published").map(c=>({title:c.title,channel:c.channel,date:c.date||null,status:c.status})).slice(0,20)}}
async function askClaude(env,system,user,maxTokens){const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"content-type":"application/json","x-api-key":env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},body:JSON.stringify({model:AI_MODEL,max_tokens:maxTokens,system,messages:[{role:"user",content:user}]})});
  const j=await r.json().catch(()=>({}));if(!r.ok)throw Error("Claude "+r.status+": "+String((j.error&&j.error.message)||"").slice(0,200));return (j.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("").trim()}
const BRIEF_SYSTEM=`You are the chief of staff for Amr, a solo founder in Egypt (financial education: corporate workshops, 1-on-1 sessions, the ZD AI app). You write his morning briefing from the JSON he gives you.
Rules: use ONLY facts in the JSON; never invent numbers, names or dates; if something is missing, say "not recorded". Money is EGP. Every recommendation is clearly a recommendation, never a fact. Direct and short, plain English, no hype, no emoji.
Format exactly:
**How the business is doing**
2-3 sentences with the key numbers.
**Needs you today**
Up to 4 bullets: overdue actions, follow-ups due, decisions waiting, unpaid invoices. "Nothing urgent." if none.
**Do next (recommendations)**
3 numbered lines, highest business impact first, each naming the action or person from the data.`;
async function briefing(env,refresh){await metricsTable(env);const key="briefing:"+cairoDay();
  const row=await env.DB.prepare("SELECT data,fetched_at FROM hq_metrics WHERE source=?").bind(key).first();
  if(row&&!refresh){try{return {text:JSON.parse(row.data).text,at:row.fetched_at.replace(" ","T")+"Z",cached:true}}catch{}}
  if(!env.ANTHROPIC_API_KEY)return {error:"The Anthropic key isn't set."};
  const text=await askClaude(env,BRIEF_SYSTEM,"HQ data:\n"+JSON.stringify(await hqContext(env)),700);
  await env.DB.prepare("INSERT INTO hq_metrics(source,data,error,fetched_at) VALUES(?,?,NULL,datetime('now')) ON CONFLICT(source) DO UPDATE SET data=excluded.data,error=NULL,fetched_at=excluded.fetched_at").bind(key,JSON.stringify({text})).run();
  return {text,at:new Date().toISOString(),cached:false}}
async function askHQ(env,q){await metricsTable(env);const key="asks:"+cairoDay();
  const row=await env.DB.prepare("SELECT data FROM hq_metrics WHERE source=?").bind(key).first();let n=0;try{n=row?JSON.parse(row.data).n||0:0}catch{}
  if(n>=ASK_PER_DAY)return {error:`That's today's ${ASK_PER_DAY} questions. More tomorrow.`};if(!env.ANTHROPIC_API_KEY)return {error:"The Anthropic key isn't set."};
  await env.DB.prepare("INSERT INTO hq_metrics(source,data,error,fetched_at) VALUES(?,?,NULL,datetime('now')) ON CONFLICT(source) DO UPDATE SET data=excluded.data,fetched_at=excluded.fetched_at").bind(key,JSON.stringify({n:n+1})).run();
  const text=await askClaude(env,`You answer Amr's questions about his business using ONLY the HQ data JSON. If the data can't answer, say what is missing. Keep facts (from the data) separate from your recommendation and label the recommendation. You can't send, pay, delete or change anything; if asked, say he must do it himself. Short, plain English. Money is EGP.`,"HQ data:\n"+JSON.stringify(await hqContext(env))+"\n\nQuestion: "+q,600);
  return {text,left:ASK_PER_DAY-n-1}}

/* ---------- status: every connection, its last sync and its last error ---------- */
async function statusReport(env){await metricsTable(env);
  const rows=(await env.DB.prepare("SELECT source,fetched_at,error FROM hq_metrics WHERE source NOT LIKE 'brevo:%'").all()).results||[];
  const at=r=>r&&r.fetched_at?r.fetched_at.replace(" ","T")+"Z":null;const get=k=>rows.find(r=>r.source===k);
  const cal=await calendarRow(env).catch(()=>null);
  let rates=null;if(env.RATES){try{const l=await env.RATES.get("latest","json"),a=await env.RATES.get("auto","json");rates={latest:l&&l.latest,lastAttempt:l&&l.lastAttempt,errors:(l&&l.errors)||[],autoCheckedAt:a&&a.checkedAt,decision:a&&a.decision&&a.decision.status}}catch(e){rates={error:String(e.message||e)}}}
  const audits=await env.DB.prepare("SELECT at,who,col,doc,action,label FROM hq_audit ORDER BY at DESC LIMIT 50").all().then(r=>r.results||[]).catch(()=>[]);
  return {calendar:{connected:!!cal},zernio:{at:at(get("zernio")),error:get("zernio")?get("zernio").error:"never synced"},brevo:{at:at(get("brevo")),error:get("brevo")?get("brevo").error:"never synced"},
    contacts:{at:at(get("contacts")),error:get("contacts")?get("contacts").error:"never synced"},zd:{connected:!!env.ZD_DB},calendly:{connected:!!env.CALENDLY_TOKEN},ai:{connected:!!env.ANTHROPIC_API_KEY},rates,audits}}

/* ---------- analytics: Zernio (Instagram, TikTok) and Brevo ---------- */
async function metricsTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_metrics(source TEXT PRIMARY KEY,data TEXT,fetched_at TEXT,error TEXT)").run()}
async function getJSON(url,headers){const r=await fetch(url,{headers});const t=await r.text();if(!r.ok)throw Error(r.status+": "+t.slice(0,200));try{return JSON.parse(t)}catch{throw Error("Bad JSON from "+new URL(url).host)}}
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
async function fetchZernio(env,from){
  const H={Authorization:"Bearer "+env.ZERNIO_API_KEY};const B="https://zernio.com/api/v1";
  const fs=await getJSON(B+"/accounts/follower-stats?granularity=daily&fromDate="+from,H);
  const accounts=(fs.accounts||[]).map(a=>({id:a._id,platform:a.platform,username:a.username,followers:num(a.currentFollowers),asOf:a.lastUpdated||null,growth:num(a.growth),history:((fs.stats||{})[a._id]||[]).map(x=>({date:String(x.date).slice(0,10),followers:num(x.followers)}))}));
  const profiles=[...new Set((fs.accounts||[]).map(a=>a.profileId).filter(Boolean))];
  let posts=[],overview=null;
  for(const pid of profiles){try{const an=await getJSON(B+"/analytics?profileId="+encodeURIComponent(pid)+"&fromDate="+from+"&limit=100",H);overview=an.overview||overview;
    for(const p of an.posts||[]){const m=p.analytics||{};posts.push({id:p._id,platform:p.platform,publishedAt:p.publishedAt,url:p.platformPostUrl||"",text:String(p.content||"").slice(0,140),views:num(m.views),reach:num(m.reach),impressions:num(m.impressions),likes:num(m.likes),comments:num(m.comments),shares:num(m.shares),saves:num(m.saves)})}}catch(e){if(!posts.length)throw e}}
  return {accounts,posts,overview};
}
async function fetchBrevo(env){
  const H={"api-key":env.BREVO_API_KEY,accept:"application/json"};const B="https://api.brevo.com/v3";
  const c=await getJSON(B+"/contacts?limit=1",H);
  let campaigns=[];try{const e=await getJSON(B+"/emailCampaigns?status=sent&limit=10&sort=desc&statistics=globalStats",H);
    campaigns=(e.campaigns||[]).map(x=>{const g=(x.statistics&&x.statistics.globalStats)||{};const d=num(g.delivered)||num(g.sent);return {name:x.name,sentDate:x.sentDate||"",delivered:d,opens:num(g.uniqueViews),clicks:num(g.uniqueClicks),openRate:d?num(g.uniqueViews)/d:null,clickRate:d?num(g.uniqueClicks)/d:null}})}catch(e){}
  return {subscribers:num(c.count),campaigns};
}
async function analytics(env0,force){
  const names=Object.keys(env0);const pick=(...n)=>{for(const x of n){const k=names.find(y=>y.trim().toUpperCase()===x);const v=k&&env0[k];if(typeof v==="string"&&v.trim())return v.trim()}return ""};
  const env=Object.assign(Object.create(env0),{DB:env0.DB,ZERNIO_API_KEY:pick("ZERNIO_API_KEY","ZERNIO_KEY","ZERNIO","LATE_API_KEY"),BREVO_API_KEY:pick("BREVO_API_KEY","BREVO_KEY","BREVO","SENDINBLUE_API_KEY")});
  for(const k of Object.keys(env0))if(!(k in env))env[k]=env0[k];
  await metricsTable(env);
  const rows=(await env.DB.prepare("SELECT source,data,fetched_at,error FROM hq_metrics").all()).results||[];
  const get=k=>rows.find(r=>r.source===k);
  const fresh=r=>r&&r.fetched_at&&(Date.now()-Date.parse(r.fetched_at+"Z"))<6*3600*1000;
  const goalRow=await env.DB.prepare("SELECT data FROM hq_docs WHERE col='settings' AND id='main'").first().catch(()=>null);
  let from="2026-11-01";try{from=JSON.parse(goalRow.data).goal.start||from}catch{}
  const today=new Date().toISOString().slice(0,10);
  const save=async(k,data,err)=>{await env.DB.prepare("INSERT INTO hq_metrics(source,data,fetched_at,error) VALUES(?,?,datetime('now'),?) ON CONFLICT(source) DO UPDATE SET data=COALESCE(excluded.data,hq_metrics.data),fetched_at=excluded.fetched_at,error=excluded.error").bind(k,data?JSON.stringify(data):null,err||null).run()};
  const out={};
  for(const [k,key,fn] of [["zernio","ZERNIO_API_KEY",()=>fetchZernio(env,from)],["brevo","BREVO_API_KEY",()=>fetchBrevo(env)]]){
    let r=get(k);
    if(!env[key]){const seen=Object.keys(env0).filter(n=>/zernio|late|brevo|sendinblue/i.test(n)).map(n=>{const v=env0[n];return n+(typeof v!=="string"?" (not text: "+typeof v+")":v.trim()?"":" (empty)")});
      if(force||!fresh(r)||!(r.error||"").startsWith("missing key"))await save(k,null,"missing key; site sees: "+(seen.join(", ")||"none"));
      out[k]={missing:true,seen,data:r&&r.data?JSON.parse(r.data):null};continue}
    if(force||!fresh(r)){try{const d=await fn();await save(k,d,null);if(k==="brevo")await save("brevo:"+today,{subscribers:d.subscribers},null);r={data:JSON.stringify(d),fetched_at:new Date().toISOString().slice(0,19).replace("T"," "),error:null}}
      catch(e){await save(k,null,String(e.message||e).slice(0,300));r=Object.assign({},r||{},{error:String(e.message||e).slice(0,300)})}}
    out[k]={data:r&&r.data?JSON.parse(r.data):null,fetchedAt:r&&r.fetched_at?r.fetched_at.replace(" ","T")+"Z":null,error:r&&r.error||null};
  }
  {let r=get("contacts");if(force||!fresh(r)){try{const c=await syncContacts(env,env.BREVO_API_KEY);await save("contacts",c,c.errors.length?c.errors.join("; "):null);out.contacts=c}catch(e){await save("contacts",null,String(e.message||e).slice(0,300));out.contacts={error:String(e.message||e)}}}}
  out.brevoHistory=rows.filter(r=>r.source.startsWith("brevo:")).map(r=>({date:r.source.slice(6),subscribers:num(JSON.parse(r.data||"{}").subscribers)})).sort((a,b)=>a.date.localeCompare(b.date));
  return out;
}

/* ---------- Marketing: approvals, publishing to Zernio (locked off by default), Zernio webhook ---------- */
// The version fingerprint must match cver() in hq/home/index.html exactly.
const PLATS=[["ig","instagram"],["tt","tiktok"],["li","linkedin"]];
const cverS=c=>{const t=JSON.stringify([c.script||"",c.caption||"",c.asset||"",PLATS.map(([k])=>!!c[k])]);let h=5381;for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))|0;return "v"+(h>>>0).toString(36)};
async function mktTables(env){
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_kv(k TEXT PRIMARY KEY,v TEXT,updated_at TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_approvals(content_id TEXT NOT NULL,version TEXT NOT NULL,stage TEXT NOT NULL,by TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(content_id,version,stage))").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_events(id TEXT PRIMARY KEY,event TEXT,at TEXT,note TEXT)").run();
}
const kvGet=async(env,k)=>{const r=await env.DB.prepare("SELECT v FROM hq_kv WHERE k=?").bind(k).first().catch(()=>null);return r?r.v:null};
async function getContent(env,id){const r=await env.DB.prepare("SELECT data FROM hq_docs WHERE col='content' AND id=?").bind(id).first();if(!r)throw Object.assign(Error("Content not found"),{status:404});return JSON.parse(r.data)}
async function saveContent(env,id,c){await env.DB.prepare("UPDATE hq_docs SET data=?,updated_at=datetime('now') WHERE col='content' AND id=?").bind(JSON.stringify(c),id).run()}
const histS=(c,by,action,note)=>(c.history||[]).concat([{at:new Date().toISOString(),by,action,note:note||"",version:cverS(c)}]);
async function decide(env,id,user,body){
  await mktTables(env);const c=await getContent(env,id);const act=String(body.action||"");const by=user.email;
  const waiting=["Script for approval","Final for approval"];
  if(act==="approve"){
    if(!waiting.includes(c.status))return json({error:"This item isn't waiting for approval."},409);
    const fin=c.status==="Final for approval";const v=cverS(c);
    if(fin&&!c.asset)return json({error:"Attach the video first."},409);
    if(body.version&&body.version!==v)return json({error:"The content changed while you were looking at it. Reload and check again."},409);
    await env.DB.prepare("INSERT OR IGNORE INTO hq_approvals(content_id,version,stage,by,at) VALUES(?,?,?,?,datetime('now'))").bind(id,v,fin?"final":"script",by).run();
    c.status=fin?"Approved":"To record";c.approval={stage:fin?"final":"script",version:v,at:new Date().toISOString(),by};c.history=histS(c,by,fin?"Final approved":"Script approved");
    await saveContent(env,id,c);await audit(env,by,"content",id,c.history.slice(-1)[0].action,c.title);
    const pub=fin?await publishContent(env,id,by):null;
    return json({ok:true,status:(await getContent(env,id)).status,publish:pub});
  }
  if(act==="changes"){const note=String(body.note||"").slice(0,2000);if(!note)return json({error:"Write what should change."},400);c.status="Changes requested";c.approval=null;c.history=histS(c,by,"Changes requested",note);await saveContent(env,id,c);await audit(env,by,"content",id,"changes requested",c.title);return json({ok:true})}
  if(act==="reject"){if(c.zernioPostId)return json({error:"Already sent to Zernio. Cancel it in Zernio first."},409);c.status="Rejected";c.approval=null;c.history=histS(c,by,"Rejected");await saveContent(env,id,c);await audit(env,by,"content",id,"rejected",c.title);return json({ok:true})}
  if(act==="publish")return json(await publishContent(env,id,by));
  return json({error:"Unknown action"},400);
}
async function publishContent(env,id,by){
  const c=await getContent(env,id);const v=cverS(c);
  const fail=async(msg)=>{c.history=histS(c,by,"Not sent",msg);await saveContent(env,id,c);return {sent:false,reason:msg}};
  if(c.zernioPostId)return {sent:true,already:true,zernioPostId:c.zernioPostId};
  if(c.status!=="Approved")return fail("Only approved posts can be sent.");
  const ok=await env.DB.prepare("SELECT 1 FROM hq_approvals WHERE content_id=? AND version=? AND stage='final'").bind(id,v).first();
  if(!ok||!c.approval||c.approval.version!==v)return fail("The approval doesn't match this version, so nothing was sent.");
  // Safety switch: nothing reaches Zernio unless publishing has been switched on.
  if((await kvGet(env,"publishing"))!=="on"){c.history=histS(c,by,"Ready to send","Publishing is switched off, so nothing was sent to Zernio.");await saveContent(env,id,c);return {sent:false,reason:"Publishing is switched off. Nothing was sent."}}
  const key=env.ZERNIO_API_KEY;if(!key)return fail("Zernio key missing.");
  if(!/^https:\/\/\S+\.(mp4|mov)(\?\S*)?$/i.test(c.asset||""))return fail("The video link must be a direct .mp4 or .mov file, not a Drive page.");
  if(!c.date)return fail("Pick a publish date first.");
  const H={Authorization:"Bearer "+key,"Content-Type":"application/json","Idempotency-Key":"hq-"+id+"-"+v};
  const acc=await getJSON("https://zernio.com/api/v1/accounts",{Authorization:"Bearer "+key});const list=acc.accounts||[];
  const platforms=PLATS.filter(([k])=>c[k]).map(([,p])=>{const a=list.find(x=>x.platform===p);return a?{platform:p,accountId:a._id}:null});
  if(!platforms.length||platforms.includes(null))return fail("One of the chosen platforms isn't connected in Zernio.");
  const body={content:c.caption||"",mediaItems:[{type:"video",url:c.asset}],platforms,scheduledFor:c.date+"T"+(c.time||"19:00")+":00",timezone:"Africa/Cairo"};
  const r=await fetch("https://zernio.com/api/v1/posts",{method:"POST",headers:H,body:JSON.stringify(body)});const t=await r.text();
  if(!r.ok&&r.status!==409)return fail("Zernio said "+r.status+": "+t.slice(0,200));
  let pid=null;try{const j=JSON.parse(t);pid=(j.post&&j.post._id)||null}catch{}
  c.zernioPostId=pid;c.status="Scheduled";c.history=histS(c,by,"Sent to Zernio","Scheduled for "+body.scheduledFor+" Cairo time"+(pid?" · "+pid:""));await saveContent(env,id,c);
  return {sent:true,zernioPostId:pid};
}
// ---- Paymob (Egypt) ----
const PAYMOB_BASE="https://accept.paymob.com";
const paymobIds=env=>(env.PAYMOB_INTEGRATION_IDS||"").split(/[,\s]+/).map(x=>Number(x)).filter(n=>Number.isInteger(n)&&n>0);
const paymobMode=env=>/_test_/.test(env.PAYMOB_PUBLIC_KEY||"")?"test":(env.PAYMOB_PUBLIC_KEY?"live":"none");
async function payTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_payments (id TEXT PRIMARY KEY, order_id TEXT, ref TEXT, amount_cents INTEGER, currency TEXT, success INTEGER, pending INTEGER, refunded INTEGER, voided INTEGER, mode TEXT, method TEXT, created_at TEXT, received_at TEXT DEFAULT (datetime('now')))").run()}
async function paymobStatus(env){const cfg={secret:!!env.PAYMOB_SECRET_KEY,hmac:!!env.PAYMOB_HMAC,publicKey:!!env.PAYMOB_PUBLIC_KEY,integrations:paymobIds(env).length,mode:paymobMode(env)};cfg.ready=cfg.secret&&cfg.hmac&&cfg.publicKey&&cfg.integrations>0;
 let last=[];try{await payTable(env);last=(await env.DB.prepare("SELECT id,order_id,ref,amount_cents,currency,success,pending,refunded,voided,mode,method,created_at,received_at FROM hq_payments ORDER BY received_at DESC LIMIT 10").all()).results||[]}catch(e){}
 return Object.assign(cfg,{last})}
async function paymobIntention(env,o){const ids=paymobIds(env);
 if(!env.PAYMOB_SECRET_KEY||!env.PAYMOB_PUBLIC_KEY||!ids.length)throw Object.assign(new Error("Paymob isn't fully set up in Cloudflare"),{status:503});
 const body={amount:o.amountCents,currency:"EGP",payment_methods:ids,items:[{name:o.name,amount:o.amountCents,description:o.description||o.name,quantity:1}],
  billing_data:{first_name:o.first||"NA",last_name:o.last||"NA",email:o.email,phone_number:o.phone||"+201000000000",country:"EG",city:"NA",street:"NA",building:"NA",floor:"NA",apartment:"NA",state:"NA"},
  special_reference:o.ref,notification_url:ORIGIN+"/hq/hook/paymob",redirection_url:o.redirect};
 const res=await fetch(PAYMOB_BASE+"/v1/intention/",{method:"POST",headers:{Authorization:"Token "+env.PAYMOB_SECRET_KEY,"Content-Type":"application/json"},body:JSON.stringify(body)});
 const t=await res.text();let d={};try{d=JSON.parse(t)}catch(e){d={raw:t.slice(0,200)}}
 if(!res.ok||!d.client_secret)throw Object.assign(new Error("Paymob said "+res.status+": "+JSON.stringify(d.detail||d.message||d.raw||d).slice(0,240)),{status:502});
 return {url:PAYMOB_BASE+"/unifiedcheckout/?publicKey="+encodeURIComponent(env.PAYMOB_PUBLIC_KEY)+"&clientSecret="+encodeURIComponent(d.client_secret),intention:String(d.id||""),order:String(d.intention_order_id||""),mode:paymobMode(env)}}
const PAYMOB_HMAC_FIELDS=[o=>o.amount_cents,o=>o.created_at,o=>o.currency,o=>o.error_occured,o=>o.has_parent_transaction,o=>o.id,o=>o.integration_id,o=>o.is_3d_secure,o=>o.is_auth,o=>o.is_capture,o=>o.is_refunded,o=>o.is_standalone_payment,o=>o.is_voided,o=>o.order&&o.order.id,o=>o.owner,o=>o.pending,o=>o.source_data&&o.source_data.pan,o=>o.source_data&&o.source_data.sub_type,o=>o.source_data&&o.source_data.type,o=>o.success];
function paymobHmacInput(o){return PAYMOB_HMAC_FIELDS.map(f=>{const v=f(o);return v===undefined||v===null?"":String(v)}).join("")}
async function hmac512Hex(key,msg){const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-512"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(msg));return [...new Uint8Array(sig)].map(b=>b.toString(16).padStart(2,"0")).join("")}
function sameText(a,b){if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0}
async function paymobHook(req,env){
 if(!env.PAYMOB_HMAC)return json({error:"Not configured"},503);
 const given=(new URL(req.url).searchParams.get("hmac")||"").toLowerCase();
 let body;try{body=await req.json()}catch(e){return json({error:"Bad JSON"},400)}
 const o=body&&body.obj;if(!o||String(body.type||"").toUpperCase()!=="TRANSACTION")return json({ok:true,ignored:true});
 const expected=await hmac512Hex(env.PAYMOB_HMAC,paymobHmacInput(o));
 if(!given||!sameText(expected,given)){console.log("paymob hook rejected: signature mismatch");return json({error:"Bad signature"},401)}
 await payTable(env);const ord=o.order||{},src=o.source_data||{};
 await env.DB.prepare("INSERT OR REPLACE INTO hq_payments (id,order_id,ref,amount_cents,currency,success,pending,refunded,voided,mode,method,created_at,received_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))")
  .bind(String(o.id),String(ord.id||""),String(ord.merchant_order_id||o.special_reference||""),Number(o.amount_cents)||0,String(o.currency||""),o.success?1:0,o.pending?1:0,o.is_refunded?1:0,o.is_voided?1:0,o.is_live===true?"live":(o.is_live===false?"test":paymobMode(env)),[src.type,src.sub_type].filter(Boolean).join(" "),String(o.created_at||"")).run();
 const mode=o.is_live===true?"live":(o.is_live===false?"test":paymobMode(env));
 try{await recordSessionPayment(env,o,mode)}catch(e){console.log("session payment bookkeeping failed",String(e.message||e))}
 return json({ok:true})}
// ---- Paid 1-on-1 session (public pay page -> Paymob) ----
const SESSION_PRICE_CENTS=150000;
async function checkoutTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_checkouts (ref TEXT PRIMARY KEY, product TEXT, amount_cents INTEGER, name TEXT, email TEXT, phone TEXT, start TEXT, lang TEXT, ip TEXT, status TEXT, created_at TEXT DEFAULT (datetime('now')), paid_at TEXT)").run()}
async function payApi(req,env,path){
 const pj=(o,st)=>new Response(JSON.stringify(o),{status:st||200,headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Robots-Tag":"noindex"}});
 if(path==="/pay/api/session"&&req.method==="POST"){
  const origin=req.headers.get("Origin");if(origin&&![ORIGIN,env.HQ_TEST_ORIGIN].includes(origin))return pj({error:"Origin rejected"},403);
  let b={};try{b=await req.json()}catch(e){return pj({error:"Bad request"},400)}
  const name=String(b.name||"").replace(/\s+/g," ").trim().slice(0,80),email=String(b.email||"").trim().toLowerCase().slice(0,120),phoneRaw=String(b.phone||"").replace(/[^\d+]/g,""),start=String(b.start||"").slice(0,40),lang=b.lang==="ar"?"ar":"en";
  if(name.length<2)return pj({error:lang==="ar"?"اكتب اسمك.":"Please enter your name."},400);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))return pj({error:lang==="ar"?"الإيميل مش مظبوط.":"Please enter a valid email."},400);
  const digits=phoneRaw.replace(/\D/g,"");if(digits.length<8||digits.length>15)return pj({error:lang==="ar"?"اكتب رقم موبايل صحيح.":"Please enter a valid mobile number."},400);
  const phone=phoneRaw.startsWith("+")?"+"+digits:(digits.startsWith("0")?"+2"+digits:"+"+digits);
  if(start&&isNaN(Date.parse(start)))return pj({error:"Bad session time"},400);
  await checkoutTable(env);const ip=req.headers.get("CF-Connecting-IP")||"";
  const recent=await env.DB.prepare("SELECT COUNT(*) n FROM hq_checkouts WHERE ip=? AND created_at>datetime('now','-1 hour')").bind(ip).first();
  if(recent&&recent.n>=10)return pj({error:lang==="ar"?"محاولات كتير. جرب كمان شوية.":"Too many attempts. Please try again later."},429);
  const ref="session-"+Date.now().toString(36)+"-"+crypto.randomUUID().slice(0,8);
  await env.DB.prepare("INSERT INTO hq_checkouts (ref,product,amount_cents,name,email,phone,start,lang,ip,status) VALUES (?,?,?,?,?,?,?,?,?,'created')").bind(ref,"1-on-1 session",SESSION_PRICE_CENTS,name,email,phone,start,lang,ip).run();
  const parts=name.split(" ");
  try{const it=await paymobIntention(env,{amountCents:SESSION_PRICE_CENTS,name:"1-on-1 investing session (60 min)",description:"1-hour online session with Amr El Hadeka"+(start?" · "+start.slice(0,16):""),email,phone,first:parts[0],last:parts.slice(1).join(" ")||parts[0],ref,redirect:ORIGIN+(lang==="ar"?"/ar":"")+"/pay/thanks/?ref="+encodeURIComponent(ref)});
   return pj({url:it.url})}catch(e){console.log("pay session intention failed",String(e.message||e));return pj({error:lang==="ar"?"الدفع مش متاح دلوقتي. جرب تاني أو كلمني.":"Payment isn't available right now. Please try again or contact me."},502)}
 }
 if(path==="/pay/api/status"&&req.method==="GET"){
  const ref=new URL(req.url).searchParams.get("ref")||"";if(!/^session-[a-z0-9]+-[a-f0-9]{8}$/.test(ref))return pj({status:"unknown"});
  await checkoutTable(env);await payTable(env);
  const c=await env.DB.prepare("SELECT start,name,status FROM hq_checkouts WHERE ref=?").bind(ref).first();if(!c)return pj({status:"unknown"});
  const p=await env.DB.prepare("SELECT success,pending FROM hq_payments WHERE ref=? ORDER BY success DESC, received_at DESC LIMIT 1").bind(ref).first();
  return pj({status:p?(p.success?"paid":(p.pending?"pending":"failed")):"waiting",start:c.start||"",first:(c.name||"").split(" ")[0]})
 }
 return pj({error:"Not found"},404)}
async function recordSessionPayment(env,o,mode){
 const ref=String((o.order&&o.order.merchant_order_id)||o.special_reference||"");if(!ref.startsWith("session-")||!o.success||o.is_refunded||o.is_voided)return;
 await checkoutTable(env);const c=await env.DB.prepare("SELECT * FROM hq_checkouts WHERE ref=?").bind(ref).first();if(!c)return;
 await env.DB.prepare("UPDATE hq_checkouts SET status='paid',paid_at=datetime('now') WHERE ref=?").bind(ref).run();
 if(mode!=="live")return; // test payments never touch Money or Contacts
 await ensureTable(env);const day=cairoDay(),amount=(Number(o.amount_cents)||0)/100,email=String(c.email||"").toLowerCase();
 let cid=null;const found=await env.DB.prepare("SELECT id,data FROM hq_docs WHERE col='contacts' AND lower(json_extract(data,'$.email'))=? ORDER BY (json_extract(data,'$.deletedAt') IS NULL) DESC LIMIT 1").bind(email).first();
 const line={at:day,text:"Paid EGP "+amount.toLocaleString("en-US")+" for a 1-on-1 session"+(c.start?" ("+String(c.start).slice(0,16).replace("T"," ")+")":"")+" via Paymob, transaction "+o.id,key:"pay:"+o.id};
 if(found){cid=found.id;const d=JSON.parse(found.data);if(d.deletedAt||!(d.log||[]).some(l=>l.key===line.key)){if(d.deletedAt){d.deletedAt=null;d.restoredBy="paymob"}if(!d.name&&c.name)d.name=c.name;if((d.log||[]).some(l=>l.key===line.key))d.log=d.log.filter(l=>l.key!==line.key);d.log=(d.log||[]).concat([line]);if(d.type!=="Partner")d.type="Client";if(d.stage!=="Won"){d.stage="Won";d.wonAt=day}if(!d.since)d.since=day;if(!d.phone&&c.phone)d.phone=c.phone;
   await env.DB.prepare("UPDATE hq_docs SET data=?,updated_at=datetime('now') WHERE col='contacts' AND id=?").bind(JSON.stringify(d),cid).run();await audit(env,"paymob","contacts",cid,"updated",(d.name||email).slice(0,80))}}
 else{cid=await contactId(email);const d={name:c.name,email,phone:c.phone||"",type:"Client",stage:"Won",since:day,wonAt:day,log:[line],createdBy:"paymob",deletedAt:null};
   const ins=await env.DB.prepare("INSERT OR IGNORE INTO hq_docs(col,id,data,updated_at) VALUES('contacts',?,?,datetime('now'))").bind(cid,JSON.stringify(d)).run();if(ins.meta&&ins.meta.changes)await audit(env,"paymob","contacts",cid,"created",String(c.name).slice(0,80))}
 const row={date:day,kind:"in",amount,category:"1-on-1 session",contact:c.name,contactId:cid||"",ref:String(o.id),note:"Paymob card payment"+(c.start?" · session "+String(c.start).slice(0,16).replace("T"," "):""),source:"paymob",deletedAt:null};
 const m=await env.DB.prepare("INSERT OR IGNORE INTO hq_docs(col,id,data,updated_at) VALUES('money',?,?,datetime('now'))").bind("pm-"+o.id,JSON.stringify(row)).run();
 if(m.meta&&m.meta.changes)await audit(env,"paymob","money","pm-"+o.id,"created","Session payment EGP "+amount)}
// ---- Cal.com bookings -> HQ contact + payment email ----
async function calTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS hq_calbookings (uid TEXT PRIMARY KEY, email TEXT, name TEXT, start TEXT, status TEXT, mailed_at TEXT, created_at TEXT DEFAULT (datetime('now')))").run()}
function calPayUrl(b){const q=new URLSearchParams({attendeeName:b.name||"",email:b.email||"",startTime:b.start||""});if(b.phone)q.set("attendeePhoneNumber",b.phone);return ORIGIN+"/pay/session/?"+q.toString()}
function calWhen(iso,lang){try{return new Date(iso).toLocaleString(lang==="ar"?"ar-EG":"en-GB",{timeZone:"Africa/Cairo",weekday:"long",day:"numeric",month:"long",hour:"numeric",minute:"2-digit",hour12:true})}catch(e){return iso}}
const escH=s=>String(s||"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function calPayEmail(b){const url=escH(calPayUrl(b)),first=escH((b.name||"").split(" ")[0]),en=escH(calWhen(b.start,"en")),ar=escH(calWhen(b.start,"ar"));
 const btn=(href,label,dark)=>`<table cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="${dark?"#1D1D1F":"#FFFFFF"}" style="background:${dark?"#1D1D1F":"#FFFFFF"};border:2px solid #1D1D1F;border-radius:10px;"><a href="${href}" target="_blank" style="display:inline-block;padding:13px 30px;color:${dark?"#FFFFFF":"#1D1D1F"};font-size:15px;font-weight:700;text-decoration:none;font-family:Helvetica,Arial,sans-serif;">${label}</a></td></tr></table>`;
 return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Confirm your session</title></head><body style="margin:0;padding:0;background:#FFFFFF;"><table width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#FFFFFF"><tr><td align="center" style="padding:40px 20px;"><table width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;font-family:Helvetica,Arial,sans-serif;color:#1D1D1F;">
<tr><td align="center" style="padding-bottom:28px;"><a href="https://invest.amrelhadeka.com/" target="_blank"><img src="https://invest.amrelhadeka.com/assets/email-logo.png" width="56" alt="Amr El Hadeka" style="display:block;border:0;width:56px;height:auto;"></a></td></tr>
<tr><td align="center" style="font-size:24px;line-height:32px;font-weight:700;padding-bottom:6px;">${first?first+", your":"Your"} session is reserved</td></tr>
<tr><td align="center" dir="rtl" style="font-size:20px;line-height:30px;font-weight:700;padding-bottom:20px;">جلستك محجوزة</td></tr>
<tr><td align="center" style="font-size:15px;line-height:23px;padding-bottom:6px;"><b>${en}</b> (Cairo time)</td></tr>
<tr><td align="center" dir="rtl" style="font-size:15px;line-height:25px;padding-bottom:22px;"><b>${ar}</b> (بتوقيت القاهرة)</td></tr>
<tr><td align="center" style="font-size:15px;line-height:23px;padding-bottom:8px;">To confirm it, please pay the session fee of <b>EGP 1,500</b>. Secure card payment by Paymob.</td></tr>
<tr><td align="center" dir="rtl" style="font-size:15px;line-height:25px;padding-bottom:24px;">علشان تأكد الجلسة، ادفع رسومها <b>١٬٥٠٠ جنيه</b>. الدفع بالكارت آمن عن طريق Paymob.</td></tr>
<tr><td align="center" style="padding-bottom:12px;">${btn(url,"Pay EGP 1,500 to confirm",true)}</td></tr>
<tr><td align="center" style="padding-bottom:28px;">${btn(url.replace("/pay/session/","/ar/pay/session/"),"ادفع وأكّد الجلسة",false)}</td></tr>
<tr><td align="center" style="font-size:13px;line-height:20px;padding-bottom:8px;color:#424245;">Questions? Just reply to this email.</td></tr>
<tr><td align="center" dir="rtl" style="font-size:13px;line-height:22px;padding-bottom:24px;color:#424245;">عندك سؤال؟ رد على الإيميل ده.</td></tr>
<tr><td align="center" style="font-size:12px;line-height:20px;padding-bottom:6px;">Educational content only, not personal financial advice. Investing involves risk, including loss of capital.</td></tr>
<tr><td align="center" dir="rtl" style="font-size:12px;line-height:22px;padding-bottom:28px;">محتوى تعليمي بس، مش نصيحة مالية شخصية. الاستثمار فيه مخاطرة، وممكن تخسر جزء من فلوسك.</td></tr>
<tr><td align="center" style="border-top:1px solid #1D1D1F;padding-top:20px;font-size:13px;line-height:20px;">Your Money, Your Future &middot; <span dir="rtl">فلوسك مستقبلك</span><br><a href="https://invest.amrelhadeka.com/" style="color:#1D1D1F;">invest.amrelhadeka.com</a></td></tr>
</table></td></tr></table></body></html>`}
async function sendCalPayEmail(env,b){if(!env.BREVO_API_KEY)throw new Error("BREVO_API_KEY missing");
 const r=await fetch("https://api.brevo.com/v3/smtp/email",{method:"POST",headers:{"api-key":env.BREVO_API_KEY,"Content-Type":"application/json",accept:"application/json"},body:JSON.stringify({sender:{name:"Amr El Hadeka",email:"invest@amrelhadeka.com"},replyTo:{email:"invest@amrelhadeka.com",name:"Amr El Hadeka"},to:[{email:b.email,name:b.name||b.email}],subject:"Confirm your session · أكّد جلستك",htmlContent:calPayEmail(b),tags:["session-payment"]})});
 if(!r.ok)throw new Error("Brevo "+r.status+": "+(await r.text()).slice(0,200));}
async function calUpsertContact(env,b,line,booked){await ensureTable(env);const email=String(b.email||"").toLowerCase();if(!email)return;
 const f=await env.DB.prepare("SELECT id,data FROM hq_docs WHERE col='contacts' AND lower(json_extract(data,'$.email'))=? ORDER BY (json_extract(data,'$.deletedAt') IS NULL) DESC LIMIT 1").bind(email).first();
 if(f){const d=JSON.parse(f.data);if((d.log||[]).some(l=>l.key===line.key)&&!d.deletedAt)return;if(d.deletedAt){d.deletedAt=null;d.restoredBy="cal.com"}if(!d.name&&b.name)d.name=b.name;if(!(d.log||[]).some(l=>l.key===line.key))d.log=(d.log||[]).concat([line]);
  if(booked&&d.type!=="Client"&&d.type!=="Partner"){d.type="Session lead";if(!["Won","Proposal sent"].includes(d.stage))d.stage="Call booked"}if(!d.phone&&b.phone)d.phone=b.phone;
  await env.DB.prepare("UPDATE hq_docs SET data=?,updated_at=datetime('now') WHERE col='contacts' AND id=?").bind(JSON.stringify(d),f.id).run();await audit(env,"cal.com","contacts",f.id,"updated",(d.name||email).slice(0,80))}
 else if(booked){const id=await contactId(email);const d={name:b.name||email,email,phone:b.phone||"",type:"Session lead",stage:"Call booked",createdBy:"cal.com",createdAt:new Date().toISOString(),log:[line],deletedAt:null};
  const ins=await env.DB.prepare("INSERT OR IGNORE INTO hq_docs(col,id,data,updated_at) VALUES('contacts',?,?,datetime('now'))").bind(id,JSON.stringify(d)).run();if(ins.meta&&ins.meta.changes)await audit(env,"cal.com","contacts",id,"created",String(b.name||email).slice(0,80))}}
async function calcomHook(req,env){
 if(!env.CALCOM_WEBHOOK_SECRET)return json({error:"Not configured"},503);
 const raw=await req.text();const given=(req.headers.get("x-cal-signature-256")||"").trim().toLowerCase();
 const k=await crypto.subtle.importKey("raw",new TextEncoder().encode(env.CALCOM_WEBHOOK_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const expected=[...new Uint8Array(await crypto.subtle.sign("HMAC",k,new TextEncoder().encode(raw)))].map(x=>x.toString(16).padStart(2,"0")).join("");
 if(!given||!sameText(expected,given)){console.log("cal.com hook rejected: signature mismatch");return json({error:"Bad signature"},401)}
 let body;try{body=JSON.parse(raw)}catch(e){return json({error:"Bad JSON"},400)}
 const ev=String(body.triggerEvent||"").toUpperCase(),p=body.payload||{};if(ev==="PING"||!p.uid)return json({ok:true});
 const a=(p.attendees||[])[0]||{},rs=p.responses||{},val=x=>x&&typeof x==="object"?x.value:x;
 const b={uid:String(p.uid),name:String(val(rs.name)||a.name||"").slice(0,80),email:String(val(rs.email)||a.email||"").toLowerCase().slice(0,120),phone:String(val(rs.attendeePhoneNumber)||a.phoneNumber||"").replace(/[^\d+]/g,"").slice(0,16),start:String(p.startTime||""),notes:String(val(rs.notes)||p.additionalNotes||"").slice(0,400)};
 if(!b.email)return json({ok:true,ignored:"no email"});
 await calTable(env);const day=cairoDay(),when=b.start?b.start.slice(0,16).replace("T"," ")+" UTC":"";
 if(ev==="BOOKING_CREATED"||ev==="BOOKING_RESCHEDULED"){
  const prev=await env.DB.prepare("SELECT uid,mailed_at FROM hq_calbookings WHERE uid=?").bind(b.uid).first();
  await env.DB.prepare("INSERT OR IGNORE INTO hq_calbookings(uid,email,name,start,status) VALUES(?,?,?,?,?)").bind(b.uid,b.email,b.name,b.start,ev==="BOOKING_CREATED"?"booked":"rescheduled").run();
  await calUpsertContact(env,b,{at:day,text:(ev==="BOOKING_CREATED"?"Booked on Cal.com: ":"Rescheduled on Cal.com to ")+(p.title||"session")+(when?" for "+when:"")+(b.notes?" · "+b.notes:""),key:"calcom:"+b.uid},true);
  // Payment email only for new bookings by people who haven't already paid for this time.
  const paid=await env.DB.prepare("SELECT 1 FROM hq_checkouts WHERE lower(email)=? AND status='paid' AND created_at>datetime('now','-30 days')").bind(b.email).first().catch(()=>null);
  if(ev==="BOOKING_CREATED"&&!(prev&&prev.mailed_at)&&!paid){try{await sendCalPayEmail(env,b);await env.DB.prepare("UPDATE hq_calbookings SET mailed_at=datetime('now') WHERE uid=?").bind(b.uid).run()}catch(e){console.log("cal.com pay email failed",String(e.message||e))}}
  return json({ok:true})}
 if(ev==="BOOKING_CANCELLED"){await env.DB.prepare("UPDATE hq_calbookings SET status='cancelled' WHERE uid=?").bind(b.uid).run();
  await calUpsertContact(env,b,{at:day,text:"Cancelled on Cal.com: "+(p.title||"session")+(when?" ("+when+")":"")+(p.cancellationReason?" · "+String(p.cancellationReason).slice(0,200):""),key:"calcom-x:"+b.uid},false);return json({ok:true})}
 return json({ok:true,ignored:ev})}
async function zernioHook(req,env){
  await mktTables(env);const secret=await kvGet(env,"zernio_webhook_secret");if(!secret)return new Response("Not configured",{status:503});
  const raw=await req.text();const sig=(req.headers.get("X-Zernio-Signature")||"").toLowerCase();
  const k=await crypto.subtle.importKey("raw",te.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const exp=[...new Uint8Array(await crypto.subtle.sign("HMAC",k,te.encode(raw)))].map(b=>b.toString(16).padStart(2,"0")).join("");
  let diff=exp.length^sig.length;for(let i=0;i<Math.min(exp.length,sig.length);i++)diff|=exp.charCodeAt(i)^sig.charCodeAt(i);
  if(diff)return new Response("Invalid signature",{status:400});
  let e;try{e=JSON.parse(raw)}catch{return new Response("Bad JSON",{status:400})}
  const eid=String(e.id||req.headers.get("X-Zernio-Event-Id")||"").slice(0,100);const ev=String(e.event||"");
  if(eid){const ins=await env.DB.prepare("INSERT OR IGNORE INTO hq_events(id,event,at,note) VALUES(?,?,datetime('now'),?)").bind(eid,ev,e.test?"test":"").run();if(!ins.meta.changes)return new Response(null,{status:200})}
  if(!["post.published","post.failed","post.partial"].includes(ev)||e.test)return new Response(null,{status:200});
  const post=e.post||{};const pid=post._id||post.id;if(!pid)return new Response(null,{status:200});
  const row=await env.DB.prepare("SELECT id,data FROM hq_docs WHERE col='content' AND json_extract(data,'$.zernioPostId')=?").bind(String(pid)).first();
  if(!row)return new Response(null,{status:200});
  const c=JSON.parse(row.data);const pl=post.platforms||[];const urls=pl.map(p=>p.platformPostUrl).filter(Boolean);
  const errs=pl.filter(p=>p.status==="failed").map(p=>p.platform+": "+(p.errorMessage||p.error||"failed"));
  c.status=ev==="post.failed"?"Failed":ev==="post.partial"?"Failed":"Published";
  if(urls.length){c.link=urls[0];c.links=urls}
  c.history=histS(c,"Zernio",ev==="post.published"?"Published":ev==="post.partial"?"Partly published":"Publishing failed",ev==="post.published"?urls.join(" "):errs.join("; ").slice(0,500));
  await saveContent(env,row.id,c);return new Response(null,{status:200});
}
async function api(path,req,env,user){
  const m=req.method;
  if(path==="/hq/api/me"&&m==="GET")return json({email:user.email,calendarManager:CALENDAR_MANAGER});
  if(path==="/hq/api/all"&&m==="GET"){await ensureTable(env);const r=(await env.DB.prepare("SELECT col,id,data,updated_at FROM hq_docs").all()).results||[];const out={};for(const x of r){(out[x.col]=out[x.col]||[]).push(Object.assign({id:x.id,_u:x.updated_at},JSON.parse(x.data)))}return json({docs:out,at:new Date().toISOString()})}
  {const dm=path.match(/^\/hq\/api\/content\/([A-Za-z0-9_-]{1,64})\/decide$/);if(dm&&m==="POST")return decide(env,dm[1],user,await readBody(req,5000))}
  if(path==="/hq/api/publishing"&&m==="GET"){await mktTables(env);return json({publishing:(await kvGet(env,"publishing"))==="on",webhook:!!(await kvGet(env,"zernio_webhook_secret"))})}
  let mm=path.match(/^\/hq\/api\/doc\/([a-z]+)(?:\/([A-Za-z0-9_-]+))?$/);
  if(mm){const [,col,id]=mm;if(!COLS.has(col))return json({error:"Unknown collection"},400);if(id&&!ID.test(id))return json({error:"Invalid id"},400);await ensureTable(env);
    if(m==="DELETE"&&id){await env.DB.prepare("DELETE FROM hq_docs WHERE col=? AND id=?").bind(col,id).run();await audit(env,user.email,col,id,"deleted for good");return json({deleted:true})}
    if(m==="PUT"||m==="POST"){const data=await readBody(req,200000);if(!data||typeof data!=="object"||Array.isArray(data))return json({error:"Invalid document"},400);delete data.id;delete data._u;const key=id||rid();
      await env.DB.prepare("INSERT INTO hq_docs(col,id,data,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(col,key,JSON.stringify(data)).run();
      await audit(env,user.email,col,key,id?(data.deletedAt?"moved to Bin":"edited"):"created",String(data.name||data.title||data.client||data.note||"").slice(0,80));return json({id:key})}
    return json({error:"Method not allowed"},405)}
  if(path.startsWith("/hq/api/cal/")){
    const s=await calendarToken(env);if(!s)return json({error:"Google Calendar is not connected",needsConnection:true},409);const tk=s.access_token;
    if(path==="/hq/api/cal/list"&&m==="GET")return json({calendars:await allCalendars(tk)});
    if(path==="/hq/api/cal/events"&&m==="GET"){const u=new URL(req.url);const st=u.searchParams.get("start"),en=u.searchParams.get("end");if(!DT.test(st||"")||!DT.test(en||""))return json({error:"Invalid range"},400);
      const cals=await allCalendars(tk);const out=[];const errs=[];
      const sec=t=>t.length===16?t+":00":t;const base="&timeZone=Africa%2FCairo&timeMin="+encodeURIComponent(sec(st)+"+02:00")+"&timeMax="+encodeURIComponent(sec(en)+"+02:00");
      await pool(cals,3,async c=>{const path="/calendars/"+encodeURIComponent(c.id)+"/events?singleEvents=true&maxResults=250";
        let p;try{p=await gcal(tk,path+"&orderBy=startTime"+base)}catch(e){
          // Some calendars (e.g. ones only shared to see free/busy) reject sorting; ask again unsorted.
          if(e.gstatus!==400){console.log("hq calendar read failed",c.summary,e.message);errs.push(c.summary+" ("+e.gstatus+(e.greason?" "+e.greason:"")+")");return}
          try{p=await gcal(tk,path+base)}catch(e2){console.log("hq calendar read failed",c.summary,e2.message);errs.push(c.summary+" ("+(e2.gstatus||"")+": "+((e2.message.match(/"message":\s*"([^"]+)"/)||[])[1]||e2.greason||"error")+")");return}}
        for(const e of p.items||[])if(e.status!=="cancelled")out.push({id:e.id,calendarId:c.id,calName:c.summary,writable:!!c.writable,summary:e.summary||"",start:e.start?.dateTime||e.start?.date||"",end:e.end?.dateTime||e.end?.date||"",allDay:!!(e.start&&e.start.date&&!e.start.dateTime),recurring:!!e.recurringEventId,description:String(e.description||"").slice(0,2000),location:String(e.location||"").slice(0,300),link:e.htmlLink||"",external:!!(e.organizer&&!e.organizer.self)})});
      out.sort((a,b)=>a.start<b.start?-1:a.start>b.start?1:0);
      return json({events:out,errors:errs})}
    // Was this event deleted in Google Calendar? (deleted events answer 404/410, or come back with status "cancelled")
    if(path==="/hq/api/cal/event-status"&&m==="GET"){const u=new URL(req.url);const c=u.searchParams.get("calendarId")||"",id=u.searchParams.get("eventId")||"";if(!c||c.length>300||!/^[a-v0-9]{5,1024}$/.test(id))return json({error:"Invalid event"},400);
      try{const e=await gcal(tk,"/calendars/"+encodeURIComponent(c)+"/events/"+encodeURIComponent(id));return json({gone:e.status==="cancelled"})}catch(e){if(e.gstatus===404||e.gstatus===410)return json({gone:true});throw e}}
    if(path==="/hq/api/cal/event"){const b=await readBody(req,20000);if(typeof b.calendarId!=="string"||b.calendarId.length>300)return json({error:"Invalid calendar"},400);const base="/calendars/"+encodeURIComponent(b.calendarId)+"/events";
      if(m==="POST"){const ev=eventBody(b);if(b.eventId){if(!/^[a-v0-9]{5,1024}$/.test(b.eventId))return json({error:"Invalid event id"},400);ev.id=b.eventId}
        try{const r=await gcal(tk,base+"?sendUpdates=none","POST",ev);return json({id:r.id})}
        catch(e){if(b.eventId&&/Google Calendar 409/.test(String(e))){const r=await gcal(tk,base+"/"+encodeURIComponent(b.eventId)+"?sendUpdates=none","PATCH",Object.assign(ev,{status:"confirmed"}));return json({id:r.id,existing:true})}throw e}}
      if(typeof b.eventId!=="string"||!b.eventId||b.eventId.length>1024)return json({error:"Invalid event"},400);
      if(m==="PATCH"){let cal=b.calendarId;
        if(typeof b.toCalendarId==="string"&&b.toCalendarId&&b.toCalendarId!==b.calendarId){if(b.toCalendarId.length>300)return json({error:"Invalid calendar"},400);await gcal(tk,base+"/"+encodeURIComponent(b.eventId)+"/move?sendUpdates=none&destination="+encodeURIComponent(b.toCalendarId),"POST");cal=b.toCalendarId}
        const r=await gcal(tk,"/calendars/"+encodeURIComponent(cal)+"/events/"+encodeURIComponent(b.eventId)+"?sendUpdates=none","PATCH",eventBody(b));return json({id:r.id,calendarId:cal})}
      if(m==="DELETE"){try{await gcal(tk,base+"/"+encodeURIComponent(b.eventId)+"?sendUpdates=none","DELETE")}catch(e){if(!/Google Calendar (404|410):/.test(String(e)))throw e}return json({deleted:true})}
    }
    return json({error:"Unknown calendar route"},404)}
  if(path==="/hq/api/analytics"&&m==="GET")return json(await analytics(env,new URL(req.url).searchParams.get("refresh")==="1"));
  if(path==="/hq/api/site"&&m==="GET"){const d=Math.min(365,Math.max(1,parseInt(new URL(req.url).searchParams.get("days"))||30));const since=new Date(Date.now()-(d-1)*864e5).toISOString().slice(0,10);
    const q=await env.DB.prepare("SELECT event,value,SUM(count) n FROM events WHERE day>=? GROUP BY event,value ORDER BY n DESC").bind(since).all();return json({since,days:d,rows:q.results||[]})}
  if(path==="/hq/api/zd"&&m==="GET")return json(await zdSummary(env));
  if(path==="/hq/api/status"&&m==="GET")return json(await statusReport(env));
  if(path==="/hq/api/paymob"&&m==="GET")return json(await paymobStatus(env));
  if(path==="/hq/api/paymob/test"&&m==="POST"){if(paymobMode(env)!=="test")return json({error:"The test button only works with Paymob test keys."},400);const name=String(user.name||"Amr").split(" ");return json(await paymobIntention(env,{amountCents:1000,name:"HQ test payment",description:"Test payment from ZD Business HQ",email:user.email,first:name[0]||"Amr",last:name.slice(1).join(" ")||"El Hadeka",ref:"hqtest-"+Date.now(),redirect:ORIGIN+"/hq/home/?paymob=done"}))}
  if(path==="/hq/api/briefing"&&(m==="GET"||m==="POST")){try{return json(await briefing(env,m==="POST"))}catch(e){return json({error:String(e.message||e).slice(0,240)},502)}}
  if(path==="/hq/api/ask"&&m==="POST"){const b=await req.json().catch(()=>({}));const q=String(b.q||"").trim().slice(0,500);if(!q)return json({error:"Type a question."},400);try{return json(await askHQ(env,q))}catch(e){return json({error:String(e.message||e).slice(0,240)},502)}}
  if(path==="/hq/api/export"&&m==="GET"){await ensureTable(env);const r=(await env.DB.prepare("SELECT col,id,data,updated_at FROM hq_docs ORDER BY col,id").all()).results||[];await audit(env,user.email,"all","export","exported everything");
    return new Response(JSON.stringify({exportedAt:new Date().toISOString(),docs:r.map(x=>({col:x.col,id:x.id,updatedAt:x.updated_at,data:JSON.parse(x.data)}))},null,1),{headers:{...htmlHeaders,"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="zd-hq-export-${new Date().toISOString().slice(0,10)}.json"`}})}
  if(path==="/hq/api/plan-clients"){await planTable(env);
    if(m==="GET"){const r=(await env.DB.prepare("SELECT email,name,added_at,expires_at, expires_at>datetime('now') AS active FROM plan_clients ORDER BY expires_at DESC").all()).results||[];return json({days:PLAN_DAYS,clients:r})}
    const b=await readBody(req,4000);const email=String(b.email||"").trim().toLowerCase();
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)||email.length>200)return json({error:"Enter a valid email"},400);
    if(m==="POST"){const name=String(b.name||"").trim().slice(0,120);
      await env.DB.prepare("INSERT INTO plan_clients(email,name,added_at,expires_at) VALUES(?,?,datetime('now'),datetime('now','+"+PLAN_DAYS+" days')) ON CONFLICT(email) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),plan_clients.name),expires_at=excluded.expires_at").bind(email,name).run();
      await audit(env,user.email,"plan_clients",email,"grant 90 days",name);return json({ok:true})}
    if(m==="DELETE"){await env.DB.prepare("DELETE FROM plan_clients WHERE email=?").bind(email).run();await audit(env,user.email,"plan_clients",email,"removed","");return json({ok:true})}
    return json({error:"Method not allowed"},405)}
  if(path==="/hq/api/cal-status"&&m==="GET"){const row=await calendarRow(env);return json({connected:!!row,canConnect:user.email===CALENDAR_MANAGER})}
  return json({error:"Unknown HQ API route"},404);
}
async function callback(req,env) {
  const url=new URL(req.url);
  const v=cookies(req)[OAUTH_NAME]||"";
  const [mode,state,sig]=v.split(".");
  if(!["login","calendar","plan"].includes(mode)||!state||url.searchParams.get("state")!==state||!await verifySig("oauth|"+mode+"."+state,sig,env.GOOGLE_CLIENT_SECRET))return new Response("Invalid or expired Google sign-in request",{status:403,headers:htmlHeaders});
  if(!url.searchParams.has("code"))return new Response("Google authorization was cancelled",{status:400,headers:htmlHeaders});
  try {
    const tok=await exchange(url.searchParams.get("code"),env);
    const profile=await googleProfile(tok.access_token,mode==="plan");
    if(mode==="plan"){const em=String(profile.email).toLowerCase();const ok=await planAllowed(env,em);
      if(!ok)return planPage("This account isn’t on the list","The money plan tool is for clients of Amr’s 1-on-1 sessions. If you booked a session, sign in with the same Google email you gave Amr, or ask him to add this one: "+em.replace(/[<>&"]/g,"")+".<br><br><a href=\"/plan/login\">Try another Google account</a>",403);
      return redirect(ORIGIN+"/plan/",[cookieP(PLAN_SESSION,await signSession(profile.sub,em,env.GOOGLE_CLIENT_SECRET),604800),cookie(OAUTH_NAME,"",0)])}
    if(mode==="calendar"){
      if(profile.email!==CALENDAR_MANAGER)return redirect(ORIGIN+"/hq/home/?calendar=owner-only",[cookie(OAUTH_NAME,"",0),cookie(SESSION_NAME,await signSession(profile.sub,profile.email,env.GOOGLE_CLIENT_SECRET),604800)]);
      const prev=await calendarRow(env);
      let prior={};if(prev)try{prior=await unseal(prev.encrypted,env)}catch{}
      const stored={access_token:tok.access_token,refresh_token:tok.refresh_token||prior.refresh_token,expires_at:Date.now()+(tok.expires_in||3600)*1000};
      if(!stored.refresh_token)throw Error("Google did not return Calendar refresh permission");
      await env.DB.prepare("INSERT INTO hq_google_tokens(account,encrypted,calendar_id,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(account) DO UPDATE SET encrypted=excluded.encrypted,updated_at=excluded.updated_at").bind(CALENDAR_MANAGER,await seal(stored,env),null).run();
    }
    const ses=await signSession(profile.sub,profile.email,env.GOOGLE_CLIENT_SECRET);
    return redirect(ORIGIN+"/hq/home/"+(mode==="calendar"?"?calendar=connected":""),[cookie(SESSION_NAME,ses,604800),cookie(OAUTH_NAME,"",0)]);
  }catch(e){return new Response("ZD HQ Google login: "+String(e.message||e),{status:401,headers:{...htmlHeaders,"Content-Type":"text/plain; charset=utf-8"}})}
}
export async function onRequest(context) {
  const {request:req,env}=context;
  const url=new URL(req.url),path=url.pathname;
  const isPlan=path==="/plan"||path.startsWith("/plan/");
  if(path.startsWith("/pay/api/")){if(!env.DB)return new Response("Not configured",{status:503});return payApi(req,env,path)}
  if(!isPlan&&!(path==="/hq" || path.startsWith("/hq/")))return context.next();
  if(!env.GOOGLE_CLIENT_SECRET || !env.DB)return new Response("ZD HQ private access is not configured",{status:503,headers:htmlHeaders});
  if(isPlan)return planRoute(context,env,req,path);
  // Keep social and newsletter numbers synced in the background whenever the HQ is opened (at most every 6 hours per source).
  if(req.method==="GET"&&!path.startsWith("/hq/api/")&&context.waitUntil){context.waitUntil(analytics(env,false).catch(e=>console.log("hq background sync failed",String(e&&e.message||e))));context.waitUntil(dailyBackup(env).catch(e=>console.log("hq backup failed",String(e&&e.message||e))))}
  if(path==="/hq/hook/zernio" && req.method==="POST")return zernioHook(req,env);
  if(path==="/hq/hook/paymob" && req.method==="POST")return paymobHook(req,env);
  if(path==="/hq/hook/calcom" && req.method==="POST")return calcomHook(req,env);
  if(path==="/hq/auth/login" && req.method==="GET")return startOAuth("login",env);
  if(path==="/hq/auth/callback" && req.method==="GET")return callback(req,env);
  const user=await sessionUser(req,env);
  if(!user){
    if(path.startsWith("/hq/api/"))return json({error:"Unauthorized"},401);
    return redirect(ORIGIN+"/hq/auth/login");
  }
  if(path==="/hq/auth/logout")return redirect(ORIGIN+"/hq/auth/login",[cookie(SESSION_NAME,"",0)]);
  if(path==="/hq/auth/calendar" && req.method==="GET"){if(user.email!==CALENDAR_MANAGER)return redirect(ORIGIN+"/hq/home/?calendar=owner-only");return startOAuth("calendar",env)}
  if(path==="/hq"||path==="/hq/"||path==="/hq/index.html")return redirect(ORIGIN+"/hq/home/");
  if(path.startsWith("/hq/api/")){
    if(req.method!=="GET" && ![ORIGIN,env.HQ_TEST_ORIGIN].includes(req.headers.get("Origin")))return json({error:"Origin rejected"},403);
    try{return await api(path,req,env,user)}catch(e){return json({error:String(e.message||e)},e.status||502)}
  }
  const response=await context.next();
  const headers=new Headers(response.headers);
  for(const [k,v] of Object.entries(htmlHeaders))headers.set(k,v);
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
