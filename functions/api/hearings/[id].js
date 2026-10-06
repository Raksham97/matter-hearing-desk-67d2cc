import { json } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

export async function onRequestDelete(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  const row = await context.env.DB.prepare('SELECT matter_id FROM hearings WHERE id=?1').bind(id).first();
  if (!row) return json({ error: 'Hearing not found' }, 404);
  await context.env.DB.prepare('DELETE FROM hearings WHERE id=?1').bind(id).run();
  const latest = await context.env.DB.prepare(`
    SELECT next_hearing_date, next_ia_number, next_hearing_notes, bench
    FROM hearings WHERE matter_id=?1 ORDER BY hearing_date DESC, id DESC LIMIT 1
  `).bind(row.matter_id).first();
  await context.env.DB.prepare(`
    UPDATE matters SET next_hearing_date=?1, next_ia_number=?2, next_hearing_notes=?3,
      bench=COALESCE(?4,bench), updated_at=datetime('now') WHERE id=?5
  `).bind(
    latest?.next_hearing_date || null, latest?.next_ia_number || null,
    latest?.next_hearing_notes || null, latest?.bench || null, row.matter_id
  ).run();
  return json({ ok: true });
}
