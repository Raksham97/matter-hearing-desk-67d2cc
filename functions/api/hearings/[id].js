import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

function ids(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

async function latestForMatter(db, matterId) {
  return db.prepare(`
    SELECT next_hearing_date, next_hearing_notes, bench
    FROM hearings WHERE matter_id=?1 ORDER BY hearing_date DESC, id DESC LIMIT 1
  `).bind(matterId).first();
}

export async function onRequestPut(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  const current = await context.env.DB.prepare('SELECT * FROM hearings WHERE id=?1').bind(id).first();
  if (!current) return json({ error: 'Hearing not found' }, 404);
  try {
    const b = await readJson(context.request);
    const hearingDate = validDate(b.hearing_date);
    if (!hearingDate) return json({ error: 'Hearing date is required' }, 400);
    const applicationIds = ids(b.application_ids);
    const nextDate = validDate(b.next_hearing_date);
    const outcome = clean(b.outcome,3000);
    if (!outcome) return json({ error: 'Outcome is required' }, 400);
    const bench = clean(b.bench,150);

    await context.env.DB.prepare(`
      UPDATE hearings SET hearing_date=?1, ia_number=?2, bench=?3, notes=?4, outcome=?5,
        next_hearing_date=?6, next_ia_number=NULL, next_hearing_notes=?7,
        order_url=?8, order_title=?9, updated_at=datetime('now') WHERE id=?10
    `).bind(
      hearingDate, applicationIds.length ? null : clean(b.ia_number,150), bench,
      clean(b.notes,3000), outcome, nextDate, clean(b.next_hearing_notes,2000),
      clean(b.order_url,1000), clean(b.order_title,300), id
    ).run();

    await context.env.DB.prepare('DELETE FROM hearing_applications WHERE hearing_id=?1').bind(id).run();
    if (applicationIds.length) {
      const apps = await context.env.DB.prepare(`
        SELECT id FROM applications WHERE matter_id=?1 AND id IN (${applicationIds.map(()=>'?').join(',')})
      `).bind(current.matter_id, ...applicationIds).all();
      const validIds = apps.results.map(x=>x.id);
      const links = validIds.map(appId => context.env.DB.prepare(
        'INSERT OR IGNORE INTO hearing_applications (hearing_id,application_id) VALUES (?1,?2)'
      ).bind(id,appId));
      if (links.length) await context.env.DB.batch(links);
      const appStatus = clean(b.application_status,40);
      const updates = validIds.map(appId => context.env.DB.prepare(`
        UPDATE applications SET bench=COALESCE(?1,bench), next_hearing_date=?2,
          next_hearing_notes=?3,
          status=CASE WHEN ?4 IS NULL OR ?4='' THEN status ELSE ?4 END,
          updated_at=datetime('now') WHERE id=?5
      `).bind(bench,nextDate,clean(b.next_hearing_notes,2000),appStatus,appId));
      if (updates.length) await context.env.DB.batch(updates);
    }
    return json({ ok:true });
  } catch (e) {
    return json({ error: e.message || 'Could not update hearing' }, 400);
  }
}

export async function onRequestDelete(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const id = Number(context.params.id);
  const row = await context.env.DB.prepare('SELECT matter_id FROM hearings WHERE id=?1').bind(id).first();
  if (!row) return json({ error: 'Hearing not found' }, 404);
  await context.env.DB.prepare('DELETE FROM hearing_applications WHERE hearing_id=?1').bind(id).run();
  await context.env.DB.prepare('DELETE FROM hearings WHERE id=?1').bind(id).run();
  const latest = await latestForMatter(context.env.DB, row.matter_id);
  await context.env.DB.prepare(`
    UPDATE matters SET next_hearing_date=?1, next_hearing_notes=?2,
      bench=COALESCE(?3,bench), updated_at=datetime('now') WHERE id=?4
  `).bind(latest?.next_hearing_date || null, latest?.next_hearing_notes || null, latest?.bench || null, row.matter_id).run();
  return json({ ok:true });
}
