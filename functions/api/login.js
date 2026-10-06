import { json, readJson } from '../_lib/http.js';
import { passwordMatches, makeSession, sessionCookie } from '../_lib/auth.js';

export async function onRequestPost(context) {
  try {
    const body = await readJson(context.request);
    if (!(await passwordMatches(body.password, context.env.APP_PASSWORD))) {
      return json({ error: 'Incorrect password' }, 401);
    }
    const token = await makeSession(context.env.AUTH_SECRET);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(token) });
  } catch (e) {
    return json({ error: e.message || 'Login failed' }, 400);
  }
}
