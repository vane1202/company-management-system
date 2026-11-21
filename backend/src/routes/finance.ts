import { Router, type Request, type Response, type NextFunction } from "express";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { writeAudit } from "../audit.js";
import { amount, currency, dateField, hashPayload, replay, textField, uuid } from "../lib/commerce.js";
import { addMoney, centsToMoney, moneyToCents } from "../lib/money.js";
import {createPaidPerformanceRouter} from './paidPerformance.js';

export function createFinanceRouter(db:Pool, config:AppConfig) {
  const router=Router();
  router.use((req,_res,next)=>["boss","finance"].includes(req.actor!.role)?next():next(new HttpError(403,"无财务权限")));
  router.use('/live-performance',createPaidPerformanceRouter(db,config));
  const mutate=(handler:(c:PoolClient,req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{
    if(req.actor!.role!=="finance"){next(new HttpError(403,"仅财务可登记结算"));return;}
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.json(result))
      .catch(next);
  };
  router.get("/", (_req, res, next) => {
    void withTransaction(db, async (c) => {
      // Deliberately excludes cost prices, private photos and unrelated personnel data.
      const payments=(await c.query(`SELECT p.id,p.order_id,o.order_ref,o.customer_label,d.persona_name,d.persona_code,d.live_room_code,d.host_name,d.customer_code,d.operator_name,u.service_account_label AS wechat_id,p.payment_date,p.amount,p.currency,p.credit_amount,p.received_cny,d.customer_currency,p.purpose,p.channel,p.third_party,p.reference,p.voided_at,p.void_reason,COALESCE((SELECT sum(a.foreign_amount) FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id WHERE a.payment_id=p.id AND s.voided_at IS NULL),0)::numeric(14,2) AS settled_amount FROM customer_payments p JOIN orders o ON o.id=p.order_id JOIN order_details d ON d.order_id=o.id JOIN users u ON u.id=o.user_id ORDER BY p.payment_date DESC,p.created_at DESC`)).rows.map(p=>({...p,pendingAmount:p.voided_at||!p.third_party?"0.00":centsToMoney(moneyToCents(p.amount)-moneyToCents(p.settled_amount))}));
      const settlements=(await c.query(`SELECT s.id,s.reference,s.channel,s.currency,s.settled_on,s.fee_amount,s.fee_currency,s.fee_percent,s.fx_rate,s.net_cny,s.note,s.voided_at,s.void_reason,COALESCE((SELECT json_agg(json_build_object('paymentId',a.payment_id,'foreignAmount',a.foreign_amount::text,'netCny',a.net_cny::text)) FROM settlement_allocations a WHERE a.settlement_id=s.id),'[]'::json) AS allocations FROM finance_settlements s ORDER BY s.settled_on DESC,s.created_at DESC`)).rows;
      const pending=Object.fromEntries(["CNY","TWD","USD","SGD","HKD"].map(cur=>[cur,addMoney(payments.filter(p=>p.currency===cur).map(p=>p.pendingAmount))]));
      const directCny=addMoney(payments.filter(p=>!p.voided_at&&!p.third_party&&p.currency==="CNY").map(p=>p.amount));
      const settledCny=addMoney(settlements.filter(s=>!s.voided_at).map(s=>s.net_cny));
      return {payments,settlements,summary:{pending,directCny,settledCny,totalCny:addMoney([directCny,settledCny])}};
    }, true).then((result) => res.set("Cache-Control", "private, no-store").json(result)).catch(next);
  });
  router.post("/settlements",mutate(async(c,req)=>{
    const b=req.body??{};
    if(!Array.isArray(b.allocations)||!b.allocations.length||b.allocations.length>100)throw new HttpError(400,"请选择1至100笔收款并填写分配金额");
    const allocations=b.allocations.map((a:any)=>({paymentId:uuid(a.paymentId),foreignAmount:amount(a.foreignAmount,"本次结算原币",true),netCny:amount(a.netCny,"分配人民币到账")})).sort((a:any,z:any)=>a.paymentId.localeCompare(z.paymentId));
    if(new Set(allocations.map((a:any)=>a.paymentId)).size!==allocations.length)throw new HttpError(400,"同笔收款不能重复分配");
    const body={reference:textField(b.reference,"结算流水号"),channel:textField(b.channel,"第三方账户"),currency:currency(b.currency),settledOn:dateField(b.settledOn,config.businessTimezone),feeAmount:amount(b.feeAmount??"0","扣费"),feeCurrency:currency(b.feeCurrency),feePercent:decimal(b.feePercent,4,100),fxRate:decimal(b.fxRate,6,null),netCny:amount(b.netCny,"实际人民币到账"),note:textField(b.note??"","备注",500,false),allocations};
    if(body.netCny!==addMoney(allocations.map((a:any)=>a.netCny)))throw new HttpError(400,"分配人民币金额合计必须等于实际到账");
    const hash=hashPayload(body),old=await replay(c,"finance_settlements",uuid(b.requestKey),hash);if(old)return {id:old.id,replayed:true};
    // Sorted row locks serialize overlapping batches and payment corrections.
    for(const a of allocations){
      const p=(await c.query("SELECT * FROM customer_payments WHERE id=$1 FOR UPDATE",[a.paymentId])).rows[0];
      if(!p||p.voided_at||!p.third_party||p.currency!==body.currency||p.channel!==body.channel)throw new HttpError(409,"收款不存在、已作废或与本次账户/币种不符");
      if(body.settledOn<String(p.payment_date))throw new HttpError(400,"结算日期不能早于收款日期");
      const used=(await c.query("SELECT COALESCE(sum(a.foreign_amount),0)::text AS amount FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id WHERE a.payment_id=$1 AND s.voided_at IS NULL",[p.id])).rows[0].amount;
      if(moneyToCents(used)+moneyToCents(a.foreignAmount)>moneyToCents(p.amount))throw new HttpError(409,"本次结算超过第三方剩余待结金额");
    }
    const s=(await c.query(`INSERT INTO finance_settlements(reference,channel,currency,settled_on,fee_amount,fee_currency,fee_percent,fx_rate,net_cny,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[body.reference,body.channel,body.currency,body.settledOn,body.feeAmount,body.feeCurrency,body.feePercent,body.fxRate,body.netCny,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    for(const a of allocations)await c.query("INSERT INTO settlement_allocations(settlement_id,payment_id,foreign_amount,net_cny) VALUES($1,$2,$3,$4)",[s.id,a.paymentId,a.foreignAmount,a.netCny]);
    await writeAudit(c,{actorId:req.actor!.id,action:"finance_settlement_create",entityType:"finance_settlement",entityId:s.id,after:body,ip:req.ip});return {id:s.id};
  }));
  router.post("/settlements/:id/void",mutate(async(c,req)=>{
    const id=uuid(req.params.id),reason=textField(req.body?.reason,"作废原因",500);
    const s=(await c.query("SELECT * FROM finance_settlements WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!s)throw new HttpError(404,"结算不存在");if(s.voided_at)return {id};
    await c.query("SELECT p.id FROM customer_payments p JOIN settlement_allocations a ON a.payment_id=p.id WHERE a.settlement_id=$1 ORDER BY p.id FOR UPDATE OF p",[id]);
    await c.query("UPDATE finance_settlements SET voided_at=now(),void_reason=$2 WHERE id=$1",[id,reason]);
    await writeAudit(c,{actorId:req.actor!.id,action:"finance_settlement_void",entityType:"finance_settlement",entityId:id,after:{reason},ip:req.ip});return {id};
  }));
  return router;
}
function decimal(input:unknown,places:number,max:number|null) {
  if(input===undefined||input===null||input==="")return null;
  if(typeof input!=="string"||!new RegExp(`^\\d{1,12}(?:\\.\\d{1,${places}})?$`).test(input)||!Number.isFinite(Number(input))||(max===null?Number(input)<=0:Number(input)>max))throw new HttpError(400,max===null?"汇率须大于0，最多6位小数":"扣点须在0至100之间，最多4位小数");
  return input;
}
