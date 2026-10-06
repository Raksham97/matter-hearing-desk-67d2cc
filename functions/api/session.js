import { json } from '../_lib/http.js';
import { getCookie, verifySession } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const token = getCookie(context.request, 'matterdesk_session');
  const authenticated = await verifySession(token, context.env.AUTH_SECRET);
  return json({ authenticated });
}
