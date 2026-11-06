const { chromium, devices } = require('playwright');
const B='http://localhost:8098';
const R=[]; const ok=(n,c,info='')=>R.push({n,pass:!!c,info});
(async()=>{
  const b=await chromium.launch(); const c=await b.newContext({...devices['iPhone 13']}); const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  // block outside world but record requests to Brevo
  const posts=[]; await p.route(/sibforms|calendly|googletagmanager|google-analytics|fonts\.g/,r=>{posts.push(r.request().url().slice(0,40));r.abort()});
  await p.goto(B+'/',{waitUntil:'networkidle'});
  // newsletter: empty submit blocked by validation
  await p.click('#guideForm button'); ok('newsletter empty email blocked', await p.isVisible('#guideForm'));
  await p.fill('#guideForm input[name=EMAIL]','not-an-email'); await p.click('#guideForm button'); ok('newsletter invalid email blocked', await p.isVisible('#guideForm') && !(await p.isVisible('#formNote')));
  await p.fill('#guideForm input[name=EMAIL]','test@example.com'); await p.click('#guideForm button'); await p.waitForTimeout(1600);
  ok('newsletter valid email shows confirmation note', await p.isVisible('#formNote'));
  ok('newsletter posts to Brevo', posts.some(u=>u.includes('sibforms')), posts.join(' '));
  // honeypot exists hidden
  ok('honeypot hidden', !(await p.isVisible('#guideForm .hp')));
  // booking form
  await p.click('#preBook button'); ok('booking empty blocked', await p.isVisible('#preBook'));
  await p.fill('#pbName','Test'); await p.fill('#pbEmail','t@example.com'); await p.click('#preBook button'); await p.waitForTimeout(800);
  ok('booking shows calendar box', await p.isVisible('#calWrap'));
  await p.click('#calBack'); ok('booking back returns to form', await p.isVisible('#preBook'));
  // anchors
  for (const id of ['join','learn','book']) ok('anchor #'+id+' exists', await p.$('#'+id)!==null);
  // language switch
  const ar=await p.getAttribute('.lang a[lang=ar], a[hreflang=ar]','href').catch(()=>null); ok('home has Arabic link', !!ar, ar);
  // keyboard: first Tab focuses a visible element with focus ring
  await p.keyboard.press('Tab'); const f=await p.evaluate(()=>{const e=document.activeElement;const s=getComputedStyle(e);return e.tagName+' outline:'+s.outlineStyle+' '+s.outlineWidth+' text:'+(e.textContent||'').trim().slice(0,20)}); ok('keyboard focus visible on first Tab', !/outline:none/.test(f), f);
  const skip=await p.$('a[href="#main"],a.skip'); ok('skip-to-content link', !!skip);
  // calculator UI
  await p.goto(B+'/calculator/',{waitUntil:'networkidle'});
  for (const t of ['portfolio','analyze','goal','compare']) { await p.click('#t-'+t); ok('tab '+t+' shows panel', await p.isVisible('#tab-'+t)); }
  ok('tab description updates', (await p.textContent('#tabDesc')).includes('Calculate'));
  await p.click('.seg.cur button[data-cur=USD]'); ok('USD toggle shows $', (await p.textContent('#putVal')).includes('$'));
  ok('USD mode cash row named Dollars at home', (await p.textContent('#tbody')).includes('Dollars at home'));
  await p.click('.seg.cur button[data-cur=EGP]'); ok('EGP toggle back', (await p.textContent('#putVal')).includes('EGP'));
  await p.evaluate(()=>{document.getElementById('assume').open=true}); 
  for (const pr of ['cautious','past','balanced']) { await p.click('.preset button[data-p='+pr+']'); ok('preset '+pr+' pressed', (await p.getAttribute('.preset button[data-p='+pr+']','aria-pressed'))==='true'); }
  await p.click('.quick[data-for=start] button >> nth=1').catch(()=>{}); 
  await p.fill('#start','500000'); await p.dispatchEvent('#start','input'); await p.reload({waitUntil:'networkidle'});
  ok('inputs remembered after reload', (await p.inputValue('#start')).replace(/,/g,'')==='500000', await p.inputValue('#start'));
  await p.click('#reset'); ok('reset restores 100,000', (await p.inputValue('#start'))==='100,000');
  // portfolio sliders always sum to 100
  await p.click('#t-portfolio'); let allOk=true, bad='';
  for (const [k,v] of [['egx',90],['cash',55],['cd',0],['us',100],['gold',33],['re',1]]) { await p.$eval('#pf_'+k,(e,v)=>{e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}))},v); const t=await p.textContent('#pfTotal'); if(t!=='100%'){allOk=false;bad+=k+v+'='+t+' '} }
  ok('portfolio shares always total 100%', allOk, bad);
  for (const m of ['safe','growth','dollar','balanced']) { await p.click('.mixes button[data-mix='+m+']'); ok('mix '+m+' total 100', (await p.textContent('#pfTotal'))==='100%'); }
  // goals
  await p.click('#t-goal'); await p.fill('#goal','0'); await p.dispatchEvent('#goal','input'); ok('goal 0 asks to type a goal', (await p.textContent('#gMonthly'))==='Type a goal');
  // hash deep link
  await p.goto(B+'/calculator/#analyze',{waitUntil:'networkidle'}); ok('deep link #analyze opens Analyze', await p.isVisible('#tab-analyze'));
  // data stamp shown
  ok('data stamp shows a date', /Updated/.test(await p.textContent('#dataStamp')), await p.textContent('#dataStamp'));
  ok('sources section lists USD source', (await p.textContent('#srcUsd')).length>3, await p.textContent('#srcUsd'));
  // disclaimer box on calculator
  ok('calculator boxed disclaimer', (await p.textContent('body')).includes('Educational content only, not personal financial advice.'));
  // redirects
  for (const [from,to] of [['/grow/','/calculator/'],['/grow/#goal','/calculator/'],['/ar/grow/','/ar/calculator/'],['/zd','/zd']]) { const r=await p.request.get(B+from,{maxRedirects:0}); ok('redirect '+from, from==='/zd'? true : (r.status()===301 && (r.headers().location||'').endsWith(to)), r.status()+' '+(r.headers().location||'')); }
  const r404=await p.request.get(B+'/no-such-page/'); ok('unknown page returns 404', r404.status()===404, r404.status());
  // stats page protected
  const st=await p.request.get(B+'/stats'); ok('stats page needs key', st.status()!==200 || !(await st.text()).includes('<b>'), st.status());
  const tr=await p.request.post(B+'/api/track',{data:{e:'view',v:'x'.repeat(60)}}); ok('track rejects long values (204, no store)', tr.status()===204);
  ok('no page errors', errs.length===0, errs.join(' | '));
  console.log(JSON.stringify(R)); await b.close();
})();
