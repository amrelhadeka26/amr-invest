// ZD AI lives inside the website: invest.amrelhadeka.com/zd/* is served by the ZD AI app (Cloudflare Worker "zd-app").
// The app uses relative paths, so the same build works here and at its own workers.dev address.
const APP = 'https://zd-app.amrelhadeka.workers.dev';
// Shared with the ZD AI Worker so it can trust the visitor's address we pass on (used only for the guest-account cap).
const KEY = '6422ca03946ea6b82ea63867a031b959';

export async function onRequest({ request }) {
  const url = new URL(request.url);
  if (url.pathname === '/zd') return Response.redirect(`${url.origin}/zd/${url.search}`, 301);
  const target = APP + (url.pathname.slice(3) || '/') + url.search;
  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-zd-ip', request.headers.get('cf-connecting-ip') || '');
  headers.set('x-zd-proxy-key', KEY);
  const init = { method: request.method, headers, redirect: 'manual' };
  if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;
  const res = await fetch(target, init);
  const out = new Response(res.body, res);
  const loc = res.headers.get('location');
  if (loc && loc.startsWith(APP)) out.headers.set('location', '/zd' + (loc.slice(APP.length) || '/'));
  return out;
}
