import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

export async function onRequestPut(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  try {
    const b = await readJson(context.request);
    const ia = clean(b.ia_number, 180);
    if (!id || !ia) return json({ error: 'IA / application number is required' }, 400);
    await context.env.DB.prepare(`
      UPDATE applications SET ia_number=?1, title=?2, status=?3, bench=?4,
        next_hearing_date=?5, next_hearing_notes=?6, notes=?7, official_url=?8,
        updated_at=datetime('now')
      WHERE id=?9
    `).bind(
      ia, clean(b.title,500), clean(b.status,40)||'Pending', clean(b.bench,150),
      validDate(b.next_hearing_date), clean(b.next_hearing_notes,2000), clean(b.notes,4000),
      clean(b.official_url,1000), id
    ).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: e.message || 'Could not update IA / application' }, 400);
  }
}

export async function onRequestDelete(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  if (!id) return json({ error: 'Invalid application' }, 400);
  await context.env.DB.prepare('DELETE FROM hearing_applications WHERE application_id=?1').bind(id).run();
  await context.env.DB.prepare('DELETE FROM nclt_order_applications WHERE application_id=?1').bind(id).run();
  await context.env.DB.prepare('DELETE FROM applications WHERE id=?1').bind(id).run();
  return json({ ok: true });
}
