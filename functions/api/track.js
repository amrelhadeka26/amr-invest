// Anonymous usage counter for the site.
// Stores only daily counts per event: no IP addresses, no cookies, no personal data.
const EVENTS = new Set(['view', 'tab', 'use', 'currency', 'outlook', 'goal', 'tile', 'explore', 'lesson', 'src']);
const VALUE = /^[a-z0-9_-]{0,40}$/;

const cairoDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

function allowedOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    if (host === new URL(request.url).hostname) return true;
    return host === 'amrelhadeka.com' || host.endsWith('.amrelhadeka.com') || host.endsWith('.pages.dev');
  } catch (e) {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  if (!env.DB || !allowedOrigin(request)) return done;
  let body;
  try {
    const text = await request.text();
    if (text.length > 300) return done;
    body = JSON.parse(text);
  } catch (e) {
    return done;
  }
  const event = String(body.e || '');
  const value = String(body.v || '').toLowerCase();
  if (!EVENTS.has(event) || !VALUE.test(value)) return done;
  try {
    await env.DB.prepare(
      'INSERT INTO events (day, event, value, count) VALUES (?1, ?2, ?3, 1) ' +
      'ON CONFLICT(day, event, value) DO UPDATE SET count = count + 1'
    ).bind(cairoDay(), event, value).run();
  } catch (e) {
    // Counting must never break the site.
  }
  return done;
}

export function onRequestGet() {
  return new Response('Not found', { status: 404 });
}
