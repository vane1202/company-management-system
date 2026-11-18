import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db.js';
import type { AppConfig } from '../config.js';
import { HttpError } from '../types.js';
import { amount,dateField,hashPayload,replay,textField,uuid } from '../lib/commerce.js';
import { addMoney,centsToMoney,moneyToCents } from '../lib/money.js';
import { writeAudit } from '../audit.js';

export function createSupplierPaymentsRouter(db:Pool,config:AppConfig) {
  const router=Router();
  router.use((req,_res,next)=>['boss','finance'].includes(req.actor!.role)?next():next(new HttpError(403,'无供应商付款权限')));
  router.get('/:expenseId/attachments',async(req,res,next)=>{try{
    const e=(await db.query('SELECT order_id,item_id FROM order_expenses WHERE id=$1',[uuid(req.params.expenseId)])).rows[0];if(!e)throw new HttpError(404,'费用不存在');
    const attachments=(await db.query('SELECT id,filename,mime_type FROM order_attachments WHERE order_id=$1 AND ($2::uuid IS NULL OR item_id=$2 OR item_id IS NULL) ORDER BY created_at,id',[e.order_id,e.item_id])).rows;
    res.set('Cache-Control','private, no-store').json({attachments});
  }catch(e){next(e);}});
  router.get('/:expenseId/attachments/:attachmentId',async(req,res,next)=>{try{
    const e=(await db.query('SELECT order_id,item_id FROM order_expenses WHERE id=$1',[uuid(req.params.expenseId)])).rows[0];if(!e)throw new HttpError(404,'费用不存在');
    const a=(await db.query('SELECT mime_type,image_bytes FROM order_attachments WHERE id=$1 AND order_id=$2 AND ($3::uuid IS NULL OR item_id=$3 OR item_id IS NULL)',[uuid(req.params.attachmentId),e.order_id,e.item_id])).rows[0];if(!a)throw new HttpError(404,'原图不存在或不对应此项成本');
    res.set({'Content-Type':a.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(a.image_bytes);
  }catch(e){next(e);}});
  const mutate=(handler:(c:PoolClient,req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>{
    if(req.actor!.role!=='finance'){next(new HttpError(403,'仅财务可登记公司付款'));return;}
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.json(result))
      .catch(next);
  };
  router.get('/', (_req, res, next) => {
    void withTransaction(db, async (c) => {
      const expenses=(await c.query(`SELECT e.id,e.order_id,e.business_date,e.category,e.label,e.amount_cny,e.counterparty,e.note,e.payment_tracking_started,e.voided_at,e.void_reason,o.order_ref,o.customer_label,d.persona_name,d.persona_code,d.live_room_code,d.host_name,d.customer_code,d.operator_name,u.service_account_label AS wechat_id,i.material_ref,i.label AS item_label,COALESCE((SELECT sum(p.amount_cny) FROM supplier_payments p WHERE p.expense_id=e.id AND p.voided_at IS NULL),0)::numeric(14,2) AS paid_cny FROM order_expenses e JOIN orders o ON o.id=e.order_id JOIN order_details d ON d.order_id=o.id JOIN users u ON u.id=o.user_id LEFT JOIN order_items i ON i.id=e.item_id ORDER BY e.business_date DESC,e.created_at DESC`)).rows.map(e=>({...e,pending_cny:!e.payment_tracking_started?null:e.voided_at?'0.00':centsToMoney(moneyToCents(e.amount_cny)-moneyToCents(e.paid_cny)),paymentState:e.voided_at?'void':!e.payment_tracking_started?'unknown':moneyToCents(e.paid_cny)===0n?'unpaid':moneyToCents(e.paid_cny)===moneyToCents(e.amount_cny)?'paid':'partial'}));
      const payments=(await c.query('SELECT * FROM supplier_payments ORDER BY paid_on DESC,created_at DESC')).rows;
      return {expenses,payments,summary:{costCny:addMoney(expenses.filter(e=>!e.voided_at).map(e=>e.amount_cny)),paidCny:addMoney(payments.filter(p=>!p.voided_at).map(p=>p.amount_cny)),pendingCny:addMoney(expenses.filter(e=>e.pending_cny!==null).map(e=>e.pending_cny!)),unknownCount:expenses.filter(e=>!e.voided_at&&!e.payment_tracking_started).length}};
    }, true).then((result) => res.json(result)).catch(next);
  });
  router.post('/payments',mutate(async(c,req)=>{
    const b=req.body??{},body={expenseId:uuid(b.expenseId),paidOn:dateField(b.paidOn,config.businessTimezone),payee:textField(b.payee,'实际收款方'),account:textField(b.account,'公司付款账户'),reference:textField(b.reference,'付款流水号'),amountCny:amount(b.amountCny,'实际人民币付款',true),note:textField(b.note??'','备注',500,false)};
    // Same lock used by expense cancellation; a partial payment can never race a void.
    const e=(await c.query('SELECT * FROM order_expenses WHERE id=$1 FOR UPDATE',[body.expenseId])).rows[0];if(!e||e.voided_at)throw new HttpError(409,'业务费用不存在或已作废');
    if(!e.payment_tracking_started)throw new HttpError(409,'历史费用付款情况待核对，请先确认纳入付款台账');
    const hash=hashPayload(body),old=await replay(c,'supplier_payments',uuid(b.requestKey),hash);if(old)return{id:old.id,replayed:true};
    if(body.paidOn<String(e.business_date))throw new HttpError(400,'付款日期不能早于费用日期');
    const paid=(await c.query('SELECT COALESCE(sum(amount_cny),0)::text AS total FROM supplier_payments WHERE expense_id=$1 AND voided_at IS NULL',[e.id])).rows[0].total;
    const remaining = moneyToCents(e.amount_cny) - moneyToCents(paid);
    const requested = moneyToCents(body.amountCny);
    if (requested > remaining) throw new HttpError(409, '付款超过该笔剩余应付');
    // Preserve the approved bill's unpaid amount, including when a historical bill only covered part of the expense.
    const approved = (await c.query(`SELECT GREATEST(b.amount_cny - COALESCE((
      SELECT sum(p.amount_cny) FROM supplier_payments p WHERE p.warehouse_bill_id=b.id AND p.voided_at IS NULL
    ), 0), 0)::text AS reserved FROM warehouse_bills b WHERE b.expense_id=$1 AND b.status='approved'`, [e.id])).rows[0];
    if (approved && requested > remaining - moneyToCents(approved.reserved)) {
      throw new HttpError(409, '付款超过未分配给库房结账单的应付余额，请在库房结账中登记账单款项');
    }
    const p=(await c.query('INSERT INTO supplier_payments(expense_id,paid_on,payee,account,reference,amount_cny,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',[e.id,body.paidOn,body.payee,body.account,body.reference,body.amountCny,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    await writeAudit(c,{actorId:req.actor!.id,action:'supplier_payment_create',entityType:'order',entityId:e.order_id,after:{id:p.id,...body},ip:req.ip});return{id:p.id};
  }));
  router.post('/expenses/:id/track',mutate(async(c,req)=>{
    const id=uuid(req.params.id),reason=textField(req.body?.reason,'核对说明',500),e=(await c.query('SELECT * FROM order_expenses WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!e||e.voided_at)throw new HttpError(404,'费用不存在或已作废');
    await c.query('UPDATE order_expenses SET payment_tracking_started=TRUE WHERE id=$1',[id]);
    await writeAudit(c,{actorId:req.actor!.id,action:'supplier_opening_confirm',entityType:'order',entityId:e.order_id,before:{tracking:e.payment_tracking_started},after:{reason},ip:req.ip});return{id};
  }));
  router.post('/payments/:id/void',mutate(async(c,req)=>{
    const id=uuid(req.params.id),reason=textField(req.body?.reason,'作废原因',500),link=(await c.query('SELECT expense_id FROM supplier_payments WHERE id=$1',[id])).rows[0];if(!link)throw new HttpError(404,'付款不存在');
    await c.query('SELECT id FROM order_expenses WHERE id=$1 FOR UPDATE',[link.expense_id]);const p=(await c.query('SELECT * FROM supplier_payments WHERE id=$1 FOR UPDATE',[id])).rows[0];if(p.voided_at)return{id};
    await c.query('UPDATE supplier_payments SET voided_at=now(),void_reason=$2 WHERE id=$1',[id,reason]);await writeAudit(c,{actorId:req.actor!.id,action:'supplier_payment_void',entityType:'supplier_payment',entityId:id,after:{reason},ip:req.ip});return{id};
  }));return router;
}
