import { json } from '../_lib/http.js';
import { clearSessionCookie } from '../_lib/auth.js';

export async function onRequestPost() {
  return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
}
