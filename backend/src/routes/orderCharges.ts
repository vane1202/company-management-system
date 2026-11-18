import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../types.js';
import { amount, dateField, hashPayload, replay, textField, uuid, writeOrder } from '../lib/commerce.js';
import { effectiveDue, syncOrderAmounts } from '../lib/orderLifecycle.js';
import { centsToMoney, moneyToCents } from '../lib/money.js';
import { writeAudit } from '../audit.js';

export function createOrderChargesRouter(db: Pool, config: AppConfig) {
  const router = Router({mergeParams:true});
  const mutate = (handler:(c:PoolClient,req:Request)=>Promise<unknown>) => (req:Request,res:Response,next:NextFunction) => {
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.json(result))
      .catch(next);
  };
  router.post('/', mutate(async(c,req)=>{
    const id=uuid(req.params.id), {order,details}=await writeOrder(c,req.actor!,id), b=req.body??{};
    if(order.cancelled)throw new HttpError(409,'跑单订单不能追加应收，请先核对并撤销跑单');
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
    if((await c.query('SELECT 1 FROM customer_payments WHERE after_sale_charge_id=$1 AND voided_at IS NULL UNION ALL SELECT 1 FROM order_expenses WHERE after_sale_charge_id=$1 AND voided_at IS NULL',[row.id])).rowCount)throw new HttpError(409,'此售后业务已关联收款或成本，请先核对关联记录再纠错');
    const due=await effectiveDue(c,id,details.customer_due),paid=(await c.query('SELECT COALESCE(sum(credit_amount),0)::text AS total FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL',[id])).rows[0].total;
    if(moneyToCents(paid)>moneyToCents(due)-moneyToCents(row.customer_amount))throw new HttpError(409,'作废后应收小于客户已付，请先核对收款');
    await c.query('UPDATE order_charges SET voided_at=now(),void_reason=$2 WHERE id=$1',[row.id,reason]);await syncOrderAmounts(c,id);
    await writeAudit(c,{actorId:req.actor!.id,action:'order_charge_void',entityType:'order',entityId:id,after:{chargeId:row.id,reason,remainingDue:centsToMoney(moneyToCents(due)-moneyToCents(row.customer_amount))},ip:req.ip});return{id:row.id};
  }));
  router.post('/:chargeId/costs-complete',mutate(async(c,req)=>{
    const id=uuid(req.params.id),{details}=await writeOrder(c,req.actor!,id),b=req.body??{};
    if(Number(b.version)!==details.version)throw new HttpError(409,'订单已变更，请刷新后再确认成本');
    if(typeof b.complete!=='boolean')throw new HttpError(400,'请选择成本是否已录齐');
    const row=(await c.query('UPDATE order_charges SET costs_completed_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1 AND order_id=$2 AND voided_at IS NULL RETURNING id',[uuid(req.params.chargeId),id,b.complete])).rows[0];if(!row)throw new HttpError(404,'售后业务不存在');
    await c.query('UPDATE order_details SET version=version+1 WHERE order_id=$1',[id]);
    await writeAudit(c,{actorId:req.actor!.id,action:'after_sale_costs_complete',entityType:'order',entityId:id,after:{chargeId:row.id,complete:b.complete},ip:req.ip});return{id:row.id};
  }));
  return router;
}
