import express, { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { writeAudit } from "../audit.js";
import { addMoney, centsToMoney, moneyToCents } from "../lib/money.js";
import { amount, buyingFee, currency, dateField, hashPayload, replay, textField, uuid, visibleOrder, writeOrder } from "../lib/commerce.js";

export function createOrderRecordsRouter(db: Pool, config: AppConfig) {
  const router=Router();
  router.use((req,_res,next)=>["boss","cs","cs_supervisor"].includes(req.actor!.role)?next():next(new HttpError(403,"无订单档案权限")));
  const tx=(handler:(c:PoolClient,req:Request,res:Response)=>Promise<void>)=>(req:Request,res:Response,next:express.NextFunction)=>{
    void (async()=>{const c=await db.connect();try{await c.query("BEGIN");await handler(c,req,res);await c.query("COMMIT");}catch(e){await c.query("ROLLBACK");next(e);}finally{c.release();}})();
  };
  // Responses are sent only after commit; a failed commit must never look like a saved report.
  const mutate=(handler:(c:PoolClient,req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:express.NextFunction)=>{
    void(async()=>{const c=await db.connect();try{await c.query("BEGIN");const result=await handler(c,req);await c.query("COMMIT");res.json(result);}catch(e){await c.query("ROLLBACK");next(e);}finally{c.release();}})();
  };
  const audit=(c:PoolClient,req:Request,action:string,id:string,data:unknown)=>writeAudit(c,{actorId:req.actor!.id,action,entityType:"order",entityId:id,after:data,ip:req.ip});
  const touch=async(c:PoolClient,id:string)=>{await c.query("UPDATE orders SET updated_at=now(),review_version=review_version+1 WHERE id=$1",[id]);await c.query("UPDATE order_details SET version=version+1 WHERE order_id=$1",[id]);};
  router.post("/",mutate(async(c,req)=>{
    if(req.actor!.role!=="cs")throw new HttpError(403,"仅客服可填报订单");
    const b=req.body ?? {}, key=uuid(b.requestKey);
    const items=readItems(b.items);
    const total=addMoney(items.flatMap(i=>[i.priceCny,i.buyingFeeCny]));
    amount(total,"成交合计",true);
    const cur=currency(b.customerCurrency);
    const body={owner:req.actor!.id,businessDate:dateField(b.businessDate,config.businessTimezone),orderRef:textField(b.orderRef,"订单号",64),customerLabel:textField(b.customerLabel,"客户称呼",64),personaName:textField(b.personaName,"人设"),operatorName:textField(b.operatorName,"经办客服"),source:textField(b.source??"","来源",128,false),note:textField(b.note??"","备注",500,false),customerCurrency:cur,customerDue:cur==="CNY"?total:amount(b.customerDue,"客户约定总应收",true),items};
    const hash=hashPayload(body), old=await replay(c,"order_details",key,hash);
    if(old)return {id:old.order_id,replayed:true};
    const o=(await c.query(`INSERT INTO orders(user_id,business_date,order_ref,customer_label,amount,status,is_custom,note,last_submitted_by) VALUES($1,$2,$3,$4,$5,'placed',FALSE,$6,$1) RETURNING id`,[body.owner,body.businessDate,body.orderRef,body.customerLabel,total,body.note])).rows[0];
    await c.query(`INSERT INTO order_details(order_id,persona_name,operator_name,source,customer_currency,customer_due,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[o.id,body.personaName,body.operatorName,body.source,cur,body.customerDue,key,hash]);
    for(const i of items)await c.query("INSERT INTO order_items(order_id,label,material_ref,kind,price_cny,buying_fee_cny) VALUES($1,$2,$3,$4,$5,$6)",[o.id,i.label,i.materialRef,i.kind,i.priceCny,i.buyingFeeCny]);
    await audit(c,req,"order_record_create",o.id,body);
    return {id:o.id};
  }));
  router.get("/:id",tx(async(c,req,res)=>{
    // Repeatable read keeps the balance and its receipt list in the same snapshot.
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const order=await visibleOrder(c,req.actor!,req.params.id);
    const details=(await c.query("SELECT * FROM order_details WHERE order_id=$1",[order.id])).rows[0];
    if(!details){res.json({order,legacy:true});return;}
    const items=(await c.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",[order.id])).rows;
    const payments=(await c.query(`SELECT p.id,p.payment_date,p.amount,p.currency,p.credit_amount,p.purpose,p.channel,p.third_party,p.reference,p.note,p.created_at,p.voided_at,p.void_reason,COALESCE((SELECT sum(a.foreign_amount) FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id WHERE a.payment_id=p.id AND s.voided_at IS NULL),0)::numeric(14,2) AS settled_amount FROM customer_payments p WHERE p.order_id=$1 ORDER BY p.created_at,p.id`,[order.id])).rows;
    const expenses=(await c.query("SELECT id,business_date,category,label,amount_cny,created_at,voided_at,void_reason FROM order_expenses WHERE order_id=$1 ORDER BY created_at,id",[order.id])).rows;
    const attachments=(await c.query("SELECT id,item_id,filename,mime_type,created_at FROM order_attachments WHERE order_id=$1 ORDER BY created_at,id",[order.id])).rows;
    const paid=addMoney(payments.filter(p=>!p.voided_at).map(p=>p.credit_amount));
    const balance=centsToMoney(moneyToCents(details.customer_due)-moneyToCents(paid));
    res.json({order,details:{personaName:details.persona_name,operatorName:details.operator_name,source:details.source,customerCurrency:details.customer_currency,customerDue:details.customer_due,shippedOn:details.shipped_on,version:details.version},items,payments,expenses,attachments,paid,balance,expenseTotal:addMoney(expenses.filter(e=>!e.voided_at).map(e=>e.amount_cny)),legacy:false});
  }));
  router.patch("/:id",mutate(async(c,req)=>{
    const id=uuid(req.params.id),{order,details}=await writeOrder(c,req.actor!,id),b=req.body??{};
    if(Number(b.version)!==details.version)throw new HttpError(409,"订单已变更，请刷新后再编辑");
    if(order.status==="shipped"||order.status==="refunded"||(await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL",[id])).rowCount)throw new HttpError(409,"已有有效收款或已发货，不能直接修改成交；登记错误须先核对并纠正关联记录");
    const items=readItems(b.items),total=addMoney(items.flatMap(i=>[i.priceCny,i.buyingFeeCny]));amount(total,"成交合计",true);
    const cur=currency(b.customerCurrency),body={reason:textField(b.reason,"修改原因",500),businessDate:dateField(b.businessDate,config.businessTimezone),orderRef:textField(b.orderRef,"订单号",64),customerLabel:textField(b.customerLabel,"客户称呼",64),personaName:textField(b.personaName,"人设"),operatorName:textField(b.operatorName,"经办客服"),source:textField(b.source??"","来源",128,false),note:textField(b.note??"","备注",500,false),customerCurrency:cur,customerDue:cur==="CNY"?total:amount(b.customerDue,"客户约定总应收",true),items};
    if(cur!==details.customer_currency&&(await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1",[id])).rowCount)throw new HttpError(409,"已有付款记录（包括作废记录），不能变更约定币种，请保留原币种核对更正");
    const beforeItems=(await c.query("SELECT id,label,material_ref,kind,price_cny,buying_fee_cny FROM order_items WHERE order_id=$1 ORDER BY id",[id])).rows;
    // Removed item links retain the original order-level photo; never delete originals.
    await c.query("UPDATE order_attachments SET item_id=NULL WHERE order_id=$1",[id]);await c.query("DELETE FROM order_items WHERE order_id=$1",[id]);
    for(const i of items)await c.query("INSERT INTO order_items(order_id,label,material_ref,kind,price_cny,buying_fee_cny) VALUES($1,$2,$3,$4,$5,$6)",[id,i.label,i.materialRef,i.kind,i.priceCny,i.buyingFeeCny]);
    await c.query("UPDATE orders SET business_date=$2,order_ref=$3,customer_label=$4,amount=$5,note=$6 WHERE id=$1",[id,body.businessDate,body.orderRef,body.customerLabel,total,body.note]);
    await c.query("UPDATE order_details SET persona_name=$2,operator_name=$3,source=$4,customer_currency=$5,customer_due=$6 WHERE order_id=$1",[id,body.personaName,body.operatorName,body.source,cur,body.customerDue]);await touch(c,id);
    await writeAudit(c,{actorId:req.actor!.id,action:"order_record_correct",entityType:"order",entityId:id,before:{order,details,items:beforeItems},after:body,ip:req.ip});return {id};
  }));
  router.post("/:id/payments",mutate(async(c,req)=>{
    const b=req.body??{},id=uuid(req.params.id),{details,order}=await writeOrder(c,req.actor!,id);
    if(order.status==="refunded")throw new HttpError(409,"退款标记订单暂不接受新收款，请先核对退款记录");
    const cur=currency(b.currency),val=amount(b.amount,"原币收款",true);
    const body={orderId:id,paymentDate:dateField(b.paymentDate,config.businessTimezone),amount:val,currency:cur,creditAmount:cur===details.customer_currency?val:amount(b.creditAmount,"本次抵扣应收",true),purpose:textField(b.purpose,"款项类型"),channel:textField(b.channel,"收款账户"),thirdParty:b.thirdParty===true,reference:textField(b.reference??"","收款流水号",128,false),note:textField(b.note??"","备注",500,false)};
    if(!["deposit","balance","full"].includes(body.purpose))throw new HttpError(400,"款项类型无效");
    if(cur!=="CNY"&&!body.thirdParty)throw new HttpError(400,"外币收款须登记第三方账户");
    if(body.paymentDate<String(order.business_date))throw new HttpError(400,"收款日期不能早于订单日期");
    const hash=hashPayload(body),old=await replay(c,"customer_payments",uuid(b.requestKey),hash,id);if(old)return {id:old.id,replayed:true};
    const paid=(await c.query("SELECT COALESCE(sum(credit_amount),0)::text AS paid FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL",[id])).rows[0].paid;
    if(moneyToCents(paid)+moneyToCents(body.creditAmount)>moneyToCents(details.customer_due))throw new HttpError(409,"本次抵扣金额超过客户剩余应收");
    const row=(await c.query(`INSERT INTO customer_payments(order_id,payment_date,amount,currency,credit_amount,purpose,channel,third_party,reference,note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,[id,body.paymentDate,val,cur,body.creditAmount,body.purpose,body.channel,body.thirdParty,body.reference,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    await touch(c,id);await audit(c,req,"customer_payment_create",id,{id:row.id,...body});return {id:row.id};
  }));
  router.post("/:id/payments/:paymentId/void",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);
    const p=(await c.query("SELECT * FROM customer_payments WHERE id=$1 AND order_id=$2 FOR UPDATE",[uuid(req.params.paymentId),id])).rows[0];
    if(!p)throw new HttpError(404,"收款不存在");
    const reason=textField(req.body?.reason,"作废原因",500);
    if(p.voided_at)return {id:p.id};
    if((await c.query("SELECT 1 FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id WHERE a.payment_id=$1 AND s.voided_at IS NULL",[p.id])).rowCount)throw new HttpError(409,"收款已关联结算，请财务先作废对应结算");
    await c.query("UPDATE customer_payments SET voided_at=now(),void_reason=$2 WHERE id=$1",[p.id,reason]);await touch(c,id);await audit(c,req,"customer_payment_void",id,{paymentId:p.id,reason});return {id:p.id};
  }));
  const syncCosts=async(c:PoolClient,id:string)=>{await c.query(`UPDATE orders SET custom_product_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category IN ('goods','certificate','box','other')),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL),labor_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category='labor'),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL),shipping_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category='shipping'),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL) WHERE id=$1`,[id]);await touch(c,id);};
  router.post("/:id/expenses",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);const b=req.body??{};
    const body={orderId:id,businessDate:dateField(b.businessDate,config.businessTimezone),category:textField(b.category,"费用类别"),label:textField(b.label,"费用说明"),amountCny:amount(b.amountCny,"费用金额",true)};
    if(!["goods","labor","certificate","box","shipping","other"].includes(body.category))throw new HttpError(400,"费用类别无效");
    const hash=hashPayload(body),old=await replay(c,"order_expenses",uuid(b.requestKey),hash,id);if(old)return {id:old.id,replayed:true};
    const row=(await c.query("INSERT INTO order_expenses(order_id,business_date,category,label,amount_cny,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[id,body.businessDate,body.category,body.label,body.amountCny,req.actor!.id,b.requestKey,hash])).rows[0];
    await syncCosts(c,id);await audit(c,req,"order_expense_create",id,{id:row.id,...body});return {id:row.id};
  }));
  router.post("/:id/expenses/:expenseId/void",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);const reason=textField(req.body?.reason,"作废原因",500);
    const row=(await c.query("SELECT id,voided_at FROM order_expenses WHERE id=$1 AND order_id=$2 FOR UPDATE",[uuid(req.params.expenseId),id])).rows[0];
    if(!row)throw new HttpError(404,"费用不存在");if(row.voided_at)return {id:row.id};
    await c.query("UPDATE order_expenses SET voided_at=now(),void_reason=$2 WHERE id=$1",[row.id,reason]);await syncCosts(c,id);await audit(c,req,"order_expense_void",id,{id:row.id,reason});return {id:row.id};
  }));
  router.post("/:id/shipping",mutate(async(c,req)=>{
    const id=uuid(req.params.id),{order}=await writeOrder(c,req.actor!,id);
    const date=dateField(req.body?.shippedOn,config.businessTimezone);
    if(date<String(order.business_date)||order.status==="refunded")throw new HttpError(409,"发货日期早于订单或订单已标记退款");
    await c.query("UPDATE orders SET status='shipped' WHERE id=$1",[id]);await c.query("UPDATE order_details SET shipped_on=$2 WHERE order_id=$1",[id,date]);await touch(c,id);await audit(c,req,"order_shipping",id,{shippedOn:date});return {id};
  }));
  router.post("/:id/attachments",express.raw({type:["image/jpeg","image/png","image/webp"],limit:"8mb"}),mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);
    const bytes=req.body;
    if(!Buffer.isBuffer(bytes)||bytes.length<12)throw new HttpError(400,"请上传 JPEG、PNG 或 WebP 原图");
    const mime=bytes.subarray(0,3).equals(Buffer.from([255,216,255]))?"image/jpeg":bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"?"image/webp":"";
    if(!mime||mime!==req.get("content-type")?.split(";")[0])throw new HttpError(400,"图片内容与格式不符");
    const sha=createHash("sha256").update(bytes).digest("hex");
    const old=(await c.query("SELECT id FROM order_attachments WHERE order_id=$1 AND sha256=$2",[id,sha])).rows[0];if(old)return {id:old.id};
    if(Number((await c.query("SELECT count(*) FROM order_attachments WHERE order_id=$1",[id])).rows[0].count)>=12)throw new HttpError(409,"每单最多留存12张原图");
    const itemId=req.query.itemId?uuid(req.query.itemId):null;
    if(itemId&&!(await c.query("SELECT 1 FROM order_items WHERE id=$1 AND order_id=$2",[itemId,id])).rowCount)throw new HttpError(400,"照片对应料子不属于此单");
    const filename=textField(req.query.filename??"留底照片","文件名",180).replace(/[\\/\r\n\u0000-\u001f]/g,"_");
    const row=(await c.query("INSERT INTO order_attachments(order_id,item_id,filename,mime_type,image_bytes,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[id,itemId,filename,mime,bytes,sha,req.actor!.id])).rows[0];
    await audit(c,req,"order_photo_create",id,{id:row.id,filename,sha256:sha,itemId});return {id:row.id};
  }));
  router.get("/:id/attachments/:attachmentId",async(req,res,next)=>{try{
    await visibleOrder(db,req.actor!,req.params.id);
    const row=(await db.query("SELECT mime_type,image_bytes FROM order_attachments WHERE order_id=$1 AND id=$2",[uuid(req.params.id),uuid(req.params.attachmentId)])).rows[0];if(!row)throw new HttpError(404,"图片不存在");
    res.set({"Content-Type":row.mime_type,"Content-Disposition":`inline; filename="${req.params.attachmentId}.${row.mime_type.split("/")[1]}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(row.image_bytes);
  }catch(e){next(e);}});
  return router;
}

function readItems(input:unknown) {
  if(!Array.isArray(input)||!input.length||input.length>50)throw new HttpError(400,"每单需1至50条商品明细");
  return input.map(i=>{
    if(!i||typeof i!=="object")throw new HttpError(400,"商品明细无效");
    const kind=textField(i.kind,"商品类别"),priceCny=amount(i.priceCny,"谈成价格",true);
    if(!["material","finished"].includes(kind))throw new HttpError(400,"商品类别无效");
    return {kind,label:textField(i.label,"商品名称"),materialRef:textField(i.materialRef??"","料子编号",128,false),priceCny,buyingFeeCny:buyingFee(priceCny,kind)};
  });
}
