const { chromium } = require('playwright');
const BASE='http://localhost:8098/calculator/';
const scen=JSON.parse(process.argv[2]);
(async()=>{
  const b=await chromium.launch(); const c=await b.newContext(); const p=await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.route('**/nothing/**',r=>r.abort()); await p.route('**/grow-data.amrelhadeka.workers.dev/**',r=>r.abort());
  await p.goto(BASE,{waitUntil:'networkidle'});
  const res=[];
  for(const s of scen){
    await p.click('#reset');
    if(s.cur==='USD') await p.click('.seg.cur button[data-cur=USD]');
    if(s.preset) await p.click(`.preset button[data-p=${s.preset}]`);
    await p.evaluate(()=>{document.getElementById('assume').open=true});
    for(const [k,v] of Object.entries(s.v||{})){ await p.evaluate(([k,v])=>{const el=document.getElementById(k); el.value=v; el.dispatchEvent(new Event('input',{bubbles:true}));},[k,String(v)]); }
    const out=await p.evaluate(()=>{
      const rows=[...document.querySelectorAll('#tbody tr')].map(tr=>[...tr.children].map(td=>td.textContent));
      const g=[...document.querySelectorAll('#gBody tr')].map(tr=>[...tr.children].map(td=>td.textContent));
      return {rows,g,put:document.getElementById('putVal').textContent,calc:document.getElementById('calcVal').textContent,beat:document.getElementById('bestVal').textContent,pf:document.getElementById('pfTxt').textContent,pfRisk:document.getElementById('pfRisk').textContent,gM:document.getElementById('gNote').textContent,years:document.getElementById('yearsOut').textContent,stamp:document.getElementById('dataStamp').textContent};
    });
    res.push({s,out});
  }
  console.log(JSON.stringify({res,errs}));
  await b.close();
})();
