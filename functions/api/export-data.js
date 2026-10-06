import { json } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const [matters, hearings] = await Promise.all([
    context.env.DB.prepare('SELECT * FROM matters ORDER BY cause_title ASC').all(),
    context.env.DB.prepare('SELECT * FROM hearings ORDER BY hearing_date ASC, id ASC').all(),
  ]);
  return json({ exported_at: new Date().toISOString(), matters: matters.results, hearings: hearings.results });
}
