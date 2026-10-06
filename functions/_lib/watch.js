import { json } from './http.js';

export function normalizeIa(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function requireWatch(context) {
  const expected = String(context.env.NCLT_WATCH_SECRET || '');
  const got = String(context.request.headers.get('x-nclt-watch-secret') || '');
  if (!expected || !got || expected !== got) return json({ error: 'Unauthorized watcher' }, 401);
  return null;
}
