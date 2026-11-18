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
  const r=await env.ZD_DB.prepare("SELECT email,display_name,created_at FROM users WHERE email NOT LIKE '%@guest.zd.app' AND is_demo=0").all();
  return (r.results||[]).filter(u=>!OWNER_EMAILS.has(emailKey(u.email))).map(u=>{const n=String(u.display_name||"").trim();return {email:emailKey(u.email),name:n&&n.toLowerCase()!==emailKey(u.email).split("@")[0]&&!/^guest$/i.test(n)?n.slice(0,80):"",since:String(u.created_at||"").slice(0,10)}})}
async function brevoSubscribers(env,key){if(!key)return null;const H={"api-key":key,accept:"application/json"};const list=Number(env.NEWSLETTER_LIST_ID||2);const out=[];
  for(let off=0;off<10000;off+=500){const j=await getJSON("https://api.brevo.com/v3/contacts/lists/"+list+"/contacts?limit=500&offset="+off+"&sort=desc",H);const cs=j.contacts||[];
    for(const c of cs){if(c.emailBlacklisted||!c.email)continue;const a=c.attributes||{};out.push({email:emailKey(c.email),name:[a.FIRSTNAME,a.LASTNAME].filter(x=>typeof x==="string"&&x.trim()).join(" ").trim().slice(0,80),since:String(c.createdAt||"").slice(0,10)})}
    if(cs.length<500)break}
  return out}
async function syncContacts(env,brevoKey){
  await ensureTable(env);
  const errors=[];let zd=null,nl=null;
  try{zd=await zdAccounts(env);if(!zd)errors.push("ZD AI: not connected")}catch(e){errors.push("ZD AI: "+String(e.message||e).slice(0,160))}
  try{nl=await brevoSubscribers(env,brevoKey);if(!nl)errors.push("Newsletter: Brevo key missing")}catch(e){errors.push("Newsletter: "+String(e.message||e).slice(0,160))}
  const rows=(await env.DB.prepare("SELECT id,data FROM hq_docs WHERE col='contacts'").all()).results||[];
  const byEmail=new Map();for(const r of rows){let d={};try{d=JSON.parse(r.data)}catch{}if(d.email)byEmail.set(emailKey(d.email),{id:r.id,d})}
  const incoming=new Map();
  const add=(list,src)=>{for(const x of list||[]){const k=x.email;if(!k)continue;const cur=incoming.get(k)||{email:k,name:"",src:{}};if(!cur.name&&x.name)cur.name=x.name;cur.src[src]=x.since||"";incoming.set(k,cur)}};
  add(zd,"zd");add(nl,"newsletter");
  let added=0,updated=0;const now=new Date().toISOString();
  for(const [k,x] of incoming){const hit=byEmail.get(k);
    if(hit){const d=hit.d,before=JSON.stringify(d);
      if(!d.name&&x.name)d.name=x.name;
      if(zd&&"zd" in x.src)d.zdSince=x.src.zd;else if(zd)delete d.zdSince;
      if(nl&&"newsletter" in x.src)d.newsletterSince=x.src.newsletter;else if(nl)delete d.newsletterSince;
      if(JSON.stringify(d)!==before){d.syncedAt=now;await env.DB.prepare("UPDATE hq_docs SET data=?,updated_at=datetime('now') WHERE col='contacts' AND id=?").bind(JSON.stringify(d),hit.id).run();updated++}}
    else{const id=await contactId(k);const d={name:x.name,email:k,type:"Audience",stage:"New",createdAt:now,deletedAt:null,createdBy:"sync",syncedAt:now};
      if("zd" in x.src)d.zdSince=x.src.zd;if("newsletter" in x.src)d.newsletterSince=x.src.newsletter;
      const ins=await env.DB.prepare("INSERT INTO hq_docs(col,id,data,updated_at) VALUES('contacts',?,?,datetime('now')) ON CONFLICT(col,id) DO NOTHING").bind(id,JSON.stringify(d)).run();
      if(ins&&ins.meta&&ins.meta.changes){await audit(env,"sync","contacts",id,"created",(x.name||k).slice(0,80));added++}}}
  // People who left both sources stay as contacts (your notes are kept); their source dates are cleared above.
  return {added,updated,zdAccounts:zd?zd.length:null,subscribers:nl?nl.length:null,errors}}

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

