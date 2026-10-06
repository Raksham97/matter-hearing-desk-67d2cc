import { json, readJson, clean, validDate } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

export async function onRequestPost(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  try {
    const b = await readJson(context.request);
    const matterId = Number(b.matter_id);
    const hearingDate = validDate(b.hearing_date);
    if (!matterId || !hearingDate) return json({ error: 'Matter and hearing date are required' }, 400);
    const nextDate = validDate(b.next_hearing_date);
    const bench = clean(b.bench, 150);
    const statements = [
      context.env.DB.prepare(`
        INSERT INTO hearings
        (matter_id, hearing_date, ia_number, bench, notes, outcome, next_hearing_date,
         next_ia_number, next_hearing_notes, order_url, order_title, created_at, updated_at)
        VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,datetime('now'),datetime('now'))
      `).bind(
        matterId, hearingDate, clean(b.ia_number,150), bench, clean(b.notes,3000), clean(b.outcome,3000),
        nextDate, clean(b.next_ia_number,150), clean(b.next_hearing_notes,2000),
        clean(b.order_url,1000), clean(b.order_title,300)
      ),
      context.env.DB.prepare(`
        UPDATE matters SET
          bench=COALESCE(?1, bench), next_hearing_date=?2, next_ia_number=?3,
          next_hearing_notes=?4, updated_at=datetime('now')
        WHERE id=?5
      `).bind(bench, nextDate, clean(b.next_ia_number,150), clean(b.next_hearing_notes,2000), matterId)
    ];
    const results = await context.env.DB.batch(statements);
    return json({ ok: true, id: results[0]?.meta?.last_row_id || null }, 201);
  } catch (e) {
    return json({ error: e.message || 'Could not add hearing' }, 400);
  }
}
