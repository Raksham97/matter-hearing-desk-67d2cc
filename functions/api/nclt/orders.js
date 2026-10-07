import { json, readJson, clean, validDate } from '../../_lib/http.js';
import { requireWatch, normalizeIa } from '../../_lib/watch.js';

function sameIa(a,b){ return normalizeIa(a) && normalizeIa(a)===normalizeIa(b); }

export async function onRequestPost(context) {
  const denied=requireWatch(context); if(denied)return denied;
  let body; try{body=await readJson(context.request);}catch{return json({error:'Invalid JSON'},400);}
  const matterId=Number(body.matter_id);
  const matter=await context.env.DB.prepare('SELECT id,nclt_watch_enabled FROM matters WHERE id=?1').bind(matterId).first();
  if(!matter||!matter.nclt_watch_enabled)return json({error:'Matter is not enabled for NCLT watch'},404);

  const incoming=(Array.isArray(body.orders)?body.orders:[]).slice(0,20);
  const orders=[];
  for(const raw of incoming){
    const sourceUrl=clean(raw?.source_url,1400); if(!sourceUrl)continue;
    const fingerprint=clean(raw?.fingerprint,300)||sourceUrl;
    orders.push({
      sourceUrl,
      fingerprint,
      orderDate:validDate(raw?.order_date),
      orderType:clean(raw?.order_type,120),
      title:clean(raw?.title,600),
      iaNumbers:(Array.isArray(raw?.ia_numbers)?raw.ia_numbers:[]).map(x=>clean(x,180)).filter(Boolean).slice(0,40),
    });
  }
  if(!orders.length)return json({ok:true,processed_orders:0,imported_orders:0});

  // Determine what is genuinely new before the idempotent UPSERT batch.
  const existingRows=(await context.env.DB.prepare('SELECT fingerprint FROM nclt_orders WHERE matter_id=?1').bind(matterId).all()).results||[];
  const existing=new Set(existingRows.map(x=>String(x.fingerprint||'')));

  const upserts=orders.map(o=>context.env.DB.prepare(`
    INSERT INTO nclt_orders(matter_id,order_date,order_type,title,source_url,fingerprint,ia_numbers,is_new,discovered_at,last_seen_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,0,datetime('now'),datetime('now'))
    ON CONFLICT(matter_id,fingerprint) DO UPDATE SET
      order_date=COALESCE(nclt_orders.order_date,excluded.order_date),
      order_type=CASE WHEN COALESCE(nclt_orders.order_type,'')='' THEN excluded.order_type ELSE nclt_orders.order_type END,
      title=CASE WHEN COALESCE(nclt_orders.title,'')='' THEN excluded.title ELSE nclt_orders.title END,
      ia_numbers=CASE WHEN COALESCE(nclt_orders.ia_numbers,'')='' THEN excluded.ia_numbers ELSE nclt_orders.ia_numbers END,
      source_url=excluded.source_url,
      is_new=0,last_seen_at=datetime('now')
  `).bind(matterId,o.orderDate,o.orderType,o.title,o.sourceUrl,o.fingerprint,o.iaNumbers.join(' · ')||null));
  await context.env.DB.batch(upserts);

  // IA linking is enrichment only. Do it in two bounded batches rather than one
  // query per order so large historical backfills stay well under request limits.
  const manualApps=(await context.env.DB.prepare("SELECT id,ia_number FROM applications WHERE matter_id=?1 AND upper(COALESCE(source,'manual'))!='NCLT'").bind(matterId).all()).results||[];
  const lookups=orders.map(o=>context.env.DB.prepare('SELECT id,fingerprint FROM nclt_orders WHERE matter_id=?1 AND fingerprint=?2').bind(matterId,o.fingerprint));
  const lookupResults=await context.env.DB.batch(lookups);
  const links=[];
  orders.forEach((o,i)=>{
    const orderId=lookupResults?.[i]?.results?.[0]?.id;
    if(!orderId)return;
    for(const label of o.iaNumbers){
      const app=manualApps.find(x=>sameIa(x.ia_number,label));
      if(app)links.push(context.env.DB.prepare('INSERT OR IGNORE INTO nclt_order_applications(order_id,application_id) VALUES(?1,?2)').bind(orderId,app.id));
    }
  });
  if(links.length)await context.env.DB.batch(links);

  const imported=orders.reduce((n,o)=>n+(existing.has(o.fingerprint)?0:1),0);
  return json({ok:true,processed_orders:orders.length,imported_orders:imported});
}
