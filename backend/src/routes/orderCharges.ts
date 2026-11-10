import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { AppConfig } from '../config.js';
import { HttpError } from '../types.js';
import { amount, dateField, hashPayload, replay, textField, uuid, writeOrder } from '../lib/commerce.js';
import { effectiveDue, syncOrderAmounts } from '../lib/orderLifecycle.js';
import { centsToMoney, moneyToCents } from '../lib/money.js';
import { writeAudit } from '../audit.js';

export function createOrderChargesRouter(db: Pool, config: AppConfig) {
  const router = Router({mergeParams:true});
  const mutate = (handler:(c:PoolClient,req:Request)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => {
    void (async()=>{const c=await db.connect();try{await c.query('BEGIN');const result=await handler(c,req);await c.query('COMMIT');res.json(result);}catch(e){await c.query('ROLLBACK');next(e);}finally{c.release();}})();
  };
  router.post('/', mutate(async(c,req)=>{
    const id=uuid(req.params.id), {order,details}=await writeOrder(c,req.actor!,id), b=req.body??{};
    if(order.status==='refunded')throw new HttpError(409,'退款订单不能追加应收');
    const body={orderId:id,businessDate:dateField(b.businessDate,config.businessTimezone),label:textField(b.label,'客户收费项目'),amountCny:amount(b.amountCny,'人民币报价',true),customerAmount:details.customer_currency==='CNY'?amount(b.amountCny,'人民币报价',true):amount(b.customerAmount,'追加约定应收',true),note:textField(b.note??'','备注',500,false)};
    if(body.businessDate<String(order.business_date))throw new HttpError(400,'收费日期不能早于成交日期');
    const hash=hashPayload(body),old=await replay(c,'order_charges',uuid(b.requestKey),hash,id);if(old)return{id:old.id,replayed:true};
    const row=(await c.query('INSERT INTO order_charges(order_id,business_date,label,amount_cny,customer_amount,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[id,body.businessDate,body.label,body.amountCny,body.customerAmount,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    await syncOrderAmounts(c,id);await writeAudit(c,{actorId:req.actor!.id,action:'order_charge_create',entityType:'order',entityId:id,after:{id:row.id,...body},ip:req.ip});return{id:row.id};
  }));
  router.post('/:chargeId/void',mutate(async(c,req)=>{
    const id=uuid(req.params.id),{details}=await writeOrder(c,req.actor!,id),reason=textField(req.body?.reason,'作废原因',500);
    const row=(await c.query('SELECT * FROM order_charges WHERE id=$1 AND order_id=$2 FOR UPDATE',[uuid(req.params.chargeId),id])).rows[0];if(!row)throw new HttpError(404,'收费不存在');if(row.voided_at)return{id:row.id};
    const due=await effectiveDue(c,id,details.customer_due),paid=(await c.query('SELECT COALESCE(sum(credit_amount),0)::text AS total FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL',[id])).rows[0].total;
    if(moneyToCents(paid)>moneyToCents(due)-moneyToCents(row.customer_amount))throw new HttpError(409,'作废后应收小于客户已付，请先核对收款');
    await c.query('UPDATE order_charges SET voided_at=now(),void_reason=$2 WHERE id=$1',[row.id,reason]);await syncOrderAmounts(c,id);
    await writeAudit(c,{actorId:req.actor!.id,action:'order_charge_void',entityType:'order',entityId:id,after:{chargeId:row.id,reason,remainingDue:centsToMoney(moneyToCents(due)-moneyToCents(row.customer_amount))},ip:req.ip});return{id:row.id};
  }));
  return router;
}
