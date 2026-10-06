import { json } from '../_lib/http.js';
import { requireAuth } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const denied = await requireAuth(context); if (denied) return denied;
  const [matters, applications, hearings, links, orders, orderLinks] = await Promise.all([
    context.env.DB.prepare('SELECT * FROM matters ORDER BY cause_title ASC').all(),
    context.env.DB.prepare('SELECT * FROM applications ORDER BY matter_id ASC, ia_number ASC').all(),
    context.env.DB.prepare('SELECT * FROM hearings ORDER BY hearing_date ASC, id ASC').all(),
    context.env.DB.prepare('SELECT * FROM hearing_applications ORDER BY hearing_id, application_id').all(),
    context.env.DB.prepare('SELECT * FROM nclt_orders ORDER BY matter_id ASC, order_date ASC, id ASC').all(),
    context.env.DB.prepare('SELECT * FROM nclt_order_applications ORDER BY order_id, application_id').all(),
  ]);
  return json({exported_at:new Date().toISOString(),matters:matters.results,applications:applications.results,
    hearings:hearings.results,hearing_applications:links.results,nclt_orders:orders.results,
    nclt_order_applications:orderLinks.results});
}
