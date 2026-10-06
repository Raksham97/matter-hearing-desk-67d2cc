import { json, readJson, clean, validDate } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

function ids(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter(n => Number.isInteger(n) && n > 0))];
}

export async function onRequestPost(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  try {
    const b = await readJson(context.request);
    const matterId = Number(b.matter_id);
    const hearingDate = validDate(b.hearing_date);
    if (!matterId || !hearingDate) return json({ error: 'Matter and hearing date are required' }, 400);
    const applicationIds = ids(b.application_ids);
    const nextDate = validDate(b.next_hearing_date);
    const bench = clean(b.bench, 150);
    const outcome = clean(b.outcome, 3000);
    if (!outcome) return json({ error: 'Outcome is required' }, 400);

    const iaLabel = applicationIds.length ? null : clean(b.ia_number, 150);
    const insert = await context.env.DB.prepare(`
      INSERT INTO hearings
      (matter_id, hearing_date, ia_number, bench, notes, outcome, next_hearing_date,
       next_ia_number, next_hearing_notes, order_url, order_title, created_at, updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,datetime('now'),datetime('now'))
    `).bind(
      matterId, hearingDate, iaLabel, bench, clean(b.notes,3000), outcome,
      nextDate, null, clean(b.next_hearing_notes,2000), clean(b.order_url,1000), clean(b.order_title,300)
    ).run();
    const hearingId = insert.meta.last_row_id;

    if (applicationIds.length) {
      const validApps = await context.env.DB.prepare(`
        SELECT id FROM applications WHERE matter_id=?1 AND id IN (${applicationIds.map(()=>'?').join(',')})
      `).bind(matterId, ...applicationIds).all();
      const validIds = validApps.results.map(x => x.id);
      const linkStatements = validIds.map(id => context.env.DB.prepare(
        'INSERT OR IGNORE INTO hearing_applications (hearing_id,application_id) VALUES (?1,?2)'
      ).bind(hearingId,id));
      if (linkStatements.length) await context.env.DB.batch(linkStatements);

      const appStatus = clean(b.application_status,40);
      if (nextDate !== null || b.next_hearing_notes !== undefined || appStatus) {
        const updateStatements = validIds.map(id => context.env.DB.prepare(`
          UPDATE applications SET
            bench=COALESCE(?1,bench),
            next_hearing_date=?2,
            next_hearing_notes=?3,
            status=CASE WHEN ?4 IS NULL OR ?4='' THEN status ELSE ?4 END,
            updated_at=datetime('now')
          WHERE id=?5
        `).bind(bench, nextDate, clean(b.next_hearing_notes,2000), appStatus, id));
        if (updateStatements.length) await context.env.DB.batch(updateStatements);
      }
    } else {
      await context.env.DB.prepare(`
        UPDATE matters SET bench=COALESCE(?1,bench), next_hearing_date=?2,
          next_hearing_notes=?3, updated_at=datetime('now') WHERE id=?4
      `).bind(bench, nextDate, clean(b.next_hearing_notes,2000), matterId).run();
    }

    return json({ ok: true, id: hearingId }, 201);
  } catch (e) {
    return json({ error: e.message || 'Could not add hearing' }, 400);
  }
}
