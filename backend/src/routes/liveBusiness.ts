import {Router} from 'express';
import { canonicalLiveRoom, liveRoomSql } from "../lib/liveRoomIdentity.js";
import type {Pool,PoolClient} from 'pg';
import type {AppConfig} from '../config.js';
import {HttpError} from '../types.js';
import {addDays,businessToday,resolvePeriod} from '../lib/dates.js';
import {summarizeLiveBusiness,type LiveOrder,type BusinessEvent} from '../lib/liveBusiness.js';
import {addMoney,centsToMoney,moneyToCents} from '../lib/money.js';

const MATERIAL_EXPENSE_CATEGORIES = new Set(['goods','sourcing','material']);
const DEFAULT_FX_TO_CNY: Record<string, number> = { CNY: 1, USD: 7.24, TWD: 0.2235, SGD: 5.38, HKD: 0.93 };
function toCnyCents(amount: string, currency: string): bigint {
  const c = moneyToCents(amount);
  const rate = DEFAULT_FX_TO_CNY[currency] ?? 1;
  return currency === 'CNY' ? c : BigInt(Math.round(Number(c) * rate));
}
function daysBetween(from: string, to: string): string[] {
  const list: string[] = [];
  let d = from;
  while (d <= to) { list.push(d); d = addDays(d, 1); }
  return list;
}
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
   const selected={room:canonicalLiveRoom(filter(req.query.room)),host:filter(req.query.host),persona:filter(req.query.persona),operator:filter(req.query.operator)};
   const scope=`SELECT o.*,d.persona_code,d.persona_name,${liveRoomSql("d.live_room_code")} AS live_room_code,d.host_name,d.customer_code,d.operator_name,d.deal_channel,d.shipped_on,d.customer_currency,d.customer_due,u.service_account_label AS wechat_id,d.order_id IS NULL AS legacy FROM orders o LEFT JOIN order_details d ON d.order_id=o.id JOIN users u ON u.id=o.user_id WHERE ($3='' OR ${liveRoomSql("d.live_room_code")}=$3 OR ($3='__unassigned__' AND COALESCE(d.live_room_code,'')='')) AND ($4='' OR d.host_name=$4) AND ($5='' OR d.persona_code=$5) AND ($6='' OR d.operator_name=$6)`;
   const params=[period.from,period.to,selected.room,selected.host,selected.persona,selected.operator];
   const trendFrom=addDays(period.to,-6);
   await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');

   type ScopedOrderRow = LiveOrder & {
     business_date: string;
     amount: string;
     material_cost_cny: string | null;
     deal_channel: string | null;
     shipped_on: string | null;
     customer_currency: string | null;
     customer_due: string | null;
     has_sourcing_no_settle: boolean;
     booking_amount: string;
     base_paid: string;
     base_payment_count: number;
     has_split_payment: boolean;
     has_full_payment: boolean;
     charge_due: string;
     charge_paid: string;
   };

   const orders=(await c.query<ScopedOrderRow>(
    `WITH scoped AS (${scope})
     SELECT scoped.id,scoped.status,scoped.business_date::text AS business_date,scoped.amount::text AS amount,
            scoped.material_cost_cny::text AS material_cost_cny,scoped.deal_channel,
            scoped.shipped_on::text AS shipped_on,
            COALESCE(scoped.customer_currency,'CNY') AS customer_currency,
            (CASE WHEN scoped.legacy THEN scoped.amount ELSE scoped.customer_due END)::numeric(14,2)::text AS customer_due,
            EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=scoped.id AND x.voided_at IS NULL) AS cancelled,
            EXISTS(SELECT 1 FROM order_items i WHERE i.order_id=scoped.id AND i.sourcing_no_settle) AS has_sourcing_no_settle,
            (CASE WHEN scoped.legacy THEN scoped.amount ELSE COALESCE((SELECT sum(i.price_cny+i.buying_fee_cny) FROM order_items i WHERE i.order_id=scoped.id),scoped.amount) END)::numeric(14,2)::text AS booking_amount,
            scoped.order_ref,scoped.customer_label,COALESCE(scoped.persona_code,'') AS persona_code,COALESCE(scoped.persona_name,'') AS persona_name,
            COALESCE(scoped.live_room_code,'') AS live_room_code,COALESCE(scoped.host_name,'') AS host_name,
            COALESCE(scoped.customer_code,'') AS customer_code,COALESCE(scoped.operator_name,'') AS operator_name,
            COALESCE(scoped.wechat_id,'') AS wechat_id,scoped.legacy,
            (scoped.custom_product_cost+scoped.labor_cost+scoped.shipping_cost)::text AS legacy_cost,
            pay.base_paid,pay.base_payment_count,pay.has_split_payment,pay.has_full_payment,pay.charge_paid,chg.charge_due
       FROM scoped
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(p.credit_amount) FILTER (WHERE p.after_sale_charge_id IS NULL),0)::numeric(14,2)::text AS base_paid,
                count(*) FILTER (WHERE p.after_sale_charge_id IS NULL)::int AS base_payment_count,
                COALESCE(bool_or(p.after_sale_charge_id IS NULL AND p.purpose IN ('deposit','balance')),false) AS has_split_payment,
                COALESCE(bool_or(p.after_sale_charge_id IS NULL AND p.purpose='full'),false) AS has_full_payment,
                COALESCE(sum(p.credit_amount) FILTER (WHERE p.after_sale_charge_id IS NOT NULL),0)::numeric(14,2)::text AS charge_paid
           FROM customer_payments p WHERE p.order_id=scoped.id AND p.voided_at IS NULL AND p.verify_status <> 'rejected'
       ) pay ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(sum(a.customer_amount),0)::numeric(14,2)::text AS charge_due
           FROM order_charges a WHERE a.order_id=scoped.id AND a.voided_at IS NULL
       ) chg ON TRUE
      WHERE $1::date IS NOT NULL AND $2::date IS NOT NULL`,
    params
   )).rows;

   const events=(await c.query<BusinessEvent>(`WITH scoped AS (${scope})
    SELECT o.id::text AS id,o.id AS order_id,'sale' AS kind,o.business_date::text AS date,CASE WHEN o.legacy THEN o.amount ELSE COALESCE((SELECT sum(i.price_cny+i.buying_fee_cny) FROM order_items i WHERE i.order_id=o.id),o.amount) END::numeric(14,2)::text AS amount,'CNY' AS currency,'' AS category,o.order_ref AS label FROM scoped o WHERE o.business_date BETWEEN $1 AND $2
    UNION ALL SELECT a.id::text,a.order_id,'charge',a.business_date::text,a.amount_cny::text,'CNY','',a.label FROM order_charges a JOIN scoped o ON o.id=a.order_id WHERE a.voided_at IS NULL AND a.business_date BETWEEN $1 AND $2
    UNION ALL SELECT e.id::text,e.order_id,'expense',e.business_date::text,e.amount_cny::text,'CNY',e.category,e.label FROM order_expenses e JOIN scoped o ON o.id=e.order_id WHERE e.voided_at IS NULL AND e.business_date BETWEEN $1 AND $2
    UNION ALL SELECT p.id::text,p.order_id,'receipt',p.payment_date::text,p.amount::text,p.currency,'',p.channel FROM customer_payments p JOIN scoped o ON o.id=p.order_id WHERE p.voided_at IS NULL AND p.payment_date BETWEEN $1 AND $2
    UNION ALL SELECT 'direct:'||p.id::text,p.order_id,'company',COALESCE(p.verified_on, p.payment_date)::text,COALESCE(p.verified_cny, p.amount)::text,'CNY','',p.channel FROM customer_payments p JOIN scoped o ON o.id=p.order_id WHERE p.voided_at IS NULL AND p.verify_status = 'confirmed' AND NOT p.third_party AND p.currency='CNY' AND COALESCE(p.verified_on, p.payment_date) BETWEEN $1 AND $2
    UNION ALL SELECT 'settlement:'||s.id::text||':'||p.id::text,p.order_id,'company',s.settled_on::text,a.net_cny::text,'CNY','',s.channel FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id JOIN customer_payments p ON p.id=a.payment_id JOIN scoped o ON o.id=p.order_id WHERE s.voided_at IS NULL AND p.voided_at IS NULL AND s.settled_on BETWEEN $1 AND $2
    UNION ALL SELECT p.id::text,e.order_id,'supplier',p.paid_on::text,p.amount_cny::text,'CNY',e.category,p.payee FROM supplier_payments p JOIN order_expenses e ON e.id=p.expense_id JOIN scoped o ON o.id=e.order_id WHERE p.voided_at IS NULL AND e.voided_at IS NULL AND p.paid_on BETWEEN $1 AND $2
    ORDER BY date DESC,id`,params)).rows;

   const options=(await c.query(`SELECT DISTINCT COALESCE(${liveRoomSql("d.live_room_code")},'') AS room,COALESCE(d.host_name,'') AS host,COALESCE(d.persona_code,'') AS persona,COALESCE(d.persona_name,'') AS persona_name,COALESCE(d.operator_name,'') AS operator FROM orders o LEFT JOIN order_details d ON d.order_id=o.id ORDER BY room,host,persona,operator`)).rows;
   const ads=(await c.query(`SELECT id,business_date::text AS date,persona_name AS persona,COALESCE(ad_account_ref,'历史未关联') AS account,spend_usd::text AS amount FROM ops_reports WHERE business_date BETWEEN $1 AND $2 AND spend_usd IS NOT NULL ORDER BY business_date DESC,persona_name`,[period.from,period.to])).rows;
   const unknownAds=(await c.query('SELECT count(*)::int AS count FROM ops_reports WHERE business_date BETWEEN $1 AND $2 AND spend_usd IS NULL',[period.from,period.to])).rows[0].count;
   const result=summarizeLiveBusiness(orders,events);
   const paidRecords=(await c.query(`SELECT id,business_date::text AS date,${liveRoomSql("live_room_code")} AS live_room_code,host_name,amount_cny::text,note FROM live_paid_performance WHERE voided_at IS NULL AND business_date BETWEEN $1 AND $2 AND ($3='' OR ${liveRoomSql("live_room_code")}=$3) AND ($4='' OR host_name=$4) ORDER BY business_date,live_room_code,host_name`,params.slice(0,4))).rows;
   const afterRows=(await c.query(`WITH scoped AS (${scope}) SELECT p.id,p.payment_date::text AS date,p.amount::text,p.currency,p.order_id,o.order_ref,o.customer_label,COALESCE(o.live_room_code,'') AS live_room_code,COALESCE(o.host_name,'') AS host_name,COALESCE(o.operator_name,'') AS operator_name,a.id AS charge_id,a.label,a.amount_cny::text AS quoted_cny,a.costs_completed_at,a.voided_at AS charge_voided_at,COALESCE((SELECT sum(e.amount_cny) FROM order_expenses e WHERE e.after_sale_charge_id=a.id AND e.voided_at IS NULL),0)::numeric(14,2)::text AS cost_cny FROM customer_payments p JOIN order_charges a ON a.id=p.after_sale_charge_id JOIN scoped o ON o.id=p.order_id WHERE p.voided_at IS NULL AND p.payment_date BETWEEN $1 AND $2 ORDER BY p.payment_date DESC,p.created_at`,params)).rows.map(r=>({...r,margin_cny:r.costs_completed_at&&!r.charge_voided_at?centsToMoney(moneyToCents(r.quoted_cny)-moneyToCents(r.cost_cny)):null}));
   const afterReceipts={CNY:addMoney(afterRows.filter(r=>r.currency==='CNY').map(r=>r.amount)),TWD:addMoney(afterRows.filter(r=>r.currency==='TWD').map(r=>r.amount)),USD:addMoney(afterRows.filter(r=>r.currency==='USD').map(r=>r.amount)),SGD:addMoney(afterRows.filter(r=>r.currency==='SGD').map(r=>r.amount)),HKD:addMoney(afterRows.filter(r=>r.currency==='HKD').map(r=>r.amount))};
   const unclassifiedReceiptCount=events.filter(e=>e.kind==='receipt').length-afterRows.length;

   // Approved room reimbursements (excluding order-linked business advances already posted to order_expenses)
   const roomReimRows=(await c.query<{id:string;claimant:string;purpose:string;amount:string;expense_date:string;live_room_name:string;category:string}>(
    `SELECT id::text AS id, claimant, purpose, amount_cny::text AS amount, expense_date::text AS expense_date,
            ${liveRoomSql("live_room_name")} AS live_room_name, category
       FROM reimbursement_claims
      WHERE status = 'approved'
        AND posted_expense_id IS NULL
        AND live_room_name IS NOT NULL
        AND btrim(live_room_name) <> ''
        AND expense_date BETWEEN $1 AND $2
      ORDER BY expense_date DESC, created_at DESC`,
    [period.from, period.to]
   )).rows.filter((row) => !selected.room || row.live_room_name === selected.room);

   // 7-day trend per live room
   const trendRows=(await c.query<{room_key:string;business_date:string;amount:string}>(
    `WITH scoped AS (${scope})
     SELECT COALESCE(NULLIF(o.live_room_code,''),'__unassigned__') AS room_key,
            o.business_date::text AS business_date,
            COALESCE(sum(CASE WHEN o.legacy THEN o.amount ELSE COALESCE((SELECT sum(i.price_cny+i.buying_fee_cny) FROM order_items i WHERE i.order_id=o.id),o.amount) END),0)::numeric(14,2)::text AS amount
       FROM scoped o
      WHERE o.business_date BETWEEN $7 AND $2
        AND o.status <> 'refunded'
        AND COALESCE(o.deal_channel,'live') <> 'private'
        AND NOT EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL)
      GROUP BY room_key, o.business_date`,
    [...params, trendFrom]
   )).rows;

   await c.query('COMMIT');

   const orderDirectory=new Map(orders.map(o=>[o.id,o]));
   const periodOrders=orders.filter(o=>o.business_date>=period.from&&o.business_date<=period.to&&(o.deal_channel??'live')!=='private');
   const validPeriodOrders=periodOrders.filter(o=>!o.cancelled&&o.status!=='refunded');
   const materialExpensesByOrder=new Map<string,bigint>();
   for(const e of events){
    if(e.kind==='expense'&&MATERIAL_EXPENSE_CATEGORIES.has(e.category)){
     materialExpensesByOrder.set(e.order_id,(materialExpensesByOrder.get(e.order_id)??0n)+moneyToCents(e.amount));
    }
   }

   const trendDates=daysBetween(trendFrom, period.to);
   const unsupportedStaffScope=Boolean(selected.host||selected.persona||selected.operator);

   const enrichedRooms=result.rooms.map(room=>{
    const roomValidOrders=validPeriodOrders.filter(o=>(o.live_room_code||'__unassigned__')===room.key);
    let matOrderCard=0n, matFallback=0n;
    for(const o of roomValidOrders){
     if(o.material_cost_cny!=null) matOrderCard+=moneyToCents(o.material_cost_cny);
     else matFallback+=materialExpensesByOrder.get(o.id)??0n;
    }
    const matTotal=matOrderCard+matFallback;
    const afterSaleCost=events
     .filter(e=>{
      if(e.kind!=='expense'||MATERIAL_EXPENSE_CATEGORIES.has(e.category)) return false;
      const ord=orderDirectory.get(e.order_id);
      return Boolean(ord&&(ord.deal_channel??'live')!=='private'&&(ord.live_room_code||'__unassigned__')===room.key&&!ord.cancelled&&ord.status!=='refunded');
     })
     .reduce((s,e)=>s+moneyToCents(e.amount),0n);
    const roomReims=unsupportedStaffScope?[]:roomReimRows.filter(r=>r.live_room_name===room.key||r.live_room_name===room.roomCode);
    const roomReimTotal=roomReims.reduce((s,r)=>s+moneyToCents(r.amount),0n);
    const staffTotal=0n;
    const directExpense=staffTotal+afterSaleCost+roomReimTotal;
    const perfCents=moneyToCents(room.totals.performanceCny);
    const netProfit=perfCents-matTotal-directExpense;
    const marginPct=perfCents>0n?Number((netProfit*1000n)/perfCents)/10:0;

    let pendingBalCents=0n;
    for(const o of roomValidOrders){
     const cur=o.customer_currency||'CNY';
     const dueCents=moneyToCents(o.customer_due||'0.00')+moneyToCents(o.charge_due||'0.00');
     const paidCents=moneyToCents(o.base_paid||'0.00')+moneyToCents(o.charge_paid||'0.00');
     if(dueCents>paidCents) pendingBalCents+=toCnyCents(centsToMoney(dueCents-paidCents),cur);
    }

    const trend7d=trendDates.map(d=>{
     const hit=trendRows.find(tr=>tr.room_key===room.key&&tr.business_date===d);
     return { date:d, amount:hit?hit.amount:null };
    });

    const profit={
     materialCostCny:centsToMoney(matTotal),
     materialCostSources:{orderCardCny:centsToMoney(matOrderCard),expenseFallbackCny:centsToMoney(matFallback),excludedCancelledCny:'0.00',label:'优先采用开单卡「料子本钱」，缺省回退已登记供货/配货款。'},
     staff:{hostCommission:{value:unsupportedStaffScope?null:'0.00',status:unsupportedStaffScope?'unsupported_scope':'ok',records:[]},assistantCommission:{value:unsupportedStaffScope?null:'0.00',status:unsupportedStaffScope?'unsupported_scope':'ok',records:[]},actorSessionFee:{value:unsupportedStaffScope?null:'0.00',status:unsupportedStaffScope?'unsupported_scope':'ok',records:[]},totalCny:unsupportedStaffScope?null:'0.00',status:unsupportedStaffScope?'unsupported_scope':'ok'},
     liveRoomProfitCny:centsToMoney(netProfit),
     status:unsupportedStaffScope?'unsupported_scope':'ok',
     source:'直播间有效业绩 - 料子本钱 - 人员场次费 - 售后成本 - 关联直播间已核报销（不含全公司投流）',
     afterSaleCostCny:centsToMoney(afterSaleCost),
     roomReimbursementCny:centsToMoney(roomReimTotal),
     roomReimbursementRecords:roomReims,
     directExpenseCny:centsToMoney(directExpense),
     netLiveRoomProfitCny:centsToMoney(netProfit),
     netGrossMargin:marginPct,
     pendingBalanceCny:centsToMoney(pendingBalCents)
    };
    return {...room, profit, trend7d};
   });

   const orderStatusList=periodOrders.map(o=>({
    id:o.id,
    orderRef:o.order_ref,
    businessDate:o.business_date,
    customerLabel:o.customer_label||'客户待补',
    roomKey:o.live_room_code||'__unassigned__',
    roomCode:o.live_room_code||'未归属直播间',
    hostName:o.host_name||'主播待补',
    operatorName:o.operator_name||o.wechat_id||'待补',
    bookingAmount:o.booking_amount,
    cancelled:Boolean(o.cancelled),
    status:o.status,
    customerDue:o.customer_due,
    basePaid:o.base_paid,
    basePaymentCount:o.base_payment_count,
    hasSplitPayment:o.has_split_payment,
    hasFullPayment:o.has_full_payment,
    shippedOn:o.shipped_on,
    chargeDue:o.charge_due,
    chargePaid:o.charge_paid,
    hasSourcingNoSettle:o.has_sourcing_no_settle,
    currency:o.customer_currency||'CNY'
   })).sort((a,b)=>b.businessDate.localeCompare(a.businessDate)||a.orderRef.localeCompare(b.orderRef));

   const totalTurn=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.totals.performanceCny),0n);
   const totalMat=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.profit.materialCostCny),0n);
   const totalStaff=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.profit.staff.totalCny||'0.00'),0n);
   const totalAfter=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.profit.afterSaleCostCny),0n);
   const totalReim=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.profit.roomReimbursementCny),0n);
   const totalDirect=totalStaff+totalAfter+totalReim;
   const totalGp=totalTurn-totalMat-totalDirect;
   const totalPendingBal=enrichedRooms.reduce((s,r)=>s+moneyToCents(r.profit.pendingBalanceCny),0n);
   const validCount=enrichedRooms.reduce((s,r)=>s+r.totals.newOrderCount,0);

   const roomSummary={
    validOrderCount:validCount,
    avgOrderCny:validCount>0?centsToMoney(totalTurn/BigInt(validCount)):'0.00',
    totalTurnoverCny:centsToMoney(totalTurn),
    totalMaterialCostCny:centsToMoney(totalMat),
    totalStaffCostCny:centsToMoney(totalStaff),
    totalAfterSaleCostCny:centsToMoney(totalAfter),
    totalRoomReimbursementCny:centsToMoney(totalReim),
    totalDirectExpenseCny:centsToMoney(totalDirect),
    totalGrossProfitCny:centsToMoney(totalGp),
    grossMargin:totalTurn>0n?Number((totalGp*1000n)/totalTurn)/10:0,
    companyReceivedCny:result.totals.companyReceivedCny,
    pendingBalanceCny:centsToMoney(totalPendingBal),
    roomReimbursements:roomReimRows
   };

   res.set('Cache-Control','private, no-store').json({period,selected,...result,rooms:enrichedRooms,orderStatusList,roomSummary,paidPerformance:{amountCny:paidRecords.length?addMoney(paidRecords.map(r=>r.amount_cny)):null,recordCount:paidRecords.length,scope:'room_host',records:paidRecords},afterSales:{receipts:afterReceipts,recordCount:afterRows.length,unclassifiedReceiptCount,records:afterRows},options,ads:{scope:'company',spendUsd:addMoney(ads.map(a=>a.amount)),records:ads,unknownCount:unknownAds},refundMethod:'cancelled_and_legacy_refunded_orders_reverse_original_booking_day',turnoverMethod:'booking_price_plus_buying_fee_excludes_additional_charges'});
  }catch(e){if(c)await c.query('ROLLBACK').catch(()=>{});next(e);}finally{c?.release();}
 });return router;
}
