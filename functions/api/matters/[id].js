import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function watchFlag(v) { return v === true || v === 1 || v === '1' || v === 'on' ? 1 : 0; }

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  const matter = await context.env.DB.prepare('SELECT * FROM matters WHERE id=?1').bind(id).first();
  if (!matter) return json({ error: 'Matter not found' }, 404);
  const [apps, hearings, orders, sync] = await Promise.all([
    context.env.DB.prepare(`
      SELECT * FROM applications WHERE matter_id=?1
      ORDER BY is_new DESC,
               CASE status WHEN 'Pending' THEN 0 WHEN 'Listed' THEN 1 WHEN 'Part-heard' THEN 2 ELSE 3 END,
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
    `).bind(id).all(),
    context.env.DB.prepare(`
      SELECT no.*,
             GROUP_CONCAT(a.ia_number, ' · ') AS application_numbers
      FROM nclt_orders no
      LEFT JOIN nclt_order_applications noa ON noa.order_id=no.id
      LEFT JOIN applications a ON a.id=noa.application_id
      WHERE no.matter_id=?1
      GROUP BY no.id
      ORDER BY COALESCE(no.order_date,'0000-00-00') DESC, no.id DESC
    `).bind(id).all(),
    context.env.DB.prepare(`
      SELECT * FROM nclt_sync_runs WHERE matter_id=?1 ORDER BY id DESC LIMIT 1
    `).bind(id).first(),
  ]);
  return json({ matter, applications: apps.results, hearings: hearings.results, nclt_orders: orders.results, nclt_sync: sync || null });
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
        notes=?10, official_case_url=?11,
        nclt_watch_enabled=?12,nclt_filing_no=?13,nclt_bench_slug=?14,
        updated_at=datetime('now')
      WHERE id=?15
    `).bind(
      cause, clean(b.short_name,150), clean(b.forum,80)||'NCLT', clean(b.bench,150),
      clean(b.case_number,150), clean(b.client_role,150), clean(b.status,30)||'Active',
      validDate(b.next_hearing_date), clean(b.next_hearing_notes,2000), clean(b.notes,4000),
      clean(b.official_case_url,1000), watchFlag(b.nclt_watch_enabled),clean(b.nclt_filing_no,80),clean(b.nclt_bench_slug,80),id
    ).run();
    return json({ ok:true });
  } catch (e) {
    return json({ error: e.message || 'Could not update matter' }, 400);
  }
}

export async function onRequestDelete(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  if (!id) return json({ error: 'Invalid matter' }, 400);
  const matter = await context.env.DB.prepare('SELECT id, cause_title FROM matters WHERE id=?1').bind(id).first();
  if (!matter) return json({ error: 'Matter not found' }, 404);

  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`DELETE FROM nclt_order_applications WHERE order_id IN (SELECT id FROM nclt_orders WHERE matter_id=?1)`).bind(id),
      context.env.DB.prepare('DELETE FROM nclt_orders WHERE matter_id=?1').bind(id),
      context.env.DB.prepare('DELETE FROM nclt_sync_runs WHERE matter_id=?1').bind(id),
      context.env.DB.prepare(`DELETE FROM hearing_applications WHERE hearing_id IN (SELECT id FROM hearings WHERE matter_id=?1)`).bind(id),
      context.env.DB.prepare(`DELETE FROM hearing_applications WHERE application_id IN (SELECT id FROM applications WHERE matter_id=?1)`).bind(id),
      context.env.DB.prepare('DELETE FROM hearings WHERE matter_id=?1').bind(id),
      context.env.DB.prepare('DELETE FROM applications WHERE matter_id=?1').bind(id),
      context.env.DB.prepare('DELETE FROM matters WHERE id=?1').bind(id),
    ]);
    return json({ ok: true, deleted_id: id });
  } catch (e) {
    return json({ error: e.message || 'Could not delete matter' }, 400);
  }
}