/* ---------- status: every connection, its last sync and its last error ---------- */
async function statusReport(env){await metricsTable(env);
  const rows=(await env.DB.prepare("SELECT source,fetched_at,error FROM hq_metrics WHERE source NOT LIKE 'brevo:%'").all()).results||[];
  const at=r=>r&&r.fetched_at?r.fetched_at.replace(" ","T")+"Z":null;const get=k=>rows.find(r=>r.source===k);
  const cal=await calendarRow(env).catch(()=>null);
  let rates=null;if(env.RATES){try{const l=await env.RATES.get("latest","json"),a=await env.RATES.get("auto","json");rates={latest:l&&l.latest,lastAttempt:l&&l.lastAttempt,errors:(l&&l.errors)||[],autoCheckedAt:a&&a.checkedAt,decision:a&&a.decision&&a.decision.status}}catch(e){rates={error:String(e.message||e)}}}
  const audits=await env.DB.prepare("SELECT at,who,col,doc,action,label FROM hq_audit ORDER BY at DESC LIMIT 50").all().then(r=>r.results||[]).catch(()=>[]);
  return {calendar:{connected:!!cal},zernio:{at:at(get("zernio")),error:get("zernio")?get("zernio").error:"never synced"},brevo:{at:at(get("brevo")),error:get("brevo")?get("brevo").error:"never synced"},
    contacts:{at:at(get("contacts")),error:get("contacts")?get("contacts").error:"never synced"},zd:{connected:!!env.ZD_DB},rates,audits}}

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
async function api(path,req,env,user){
  const m=req.method;
  if(path==="/hq/api/me"&&m==="GET")return json({email:user.email,calendarManager:CALENDAR_MANAGER});
  if(path==="/hq/api/all"&&m==="GET"){await ensureTable(env);const r=(await env.DB.prepare("SELECT col,id,data,updated_at FROM hq_docs").all()).results||[];const out={};for(const x of r){(out[x.col]=out[x.col]||[]).push(Object.assign({id:x.id,_u:x.updated_at},JSON.parse(x.data)))}return json({docs:out,at:new Date().toISOString()})}
  let mm=path.match(/^\/hq\/api\/doc\/([a-z]+)(?:\/([A-Za-z0-9_-]+))?$/);
  if(mm){const [,col,id]=mm;if(!COLS.has(col))return json({error:"Unknown collection"},400);if(id&&!ID.test(id))return json({error:"Invalid id"},400);await ensureTable(env);
    if(m==="DELETE"&&id){await env.DB.prepare("DELETE FROM hq_docs WHERE col=? AND id=?").bind(col,id).run();await audit(env,user.email,col,id,"deleted for good");return json({deleted:true})}
    if(m==="PUT"||m==="POST"){const data=await readBody(req,200000);if(!data||typeof data!=="object"||Array.isArray(data))return json({error:"Invalid document"},400);delete data.id;delete data._u;const key=id||rid();
      await env.DB.prepare("INSERT INTO hq_docs(col,id,data,updated_at) VALUES(?,?,?,datetime('now')) ON CONFLICT(col,id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at").bind(col,key,JSON.stringify(data)).run();
      await audit(env,user.email,col,key,id?(data.deletedAt?"moved to Bin":"edited"):"created",String(data.title||data.name||data.client||data.note||"").slice(0,80));return json({id:key})}
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
  if(path==="/hq/api/export"&&m==="GET"){await ensureTable(env);const r=(await env.DB.prepare("SELECT col,id,data,updated_at FROM hq_docs ORDER BY col,id").all()).results||[];await audit(env,user.email,"all","export","exported everything");
    return new Response(JSON.stringify({exportedAt:new Date().toISOString(),docs:r.map(x=>({col:x.col,id:x.id,updatedAt:x.updated_at,data:JSON.parse(x.data)}))},null,1),{headers:{...htmlHeaders,"Content-Type":"application/json; charset=utf-8","Content-Disposition":`attachment; filename="zd-hq-export-${new Date().toISOString().slice(0,10)}.json"`}})}
  if(path==="/hq/api/cal-status"&&m==="GET"){const row=await calendarRow(env);return json({connected:!!row,canConnect:user.email===CALENDAR_MANAGER})}
  return json({error:"Unknown HQ API route"},404);
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
  if(!(path==="/hq" || path.startsWith("/hq/")))return context.next();
  if(!env.GOOGLE_CLIENT_SECRET || !env.DB)return new Response("ZD HQ private access is not configured",{status:503,headers:htmlHeaders});
  // Keep social and newsletter numbers synced in the background whenever the HQ is opened (at most every 6 hours per source).
  if(req.method==="GET"&&!path.startsWith("/hq/api/")&&context.waitUntil){context.waitUntil(analytics(env,false).catch(e=>console.log("hq background sync failed",String(e&&e.message||e))));context.waitUntil(dailyBackup(env).catch(e=>console.log("hq backup failed",String(e&&e.message||e))))}
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
