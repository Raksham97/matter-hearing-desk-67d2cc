import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  const matter = await context.env.DB.prepare('SELECT * FROM matters WHERE id=?1').bind(id).first();
  if (!matter) return json({ error: 'Matter not found' }, 404);
  const [apps, hearings] = await Promise.all([
    context.env.DB.prepare(`
      SELECT * FROM applications WHERE matter_id=?1
      ORDER BY CASE status WHEN 'Pending' THEN 0 WHEN 'Listed' THEN 1 WHEN 'Part-heard' THEN 2 ELSE 3 END,
               CASE WHEN next_hearing_date IS NULL THEN 1 ELSE 0 END,
               next_hearing_date ASC, ia_number ASC
    `).bind(id).all(),
    context.env.DB.prepare(`
      SELECT h.*,
             GROUP_CONCAT(a.id) AS application_ids_csv,
             GROUP_CONCAT(a.ia_number, ' · ') AS application_numbers
      FROM hearings h
      LEFT JOIN hearing_applications ha ON ha.hearing_id=h.id
      LEFT JOIN applications a ON a.id=ha.application_id
      WHERE h.matter_id=?1
      GROUP BY h.id
      ORDER BY h.hearing_date DESC, h.id DESC
    `).bind(id).all()
  ]);
  return json({ matter, applications: apps.results, hearings: hearings.results });
}

export async function onRequestPut(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  try {
    const b = await readJson(context.request);
    const cause = clean(b.cause_title, 500);
    if (!cause) return json({ error: 'Cause title is required' }, 400);
    await context.env.DB.prepare(`
      UPDATE matters SET
        cause_title=?1, short_name=?2, forum=?3, bench=?4, case_number=?5,
        client_role=?6, status=?7, next_hearing_date=?8, next_hearing_notes=?9,
        notes=?10, official_case_url=?11, updated_at=datetime('now')
      WHERE id=?12
    `).bind(
      cause, clean(b.short_name,150), clean(b.forum,80)||'NCLT', clean(b.bench,150),
      clean(b.case_number,150), clean(b.client_role,150), clean(b.status,30)||'Active',
      validDate(b.next_hearing_date), clean(b.next_hearing_notes,2000), clean(b.notes,4000),
      clean(b.official_case_url,1000), id
    ).run();
    return json({ ok:true });
  } catch (e) {
    return json({ error: e.message || 'Could not update matter' }, 400);
  }
}
