import {Router} from 'express';
import type {Pool,PoolClient} from 'pg';
import type {AppConfig} from '../config.js';
import {HttpError} from '../types.js';
import {businessToday,resolvePeriod} from '../lib/dates.js';
import {summarizeLiveBusiness,type LiveOrder,type BusinessEvent} from '../lib/liveBusiness.js';
import {addMoney} from '../lib/money.js';

function filter(value:unknown){if(value===undefined)return '';if(typeof value!=='string'||value.length>128)throw new HttpError(400,'筛选值无效');return value.trim();}
export function createLiveBusinessRouter(db:Pool,config:AppConfig){
 const router=Router();
 router.get('/',async(req,res,next)=>{
  if(req.actor?.role!=='boss'){next(new HttpError(403,'仅BOSS可查看直播间经营总览'));return;}
  let c:PoolClient|undefined;
  try{
   c=await db.connect();
   const today=businessToday(new Date(),config.businessTimezone);let period:{from:string;to:string};
   try{period=resolvePeriod(filter(req.query.preset)||undefined,filter(req.query.from)||undefined,filter(req.query.to)||undefined,today);}catch(e){throw new HttpError(400,e instanceof Error?e.message:'日期范围无效');}
   const selected={room:filter(req.query.room),host:filter(req.query.host),persona:filter(req.query.persona),operator:filter(req.query.operator)};
   const scope=`SELECT o.*,d.persona_code,d.persona_name,d.live_room_code,d.host_name,d.customer_code,d.operator_name,u.service_account_label AS wechat_id,d.order_id IS NULL AS legacy FROM orders o LEFT JOIN order_details d ON d.order_id=o.id JOIN users u ON u.id=o.user_id WHERE ($3='' OR d.live_room_code=$3 OR ($3='__unassigned__' AND COALESCE(d.live_room_code,'')='')) AND ($4='' OR d.host_name=$4) AND ($5='' OR d.persona_code=$5) AND ($6='' OR d.operator_name=$6)`;
   const params=[period.from,period.to,selected.room,selected.host,selected.persona,selected.operator];
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const orders=(await c.query<LiveOrder>(`WITH scoped AS (${scope}) SELECT id,status,order_ref,customer_label,COALESCE(persona_code,'') AS persona_code,COALESCE(persona_name,'') AS persona_name,COALESCE(live_room_code,'') AS live_room_code,COALESCE(host_name,'') AS host_name,COALESCE(customer_code,'') AS customer_code,COALESCE(operator_name,'') AS operator_name,COALESCE(wechat_id,'') AS wechat_id,legacy,(custom_product_cost+labor_cost+shipping_cost)::text AS legacy_cost FROM scoped WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL`,params)).rows;
   const events=(await c.query<BusinessEvent>(`WITH scoped AS (${scope})
    SELECT o.id::text AS id,o.id AS order_id,'sale' AS kind,o.business_date::text AS date,CASE WHEN o.legacy THEN o.amount ELSE COALESCE((SELECT sum(i.price_cny+i.buying_fee_cny) FROM order_items i WHERE i.order_id=o.id),o.amount) END::numeric(14,2)::text AS amount,'CNY' AS currency,'' AS category,o.order_ref AS label FROM scoped o WHERE o.business_date BETWEEN $1 AND $2
    UNION ALL SELECT a.id::text,a.order_id,'charge',a.business_date::text,a.amount_cny::text,'CNY','',a.label FROM order_charges a JOIN scoped o ON o.id=a.order_id WHERE a.voided_at IS NULL AND a.business_date BETWEEN $1 AND $2
    UNION ALL SELECT e.id::text,e.order_id,'expense',e.business_date::text,e.amount_cny::text,'CNY',e.category,e.label FROM order_expenses e JOIN scoped o ON o.id=e.order_id WHERE e.voided_at IS NULL AND e.business_date BETWEEN $1 AND $2
    UNION ALL SELECT p.id::text,p.order_id,'receipt',p.payment_date::text,p.amount::text,p.currency,'',p.channel FROM customer_payments p JOIN scoped o ON o.id=p.order_id WHERE p.voided_at IS NULL AND p.payment_date BETWEEN $1 AND $2
    UNION ALL SELECT 'direct:'||p.id::text,p.order_id,'company',p.payment_date::text,p.amount::text,'CNY','',p.channel FROM customer_payments p JOIN scoped o ON o.id=p.order_id WHERE p.voided_at IS NULL AND NOT p.third_party AND p.currency='CNY' AND p.payment_date BETWEEN $1 AND $2
    UNION ALL SELECT 'settlement:'||s.id::text||':'||p.id::text,p.order_id,'company',s.settled_on::text,a.net_cny::text,'CNY','',s.channel FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id JOIN customer_payments p ON p.id=a.payment_id JOIN scoped o ON o.id=p.order_id WHERE s.voided_at IS NULL AND p.voided_at IS NULL AND s.settled_on BETWEEN $1 AND $2
    UNION ALL SELECT p.id::text,e.order_id,'supplier',p.paid_on::text,p.amount_cny::text,'CNY',e.category,p.payee FROM supplier_payments p JOIN order_expenses e ON e.id=p.expense_id JOIN scoped o ON o.id=e.order_id WHERE p.voided_at IS NULL AND e.voided_at IS NULL AND p.paid_on BETWEEN $1 AND $2
    ORDER BY date DESC,id`,params)).rows;
   const options=(await c.query(`SELECT DISTINCT COALESCE(d.live_room_code,'') AS room,COALESCE(d.host_name,'') AS host,COALESCE(d.persona_code,'') AS persona,COALESCE(d.persona_name,'') AS persona_name,COALESCE(d.operator_name,'') AS operator FROM orders o LEFT JOIN order_details d ON d.order_id=o.id ORDER BY room,host,persona,operator`)).rows;
   const ads=(await c.query(`SELECT id,business_date::text AS date,persona_name AS persona,COALESCE(ad_account_ref,'历史未关联') AS account,spend_usd::text AS amount FROM ops_reports WHERE business_date BETWEEN $1 AND $2 AND spend_usd IS NOT NULL ORDER BY business_date DESC,persona_name`,[period.from,period.to])).rows;
   const unknownAds=(await c.query('SELECT count(*)::int AS count FROM ops_reports WHERE business_date BETWEEN $1 AND $2 AND spend_usd IS NULL',[period.from,period.to])).rows[0].count;
   const result=summarizeLiveBusiness(orders,events);
   await c.query('COMMIT');
   res.set('Cache-Control','private, no-store').json({period,selected,...result,options,ads:{scope:'company',spendUsd:addMoney(ads.map(a=>a.amount)),records:ads,unknownCount:unknownAds},refundMethod:'current_refunded_orders_excluded_without_assumed_refund_date'});
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
 });return router;
}
