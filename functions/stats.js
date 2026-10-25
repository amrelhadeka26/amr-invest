// Private usage dashboard: /stats?key=YOUR_KEY (the key is stored in the database, not in this code).
const LABELS = {
  tab: { compare: 'Calculate', portfolio: 'Portfolio', analyze: 'Analyze', goal: 'Goals' },
  use: { compare: 'Calculate', portfolio: 'Portfolio', analyze: 'Analyze', goal: 'Goals' },
  tile: { compare: 'Calculate', calculate: 'Calculate', portfolio: 'Portfolio', analyze: 'Analyze', goals: 'Goals', goal: 'Goals' },
  outlook: { cautious: 'Cautious', balanced: 'Balanced', past: 'Last 10 years' },
  currency: { usd: 'Switched to USD', egp: 'Switched to EGP' }
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = n => Number(n || 0).toLocaleString('en-US');

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${title}</title>
<style>
:root{--ink:#000;--blue:#0B5CC1;--paper:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Inter,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:28px 16px 64px}
h1{font-size:34px;letter-spacing:-0.03em;margin:0}
.sub{margin:6px 0 0;font-size:15px}
.range{display:inline-flex;gap:4px;padding:4px;border:1.5px solid var(--blue);border-radius:999px;margin:18px 0 22px}
.range a{padding:8px 16px;border-radius:999px;text-decoration:none;color:var(--ink);font-weight:700;font-size:14px}
.range a.on{background:var(--blue);color:#fff}
.kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
@media(min-width:700px){.kpis{grid-template-columns:repeat(4,minmax(0,1fr))}}
.kpi{border:1.5px solid var(--ink);border-radius:18px;padding:16px}
.kpi.main{background:var(--blue);border-color:var(--blue);color:#fff}
.kpi span{display:block;font-size:13px;font-weight:600}
.kpi b{display:block;font-size:30px;letter-spacing:-0.02em;margin-top:6px;font-variant-numeric:tabular-nums}
h2{font-size:20px;letter-spacing:-0.02em;margin:34px 0 12px}
.rows{border-top:1.5px solid var(--ink)}
.row{display:grid;grid-template-columns:minmax(0,1fr) 72px;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--ink)}
.row .name{font-size:15px}
.bar{height:8px;border-radius:4px;background:var(--blue);margin-top:6px;min-width:3px}
.row .n{text-align:right;font-weight:700;font-variant-numeric:tabular-nums}
.empty{font-size:15px;padding:12px 0}
.note{font-size:13px;margin-top:36px}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

function list(rows, labels) {
  if (!rows.length) return '<p class="empty">Nothing yet.</p>';
  const max = Math.max(...rows.map(r => r.n));
  return '<div class="rows">' + rows.map(r =>
    `<div class="row"><div><div class="name">${esc((labels && labels[r.value]) || r.value || '—')}</div><div class="bar" style="width:${Math.max(2, r.n / max * 100)}%"></div></div><div class="n">${fmt(r.n)}</div></div>`
  ).join('') + '</div>';
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const headers = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
  if (!env.DB) return new Response(page('Stats', '<h1>Stats</h1><p class="sub">The database is not connected to this site yet. Add the D1 binding named DB in Cloudflare, then redeploy.</p>'), { status: 503, headers });

  const key = url.searchParams.get('key') || '';
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'dashboard_key'").first();
  if (!row || !key || key !== row.value) return new Response('Not found', { status: 404 });

  const days = [7, 30, 90].includes(Number(url.searchParams.get('days'))) ? Number(url.searchParams.get('days')) : 30;
  const today = new Date();
  const since = new Date(today.getTime() - (days - 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  const q = (sql, ...b) => env.DB.prepare(sql).bind(...b).all().then(r => r.results || []);
  const totals = await q('SELECT event, value, SUM(count) AS n FROM events WHERE day >= ?1 GROUP BY event, value ORDER BY n DESC', since);
  const daily = await q("SELECT day AS value, SUM(count) AS n FROM events WHERE day >= ?1 AND event = 'view' AND value = 'grow' GROUP BY day ORDER BY day DESC", since);

  const pick = ev => totals.filter(r => r.event === ev);
  const sum = (ev, val) => totals.filter(r => r.event === ev && (val === undefined || r.value === val)).reduce((a, r) => a + r.n, 0);
  const lessons = pick('view').filter(r => r.value.startsWith('lesson-')).map(r => ({ value: r.value.replace('lesson-', '').replace(/-/g, ' '), n: r.n }));
  const pages = pick('view').filter(r => !r.value.startsWith('lesson-'));

  const link = d => `<a href="?key=${encodeURIComponent(key)}&days=${d}" class="${d === days ? 'on' : ''}">${d} days</a>`;
  const body = `
<h1>grow. stats</h1>
<p class="sub">Last ${days} days, Cairo time. Counts are per browser session, anonymous.</p>
<nav class="range">${[7, 30, 90].map(link).join('')}</nav>
<div class="kpis">
  <div class="kpi main"><span>Opened Grow</span><b>${fmt(sum('view', 'grow'))}</b></div>
  <div class="kpi"><span>Used a tool</span><b>${fmt(sum('use'))}</b></div>
  <div class="kpi"><span>Set a goal</span><b>${fmt(sum('goal'))}</b></div>
  <div class="kpi"><span>Homepage visits</span><b>${fmt(sum('view', 'home'))}</b></div>
</div>
<h2>Grow opens per day</h2>${list(daily)}
<h2>Tools people used</h2>${list(pick('use'), LABELS.use)}
<h2>Tabs opened</h2>${list(pick('tab'), LABELS.tab)}
<h2>Outlook chosen</h2>${list(pick('outlook'), LABELS.outlook)}
<h2>Currency switches</h2>${list(pick('currency'), LABELS.currency)}
<h2>Homepage: tiles and Explore</h2>${list(pick('tile').concat(pick('explore').map(r => ({ value: 'Explore grow button', n: r.n }))), LABELS.tile)}
<h2>Lessons read</h2>${list(lessons)}
<h2>Where people came from (src links)</h2>${list(pick('src'))}
<h2>Page views</h2>${list(pages)}
<p class="note">Add ?src=name to any link you share (for example invest.amrelhadeka.com/grow?src=reel12) to see it under "Where people came from". For overall traffic, devices and countries, use Cloudflare Web Analytics.</p>`;
  return new Response(page('grow. stats', body), { headers });
}
