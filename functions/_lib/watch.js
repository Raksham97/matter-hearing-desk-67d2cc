import { json } from './http.js';

export function normalizeIa(value) {
  const text=String(value||'');
  const m=text.match(/I\s*\.?\s*A\s*\.?[^0-9]{0,40}(\d{1,6})[^0-9]{0,40}(\d{4})\b/i);
  if(m)return `IA${Number(m[1])}${m[2]}`;
  return text.toUpperCase().replace(/[^A-Z0-9]/g,'');
}

export function requireWatch(context) {
  const expected = String(context.env.NCLT_WATCH_SECRET || '');
  const got = String(context.request.headers.get('x-nclt-watch-secret') || '');
  if (!expected || !got || expected !== got) return json({ error: 'Unauthorized watcher' }, 401);
  return null;
}
