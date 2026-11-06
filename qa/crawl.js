const { chromium, devices } = require('playwright');
const BASE='http://localhost:8098';
const fs=require('fs');
const DISC_EN='Educational content only, not personal financial advice. Investing involves risk, including loss of capital.';
const DISC_AR='محتوى تعليمي بس، مش نصيحة مالية شخصية. الاستثمار فيه مخاطرة، وممكن تخسر جزء من فلوسك.';
const pages=fs.readFileSync('qa/pages.txt','utf8').trim().split('\n').map(p=>p.replace(/^\./,'').replace(/index\.html$/,''));
const views={se:{...devices['iPhone SE']},phone:{...devices['iPhone 13']},android:{...devices['Pixel 7']},tablet:{...devices['iPad (gen 7)']},laptop:{viewport:{width:1366,height:768}},desktop:{viewport:{width:1920,height:1080}}};
(async()=>{
  const b=await chromium.launch(); const out={pages:{},links:new Set(),ext:new Set(),issues:[]};
  for(const [vn,opt] of Object.entries(views)){
    const c=await b.newContext(opt);
    for(const p of pages){
      const pg=await c.newPage(); const errs=[]; const bad=[];
      pg.on('pageerror',e=>errs.push('pageerror: '+e.message));
      pg.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text().slice(0,160))});
      pg.on('response',r=>{const u=r.url(); if(u.startsWith(BASE)&&r.status()>=400)bad.push(r.status()+' '+u)});
      pg.on('requestfailed',r=>{const u=r.url(); if(u.startsWith(BASE))bad.push('FAILED '+u)});
      let st=0; try{const r=await pg.goto(BASE+p,{waitUntil:'networkidle',timeout:20000}); st=r.status()}catch(e){errs.push('goto '+e.message.slice(0,80))}
      await pg.waitForTimeout(400);
      const vw=(opt.viewport||{}).width||9999;
      const info=await pg.evaluate((vw)=>{
        const de=document.documentElement; const over=de.scrollWidth>vw+1||window.innerWidth>vw+1; // compare with the real screen width: a too-wide page also widens innerWidth
        const wide=[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>vw+1&&getComputedStyle(e).position!=='fixed'&&!e.closest('[hidden],details:not([open])')}).slice(0,4).map(e=>e.tagName+'.'+e.className.toString().slice(0,30));
        const links=[...document.querySelectorAll('a[href]')].map(a=>a.href);
        const imgs=[...document.querySelectorAll('img')].filter(i=>!i.hasAttribute('alt')).map(i=>i.src);
        const broken=[...document.querySelectorAll('img')].filter(i=>i.complete&&i.naturalWidth===0&&i.src&&!i.closest('[hidden]')).map(i=>i.src);
        const small=[...document.querySelectorAll('a,button,input,select')].filter(e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&(r.height<24||r.width<24)&&e.offsetParent}).slice(0,6).map(e=>(e.tagName+':'+(e.textContent||e.name||'').trim().slice(0,20)+':'+Math.round(e.getBoundingClientRect().width)+'x'+Math.round(e.getBoundingClientRect().height)));
        const unl=[...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(e=>!e.classList.contains('hp')&&!e.labels?.length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&e.offsetParent).map(e=>e.id||e.name);
        return {over,wide,links,imgs,broken,small,unl,text:document.body.innerText,title:document.title,lang:de.lang,dir:de.dir,h1:document.querySelectorAll('h1').length};
      },vw);
      const ar=p.startsWith('/ar/');
      const disc=info.text.includes(ar?DISC_AR:DISC_EN);
      out.pages[vn+' '+p]={st,errs,bad,over:info.over,wide:info.wide,imgs:info.imgs,broken:info.broken,small:info.small,unl:info.unl,disc,title:info.title,lang:info.lang,dir:info.dir,h1:info.h1};
      if(vn==='phone') info.links.forEach(l=>{ if(l.startsWith(BASE)) out.links.add(l.split('#')[0]); else if(/^https?:/.test(l)) out.ext.add(l)});
      await pg.close();
    }
    await c.close();
  }
  // check internal links
  const c=await b.newContext(); const pg=await c.newPage(); const linkRes={};
  for(const l of out.links){ try{const r=await pg.request.get(l,{maxRedirects:5}); linkRes[l]=r.status()}catch(e){linkRes[l]='ERR'} }
  fs.writeFileSync('qa/crawl.json',JSON.stringify({pages:out.pages,links:linkRes,ext:[...out.ext]},null,1));
  await b.close();
})();
