import { json, readJson, clean, validDate } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  try {
    const b = await readJson(context.request);
    const matterId = Number(b.matter_id);
    const ia = clean(b.ia_number, 180);
    if (!matterId || !ia) return json({ error: 'Matter and IA / application number are required' }, 400);
    const exists = await context.env.DB.prepare('SELECT id FROM matters WHERE id=?1').bind(matterId).first();
    if (!exists) return json({ error: 'Matter not found' }, 404);
    const r = await context.env.DB.prepare(`
      INSERT INTO applications
      (matter_id, ia_number, title, status, bench, next_hearing_date, next_hearing_notes,
       notes, official_url, created_at, updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,datetime('now'),datetime('now'))
    `).bind(
      matterId, ia, clean(b.title, 500), clean(b.status, 40) || 'Pending',
      clean(b.bench, 150), validDate(b.next_hearing_date), clean(b.next_hearing_notes, 2000),
      clean(b.notes, 4000), clean(b.official_url, 1000)
    ).run();
    return json({ ok: true, id: r.meta.last_row_id }, 201);
  } catch (e) {
    return json({ error: e.message || 'Could not create IA / application' }, 400);
  }
}
