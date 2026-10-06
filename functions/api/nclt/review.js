import { json, readJson } from '../../_lib/http.js';
import { requireAuth } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const denied=await requireAuth(context); if(denied) return denied;
  const b=await readJson(context.request).catch(()=>({}));
  const matterId=Number(b.matter_id||0);
  if (matterId) {
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE applications SET is_new=0 WHERE matter_id=?1').bind(matterId),
      context.env.DB.prepare('UPDATE nclt_orders SET is_new=0 WHERE matter_id=?1').bind(matterId),
    ]);
  } else {
    await context.env.DB.batch([
      context.env.DB.prepare('UPDATE applications SET is_new=0 WHERE is_new=1'),
      context.env.DB.prepare('UPDATE nclt_orders SET is_new=0 WHERE is_new=1'),
    ]);
  }
  return json({ok:true});
}
