import express, { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { writeAudit } from "../audit.js";
import { addMoney, centsToMoney, moneyToCents } from "../lib/money.js";
import { afterSaleCharge, amount, cancellationOrder, buyingFee, currency, dateField, hashPayload, replay, textField, uuid, visibleOrder, writeOrder, lockedOrder } from "../lib/commerce.js";

import { effectiveDue, orderIdentity } from "../lib/orderLifecycle.js";
import { createOrderChargesRouter } from "./orderCharges.js";
import { canonicalLiveRoom, liveRoomHosts, liveRoomSql } from "../lib/liveRoomIdentity.js";
import { teamOrderSql } from "../lib/teamOrder.js";

const ROOM_LINKS_SQL = `SELECT (
    EXISTS (SELECT 1 FROM customer_payments WHERE order_id=$1)
    OR EXISTS (SELECT 1 FROM order_expenses WHERE order_id=$1)
    OR EXISTS (SELECT 1 FROM order_charges WHERE order_id=$1)
    OR EXISTS (SELECT 1 FROM warehouse_bills WHERE order_id=$1)
    OR EXISTS (SELECT 1 FROM reimbursement_claims WHERE order_id=$1)
    OR EXISTS (SELECT 1 FROM live_paid_performance WHERE business_date=$2 AND voided_at IS NULL
      AND ${liveRoomSql("live_room_code")}=ANY($3::text[]))
  ) AS locked`;

async function ownedCustomer(db:PoolClient, actorId:string, id:string) {
  const {rows:[customer]}=await db.query(
    "SELECT id,customer_label FROM fan_leads WHERE id=$1 AND user_id=$2 AND voided_at IS NULL FOR UPDATE",
    [id,actorId]);
  if(!customer)throw new HttpError(404,"客资不存在或不在本人登记范围");
  return customer as {id:string; customer_label:string};
}

async function orderTeams(db: Pool | PoolClient, userId: string, date: string, lock = false) {
  const {rows} = await db.query<{id: string; name: string}>(`
    SELECT t.id,t.name FROM team_memberships m JOIN teams t ON t.id=m.team_id
    WHERE m.user_id=$1 AND m.start_date<=$2::date AND (m.end_date IS NULL OR m.end_date>=$2::date)
      AND t.is_active ORDER BY ${teamOrderSql("t")} ${lock ? 'FOR SHARE OF m,t' : ''}`, [userId,date]);
  return [...new Map(rows.map(team=>[team.id,team])).values()];
}

export function createOrderRecordsRouter(db: Pool, config: AppConfig) {
  const router=Router();
  router.use((req,_res,next)=>["boss","cs","cs_supervisor"].includes(req.actor!.role)?next():next(new HttpError(403,"无订单档案权限")));
  router.use("/:id/charges",createOrderChargesRouter(db,config));
  // Responses are sent only after commit; a failed commit must never look like a saved report.
  const mutate=(handler:(c:PoolClient,req:Request)=>Promise<unknown>)=>(req:Request,res:Response,next:express.NextFunction)=>{
    void withTransaction(db, (client) => handler(client, req))
      .then((result) => res.json(result))
      .catch(next);
  };
  const audit=(c:PoolClient,req:Request,action:string,id:string,data:unknown)=>writeAudit(c,{actorId:req.actor!.id,action,entityType:"order",entityId:id,after:data,ip:req.ip});
  const touch=async(c:PoolClient,id:string)=>{await c.query("UPDATE orders SET updated_at=now(),review_version=review_version+1 WHERE id=$1",[id]);await c.query("UPDATE order_details SET version=version+1 WHERE order_id=$1",[id]);};
  router.get("/performance-teams",async(req,res,next)=>{
    try {
      if(req.actor!.role!=="cs")throw new HttpError(403,"仅客服可查询本人的开单小组");
      const date=dateField(req.query.date,config.businessTimezone);
      const teams=await orderTeams(db,req.actor!.id,date);
      res.set("Cache-Control","private, no-store").json({teams});
    } catch(error) { next(error); }
  });
  router.get("/persona-options",async(_req,res,next)=>{
    try {
      const {rows}=await db.query<{name:string}>(
        "SELECT DISTINCT TRIM(persona_name) AS name FROM editor_reports WHERE TRIM(COALESCE(persona_name,''))<>'' AND TRIM(persona_name) <> ALL($1::text[]) ORDER BY 1",
        [["人设集体视频","客户视频","成品素材","直播预告"]]
      );
      res.set("Cache-Control","private, no-store").json({personas:rows.map(row=>row.name)});
    } catch(error) { next(error); }
  });
  router.post("/",mutate(async(c,req)=>{
    if(req.actor!.role!=="cs")throw new HttpError(403,"仅客服可填报订单");
    const b=req.body ?? {}, key=uuid(b.requestKey);
    const dealChannel=readDealChannel(b.dealChannel);
    const items=readItems(b.items,dealChannel);
    const total=addMoney(items.flatMap(i=>[i.priceCny,i.buyingFeeCny]));
    amount(total,"成交合计",true);
    const cur=currency(b.customerCurrency);
    const businessDate=dateField(b.businessDate,config.businessTimezone);
    const rawRef=typeof b.orderRef==="string"?b.orderRef.trim():"";
    const orderRef=rawRef?textField(rawRef,"订单号",64):`ORD-${businessDate.replace(/-/g,"")}-${key.slice(0,6).toUpperCase()}`;
    const materialCostCny=optionalAmount(b.materialCostCny,"本价（白条价）");
    const materialLotNo=textField(b.materialLotNo??"","料号",64,false);
    const projectLine=textField(b.projectLine??"","项目线",64,false);
    const body={owner:req.actor!.id,businessDate,orderRef,customerLabel:textField(b.customerLabel,"客户称呼",64),personaName:textField(b.personaName,"人设"),...orderIdentity(b),operatorName:textField(b.operatorName,"经办客服"),dealChannel,projectLine,materialCostCny,materialLotNo,source:textField(b.source??"","来源",128,false),note:textField(b.note??"","备注",500,false),customerCurrency:cur,customerDue:cur==="CNY"?total:amount(b.customerDue,"客户约定总应收",true),items};
    const requestedTeam = b.performanceTeamId ? uuid(b.performanceTeamId) : null;
    const customerLeadId=b.customerLeadId?uuid(b.customerLeadId):null;
    const hash=hashPayload({...body,...(requestedTeam?{performanceTeamId:requestedTeam}:{}),...(customerLeadId?{customerLeadId}:{})});
    const old=await replay(c,"order_details",key,hash);
    if(old)return {id:old.order_id,replayed:true};
    const customer=customerLeadId?await ownedCustomer(c,body.owner,customerLeadId):null;
    const teams=await orderTeams(c,body.owner,businessDate,true);
    if(!teams.length)throw new HttpError(409,"开单日没有可用的所属小组，请联系管理员分配");
    const team=requestedTeam ? teams.find(item=>item.id===requestedTeam) : teams.length===1 ? teams[0] : undefined;
    if(!team)throw new HttpError(400,requestedTeam?"请选择开单日所属的有效小组":"请选择这笔成交的业绩归属小组");
    const o=(await c.query(`INSERT INTO orders(user_id,business_date,order_ref,customer_label,amount,status,is_custom,note,last_submitted_by,material_cost_cny,material_lot_no,performance_team_id,customer_lead_id) VALUES($1,$2,$3,$4,$5,'placed',FALSE,$6,$1,$7,$8,$9,$10) RETURNING id`,[body.owner,body.businessDate,body.orderRef,customer?.customer_label??body.customerLabel,total,body.note,body.materialCostCny,body.materialLotNo,team.id,customerLeadId])).rows[0];
    await c.query(`INSERT INTO order_details(order_id,persona_name,operator_name,source,customer_currency,customer_due,request_key,payload_hash,deal_channel,project_line) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[o.id,body.personaName,body.operatorName,body.source,cur,body.customerDue,key,hash,body.dealChannel,body.projectLine]);
    await c.query("UPDATE order_details SET persona_code=$2,live_room_code=$3,host_name=$4,customer_code=$5 WHERE order_id=$1",[o.id,body.personaCode,body.liveRoomCode,body.hostName,body.customerCode]);
    const itemIds:string[]=[];
    for(const i of items){const ins=(await c.query("INSERT INTO order_items(order_id,label,material_ref,kind,price_cny,buying_fee_cny,sourcing_no_settle) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[o.id,i.label,i.materialRef,i.kind,i.priceCny,i.buyingFeeCny,i.sourcingNoSettle])).rows[0];itemIds.push(ins.id);}
    await audit(c,req,"order_record_create",o.id,{...body,customerLabel:customer?.customer_label??body.customerLabel,performanceTeamId:team.id,customerLeadId});
    return {id:o.id,itemIds};
  }));
  router.get("/:id", (req, res, next) => {
    // Repeatable read keeps the balance and its receipt list in the same snapshot.
    void withTransaction(db, async (c) => {
      const order=await visibleOrder(c,req.actor!,req.params.id);
      const cancellations=(await c.query('SELECT x.*,u.display_name AS created_by_name,v.display_name AS voided_by_name FROM order_cancellations x LEFT JOIN users u ON u.id=x.created_by LEFT JOIN users v ON v.id=x.voided_by WHERE x.order_id=$1 ORDER BY x.created_at,x.id',[order.id])).rows;
      const details=(await c.query("SELECT * FROM order_details WHERE order_id=$1",[order.id])).rows[0];
      if (!details) return {order, legacy:true};
      const items=(await c.query("SELECT * FROM order_items WHERE order_id=$1 ORDER BY id",[order.id])).rows;
      const payments=(await c.query(`SELECT p.id,p.payment_date,p.amount,p.currency,p.credit_amount,p.received_cny,p.purpose,p.channel,p.third_party,p.reference,p.note,p.created_at,p.voided_at,p.void_reason,p.after_sale_charge_id,p.verify_status,p.verify_reason,p.verified_cny,p.fee_cny,p.verified_on,(SELECT a.id FROM order_attachments a WHERE a.payment_id=p.id AND a.kind='payment_proof' ORDER BY a.created_at DESC LIMIT 1) AS proof_id,COALESCE((SELECT sum(a.foreign_amount) FROM settlement_allocations a JOIN finance_settlements s ON s.id=a.settlement_id WHERE a.payment_id=p.id AND s.voided_at IS NULL),0)::numeric(14,2) AS settled_amount FROM customer_payments p WHERE p.order_id=$1 ORDER BY p.created_at,p.id`,[order.id])).rows;
      const expenses=(await c.query("SELECT id,business_date,category,label,amount_cny,counterparty,item_id,note,created_at,voided_at,void_reason,after_sale_charge_id FROM order_expenses WHERE order_id=$1 ORDER BY created_at,id",[order.id])).rows;
      const attachments=(await c.query("SELECT id,item_id,filename,mime_type,created_at,kind FROM order_attachments WHERE order_id=$1 ORDER BY created_at,id",[order.id])).rows;
      const charges=(await c.query("SELECT a.*,COALESCE((SELECT sum(e.amount_cny) FROM order_expenses e WHERE e.after_sale_charge_id=a.id AND e.voided_at IS NULL),0)::numeric(14,2)::text AS cost_cny FROM order_charges a WHERE a.order_id=$1 ORDER BY a.created_at,a.id",[order.id])).rows.map(a=>({...a,margin_cny:a.costs_completed_at?centsToMoney(moneyToCents(a.amount_cny)-moneyToCents(a.cost_cny)):null}));
      const totalDue=await effectiveDue(c,String(order.id),String(details.customer_due));
      const paid=addMoney(payments.filter(p=>!p.voided_at&&p.verify_status!=="rejected").map(p=>p.credit_amount));
      const balance=centsToMoney(moneyToCents(totalDue)-moneyToCents(paid));
      return {order,cancellations,details:{dealChannel:details.deal_channel??"live",projectLine:details.project_line??"",personaName:details.persona_name,operatorName:details.operator_name,source:details.source,customerCurrency:details.customer_currency,customerDue:totalDue,baseCustomerDue:details.customer_due,personaCode:details.persona_code,liveRoomCode:canonicalLiveRoom(details.live_room_code),hostName:details.host_name,customerCode:details.customer_code,shippedOn:details.shipped_on,version:details.version},items,charges,payments,expenses,attachments,paid,balance,expenseTotal:addMoney(expenses.filter(e=>!e.voided_at).map(e=>e.amount_cny)),legacy:false};
    }, true).then((result) => res.json(result)).catch(next);
  });
  router.post('/:id/cancellations',mutate(async(c,req)=>{
    const id=uuid(req.params.id),{order,details}=await cancellationOrder(c,req.actor!,id),b=req.body??{};
    if(Number(b.version)!==details.version)throw new HttpError(409,'订单已变更，请刷新后再登记跑单');
    if(order.cancelled)throw new HttpError(409,'此单已登记跑单，不重复冲抵');
    if(!['placed','in_production'].includes(order.status)||details.shipped_on)throw new HttpError(409,'已发货或退款订单不能登记为未付款跑单');
    if((await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[id])).rowCount)throw new HttpError(409,'已有有效收款，须另行处理退款，不能登记为未付款跑单');
    if((await c.query('SELECT 1 FROM order_charges WHERE order_id=$1 AND voided_at IS NULL',[id])).rowCount)throw new HttpError(409,'已有追加应收，请先核对追加收费，不能直接登记未付款跑单');
    const reason=textField(b.reason,'跑单原因',500),base=(await c.query('SELECT sum(price_cny+buying_fee_cny)::text AS amount FROM order_items WHERE order_id=$1',[id])).rows[0].amount;
    amount(base,'开单金额',true);
    const entry=(await c.query('INSERT INTO order_cancellations(order_id,booked_on,base_amount_cny,reason,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id',[id,order.business_date,base,reason,req.actor!.id])).rows[0];
    await touch(c,id);await audit(c,req,'order_cancellation_create',id,{cancellationId:entry.id,reason,bookedOn:order.business_date,baseAmountCny:base,method:'reverse_original_booking_day',actorRole:req.actor!.role});
    return{id:entry.id};
  }));
  router.post('/:id/cancellations/:cancellationId/void',mutate(async(c,req)=>{
    const id=uuid(req.params.id),{details}=await cancellationOrder(c,req.actor!,id),b=req.body??{};
    if(Number(b.version)!==details.version)throw new HttpError(409,'订单已变更，请刷新后再撤销跑单');
    const entry=(await c.query('SELECT * FROM order_cancellations WHERE id=$1 AND order_id=$2 FOR UPDATE',[uuid(req.params.cancellationId),id])).rows[0];
    if(!entry)throw new HttpError(404,'跑单记录不存在');
    if(entry.voided_at)throw new HttpError(409,'跑单记录已撤销，请刷新');
    const reason=textField(b.reason,'撤销跑单原因',500);
    await c.query('UPDATE order_cancellations SET voided_at=now(),voided_by=$2,void_reason=$3 WHERE id=$1',[entry.id,req.actor!.id,reason]);
    await touch(c,id);await audit(c,req,'order_cancellation_void',id,{cancellationId:entry.id,reason,bookedOn:entry.booked_on,baseAmountCny:entry.base_amount_cny,actorRole:req.actor!.role});
    return{id:entry.id};
  }));
  router.delete("/:id",mutate(async(c,req)=>{
    if(!["boss","cs_supervisor"].includes(req.actor!.role))throw new HttpError(403,"仅 BOSS 或本组客服主管可删除订单");
    const id=uuid(req.params.id);
    const order=await visibleOrder(c,req.actor!,id,true);
    const reason=textField(req.body?.reason,"删除原因",500);
    const details=(await c.query("SELECT * FROM order_details WHERE order_id=$1",[id])).rows[0]??null;
    if(["shipped","refunded"].includes(order.status)||details?.shipped_on)throw new HttpError(409,"已发货或已退款的订单不能删除");
    if((await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1 LIMIT 1",[id])).rowCount)throw new HttpError(409,"该订单已有收款记录，不能删除");
    if((await c.query("SELECT 1 FROM order_expenses WHERE order_id=$1 LIMIT 1",[id])).rowCount)throw new HttpError(409,"该订单已有成本或业务费用记录，不能删除");
    if((await c.query("SELECT 1 FROM order_charges WHERE order_id=$1 LIMIT 1",[id])).rowCount)throw new HttpError(409,"该订单已有售后追加记录，不能删除");
    if((await c.query("SELECT 1 FROM warehouse_bills WHERE order_id=$1 LIMIT 1",[id])).rowCount)throw new HttpError(409,"该订单已有库房结账单，不能删除");
    if((await c.query("SELECT 1 FROM reimbursement_claims WHERE order_id=$1 LIMIT 1",[id])).rowCount)throw new HttpError(409,"该订单已关联报销单，不能删除");
    const itemCount=Number((await c.query("SELECT count(*) FROM order_items WHERE order_id=$1",[id])).rows[0].count);
    const attachmentCount=Number((await c.query("SELECT count(*) FROM order_attachments WHERE order_id=$1",[id])).rows[0].count);
    await c.query("DELETE FROM order_attachments WHERE order_id=$1",[id]);
    await c.query("DELETE FROM order_cancellations WHERE order_id=$1",[id]);
    await c.query("DELETE FROM order_items WHERE order_id=$1",[id]);
    await c.query("DELETE FROM order_details WHERE order_id=$1",[id]);
    await c.query("DELETE FROM orders WHERE id=$1",[id]);
    await writeAudit(c,{
      actorId:req.actor!.id,
      action:"order_delete",
      entityType:"order",
      entityId:id,
      before:{
        order_ref:order.order_ref,
        customer_label:order.customer_label,
        business_date:order.business_date,
        amount:order.amount,
        status:order.status,
        user_id:order.user_id,
        performance_team_id:order.performance_team_id,
        details:details?{persona_name:details.persona_name,live_room_code:details.live_room_code,deal_channel:details.deal_channel,operator_name:details.operator_name}:null,
        item_count:itemCount,
        attachment_count:attachmentCount
      },
      after:{deleted:true,reason,actorRole:req.actor!.role},
      ip:req.ip
    });
    return{ok:true,id};
  }));
  router.post("/:id/live-room", mutate(async (c, req) => {
    if (req.actor!.role !== "cs_supervisor") throw new HttpError(403, "仅负责小组的客服主管可更正直播间");
    const id = uuid(req.params.id);
    const {order, details} = await lockedOrder(c, req.actor!, id);
    const version = req.body?.version;
    const liveRoomCode = textField(req.body?.liveRoomCode, "直播间", 64);
    const hostName = liveRoomHosts.get(liveRoomCode);
    const reason = textField(req.body?.reason, "更正原因", 500);
    if (!hostName) throw new HttpError(400, "请选择已登记的直播间");
    if (version !== details.version) throw new HttpError(409, "订单已变更，请刷新后重试");
    if (details.deal_channel === "private" || order.cancelled || details.shipped_on || ["shipped", "refunded"].includes(order.status)) {
      throw new HttpError(409, "客服私推、跑单、已发货或已退款的订单不能更正直播间");
    }
    if (canonicalLiveRoom(details.live_room_code) === liveRoomCode && details.host_name === hostName) {
      throw new HttpError(400, "请选择与当前归属不同的直播间");
    }
    // Serialize against new room-level verifications while checking linked records.
    await c.query("LOCK TABLE live_paid_performance IN SHARE MODE");
    const {rows: [links]} = await c.query(ROOM_LINKS_SQL, [
      id, order.business_date, [canonicalLiveRoom(details.live_room_code), liveRoomCode],
    ]);
    if (links.locked) throw new HttpError(409, "已有收款、成本、结账、报销或直播间核定记录，请先联系财务核对");
    await c.query("UPDATE order_details SET live_room_code=$2, host_name=$3 WHERE order_id=$1", [id, liveRoomCode, hostName]);
    await touch(c, id);
    await writeAudit(c, {
      actorId: req.actor!.id, action: "order_live_room_correct", entityType: "order", entityId: id, ip: req.ip,
      before: {liveRoomCode: details.live_room_code, hostName: details.host_name, version},
      after: {liveRoomCode, hostName, version: version + 1, reason},
    });
    return {id};
  }));
  router.post("/:id/customer",mutate(async(c,req)=>{
    if(req.actor!.role!=="cs")throw new HttpError(403,"仅经办客服可补关联订单");
    const id=uuid(req.params.id),target=uuid(req.body?.customerLeadId);
    const reason=textField(req.body?.reason,"关联原因",500);
    const order=await visibleOrder(c,req.actor!,id,true);
    if(order.customer_lead_id===target)return {id};
    if(order.customer_lead_id)throw new HttpError(409,"订单已关联客户，请刷新核对");
    const customer=await ownedCustomer(c,req.actor!.id,target);
    await c.query("UPDATE orders SET customer_lead_id=$2, updated_at=now() WHERE id=$1",[id,customer.id]);
    await audit(c,req,"order_customer_link",id,{customerLeadId:customer.id,reason});
    return {id};
  }));
  router.patch("/:id",mutate(async(c,req)=>{
    const id=uuid(req.params.id),{order,details}=await writeOrder(c,req.actor!,id),b=req.body??{};
    if(order.cancelled)throw new HttpError(409,'已登记跑单，请先撤销跑单后再更正开单卡');
    if(Number(b.version)!==details.version)throw new HttpError(409,"订单已变更，请刷新后再编辑");
    if(order.status==="shipped"||order.status==="refunded"||(await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[id])).rowCount)throw new HttpError(409,"已有有效收款或已发货，不能直接修改成交；登记错误须先核对并纠正关联记录");
    if((await c.query("SELECT 1 FROM order_charges WHERE order_id=$1",[id])).rowCount)throw new HttpError(409,"已有追加收费记录，请保留原成交，通过追加收费纠错处理");
    const dealChannel=readDealChannel(b.dealChannel??details.deal_channel);
    const items=readItems(b.items,dealChannel),total=addMoney(items.flatMap(i=>[i.priceCny,i.buyingFeeCny]));amount(total,"成交合计",true);
    const materialCostCny=optionalAmount(b.materialCostCny,"本价（白条价）");
    const materialLotNo=textField(b.materialLotNo??"","料号",64,false);
    const projectLine=textField(b.projectLine??"","项目线",64,false);
    const cur=currency(b.customerCurrency),body={reason:textField(b.reason,"修改原因",500),businessDate:dateField(b.businessDate,config.businessTimezone),orderRef:textField(b.orderRef,"订单号",64),customerLabel:textField(b.customerLabel,"客户称呼",64),personaName:textField(b.personaName,"人设"),...orderIdentity(b),operatorName:textField(b.operatorName,"经办客服"),dealChannel,projectLine,materialCostCny,materialLotNo,source:textField(b.source??"","来源",128,false),note:textField(b.note??"","备注",500,false),customerCurrency:cur,customerDue:cur==="CNY"?total:amount(b.customerDue,"客户约定总应收",true),items};
    if(cur!==details.customer_currency&&(await c.query("SELECT 1 FROM customer_payments WHERE order_id=$1",[id])).rowCount)throw new HttpError(409,"已有付款记录（包括作废记录），不能变更约定币种，请保留原币种核对更正");
    const beforeItems=(await c.query("SELECT id,label,material_ref,kind,price_cny,buying_fee_cny,sourcing_no_settle FROM order_items WHERE order_id=$1 ORDER BY id",[id])).rows;
    // Removed item links retain the original order-level photo; never delete originals.
    await c.query("UPDATE order_attachments SET item_id=NULL WHERE order_id=$1",[id]);await c.query("DELETE FROM order_items WHERE order_id=$1",[id]);
    const itemIds:string[]=[];
    for(const i of items){const ins=(await c.query("INSERT INTO order_items(order_id,label,material_ref,kind,price_cny,buying_fee_cny,sourcing_no_settle) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id",[id,i.label,i.materialRef,i.kind,i.priceCny,i.buyingFeeCny,i.sourcingNoSettle])).rows[0];itemIds.push(ins.id);}
    await c.query("UPDATE orders SET business_date=$2,order_ref=$3,customer_label=$4,amount=$5,note=$6,material_cost_cny=$7,material_lot_no=$8 WHERE id=$1",[id,body.businessDate,body.orderRef,body.customerLabel,total,body.note,body.materialCostCny,body.materialLotNo]);
    await c.query("UPDATE order_details SET persona_name=$2,operator_name=$3,source=$4,customer_currency=$5,customer_due=$6,deal_channel=$7,project_line=$8 WHERE order_id=$1",[id,body.personaName,body.operatorName,body.source,cur,body.customerDue,body.dealChannel,body.projectLine]);await touch(c,id);
    await c.query("UPDATE order_details SET persona_code=$2,live_room_code=$3,host_name=$4,customer_code=$5 WHERE order_id=$1",[id,body.personaCode,body.liveRoomCode,body.hostName,body.customerCode]);
    await writeAudit(c,{actorId:req.actor!.id,action:"order_record_correct",entityType:"order",entityId:id,before:{order,details,items:beforeItems},after:body,ip:req.ip});return {id,itemIds};
  }));
  router.post("/:id/payments",mutate(async(c,req)=>{
    const b=req.body??{},id=uuid(req.params.id),{details,order}=await writeOrder(c,req.actor!,id);
    if(order.cancelled)throw new HttpError(409,'已登记跑单，请先核对并撤销跑单后再登记收款');
    if(order.status==="refunded")throw new HttpError(409,"退款标记订单暂不接受新收款，请先核对退款记录");
    const cur=currency(b.currency),val=amount(b.amount,"原币收款",true);
    const charge=await afterSaleCharge(c,id,b.afterSaleChargeId);
    const allowOverpay=b.allowOverpay===true;
    const receivedCny=optionalAmount(b.receivedCny,"折合实收人民币")??(cur==="CNY"?val:null);
    const body={orderId:id,paymentDate:dateField(b.paymentDate,config.businessTimezone),amount:val,currency:cur,creditAmount:cur===details.customer_currency?val:amount(b.creditAmount,"本次抵扣应收",true),receivedCny,allowOverpay,purpose:textField(b.purpose,"款项类型"),channel:textField(b.channel,"收款账户"),thirdParty:b.thirdParty===true,reference:textField(b.reference??"","收款流水号",128,false),note:textField(b.note??"","备注",500,false),afterSaleChargeId:charge?.id??null};
    if(!["deposit","balance","full"].includes(body.purpose))throw new HttpError(400,"款项类型无效");
    if(cur!=="CNY"&&!body.thirdParty)throw new HttpError(400,"外币收款须登记第三方账户");
    if(body.paymentDate<String(order.business_date))throw new HttpError(400,"收款日期不能早于订单日期");
    const hash=hashPayload(body),old=await replay(c,"customer_payments",uuid(b.requestKey),hash,id);if(old)return {id:old.id,replayed:true};
    if(charge){const linked=(await c.query("SELECT COALESCE(sum(credit_amount),0)::text AS paid FROM customer_payments WHERE after_sale_charge_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[charge.id])).rows[0].paid;if(moneyToCents(linked)+moneyToCents(body.creditAmount)>moneyToCents(charge.customer_amount))throw new HttpError(409,'本笔售后收款超过该售后业务剩余应收');}
    const paid=(await c.query("SELECT COALESCE(sum(credit_amount),0)::text AS paid FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[id])).rows[0].paid;
    if(!allowOverpay&&moneyToCents(paid)+moneyToCents(body.creditAmount)>moneyToCents(await effectiveDue(c,id,details.customer_due)))throw new HttpError(409,"本次抵扣金额超过客户剩余应收");
    const proofId = String(b.proofAttachmentId ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proofId)) throw new HttpError(400, "\u8bf7\u5148\u4e0a\u4f20\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe");
    const proof = (await c.query("SELECT id,kind,payment_id FROM order_attachments WHERE id=$1 AND order_id=$2 FOR UPDATE", [proofId, id])).rows[0];
    if (!proof || proof.kind !== "payment_proof") throw new HttpError(400, "\u8bf7\u5148\u4e0a\u4f20\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe");
    if (proof.payment_id) throw new HttpError(409, "\u8fd9\u5f20\u4ed8\u6b3e\u51ed\u8bc1\u5df2\u7528\u4e8e\u5176\u4ed6\u6536\u6b3e");
    const row=(await c.query("INSERT INTO customer_payments(order_id,payment_date,amount,currency,credit_amount,received_cny,purpose,channel,third_party,reference,note,created_by,request_key,payload_hash,verify_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending') RETURNING id",[id,body.paymentDate,val,cur,body.creditAmount,body.receivedCny,body.purpose,body.channel,body.thirdParty,body.reference,body.note,req.actor!.id,b.requestKey,hash])).rows[0];
    if(charge)await c.query('UPDATE customer_payments SET after_sale_charge_id=$2 WHERE id=$1',[row.id,charge.id]);
    await c.query("UPDATE order_attachments SET payment_id=$2 WHERE id=$1",[proof.id,row.id]);
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

  router.post("/:id/payments/:paymentId/resubmit",mutate(async(c,req)=>{
    const id=uuid(req.params.id),{details,order}=await writeOrder(c,req.actor!,id);
    const p=(await c.query("SELECT * FROM customer_payments WHERE id=$1 AND order_id=$2 FOR UPDATE",[uuid(req.params.paymentId),id])).rows[0];
    if(!p)throw new HttpError(404,"\u6536\u6b3e\u4e0d\u5b58\u5728");
    if(p.voided_at)throw new HttpError(409,"\u6536\u6b3e\u5df2\u4f5c\u5e9f");
    if(p.verify_status!=="rejected")throw new HttpError(409,"\u53ea\u80fd\u91cd\u65b0\u63d0\u4ea4\u5df2\u9000\u56de\u7684\u6536\u6b3e");
    const b=req.body??{};
    const nextDate=b.paymentDate!==undefined?dateField(b.paymentDate,config.businessTimezone):String(p.payment_date);
    if(nextDate<String(order.business_date))throw new HttpError(400,"收款日期不能早于订单日期");
    const nextAmount=b.amount!==undefined&&String(b.amount).trim()!==""?amount(b.amount,"原币收款",true):String(p.amount);
    const nextCredit=p.currency===details.customer_currency?nextAmount:(b.creditAmount!==undefined&&String(b.creditAmount).trim()!==""?amount(b.creditAmount,"本次抵扣应收",true):String(p.credit_amount));
    const nextReceivedCny=b.receivedCny!==undefined?optionalAmount(b.receivedCny,"折合实收人民币")??(p.currency==="CNY"?nextAmount:null):(p.currency==="CNY"?nextAmount:p.received_cny);
    const nextChannel=b.channel!==undefined?textField(b.channel,"收款账户"):String(p.channel);
    const nextRef=b.reference!==undefined?textField(b.reference??"","收款流水号",128,false):String(p.reference??"");
    if(p.after_sale_charge_id){
      const chargeRow=(await c.query("SELECT customer_amount FROM order_charges WHERE id=$1",[p.after_sale_charge_id])).rows[0];
      if(chargeRow){
        const linked=(await c.query("SELECT COALESCE(sum(credit_amount),0)::text AS paid FROM customer_payments WHERE after_sale_charge_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[p.after_sale_charge_id])).rows[0].paid;
        if(moneyToCents(linked)+moneyToCents(nextCredit)>moneyToCents(chargeRow.customer_amount))throw new HttpError(409,"本笔售后收款超过该售后业务剩余应收");
      }
    }
    const paid=(await c.query("SELECT COALESCE(sum(credit_amount),0)::text AS paid FROM customer_payments WHERE order_id=$1 AND voided_at IS NULL AND verify_status <> 'rejected'",[id])).rows[0].paid;
    if(b.allowOverpay!==true&&moneyToCents(paid)+moneyToCents(nextCredit)>moneyToCents(await effectiveDue(c,id,details.customer_due)))throw new HttpError(409,"本次抵扣金额超过客户剩余应收");
    const proofId=String(b.proofAttachmentId??"");
    let proof=null;
    if(proofId){
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proofId))throw new HttpError(400,"\u8bf7\u5148\u4e0a\u4f20\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe");
      proof=(await c.query("SELECT id,kind,payment_id FROM order_attachments WHERE id=$1 AND order_id=$2 FOR UPDATE",[proofId,id])).rows[0];
      if(!proof||proof.kind!=="payment_proof")throw new HttpError(400,"\u8bf7\u5148\u4e0a\u4f20\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe");
      if(proof.payment_id&&proof.payment_id!==p.id)throw new HttpError(409,"\u8fd9\u5f20\u4ed8\u6b3e\u51ed\u8bc1\u5df2\u7528\u4e8e\u5176\u4ed6\u6536\u6b3e");
    } else if(!(await c.query("SELECT 1 FROM order_attachments WHERE payment_id=$1 AND kind='payment_proof'",[p.id])).rowCount) {
      throw new HttpError(400,"\u8bf7\u5148\u4e0a\u4f20\u5ba2\u6237\u4ed8\u6b3e\u51ed\u8bc1\u622a\u56fe");
    }
    await c.query("UPDATE customer_payments SET payment_date=$2,amount=$3,credit_amount=$4,received_cny=$5,channel=$6,reference=$7,verify_status='pending',verify_reason=NULL,verified_cny=NULL,fee_cny=NULL,verified_on=NULL,verified_by=NULL,verified_at=NULL WHERE id=$1",[p.id,nextDate,nextAmount,nextCredit,nextReceivedCny,nextChannel,nextRef]);
    if(proof&&proof.payment_id!==p.id){
      await c.query("UPDATE order_attachments SET payment_id=NULL WHERE payment_id=$1 AND kind='payment_proof'",[p.id]);
      await c.query("UPDATE order_attachments SET payment_id=$2 WHERE id=$1",[proof.id,p.id]);
    }
    await touch(c,id);await audit(c,req,"customer_payment_resubmit",id,{paymentId:p.id,amount:nextAmount,channel:nextChannel,paymentDate:nextDate,proofId:proof?.id??null});return {id:p.id};
  }));

  const syncCosts=async(c:PoolClient,id:string)=>{await c.query(`UPDATE orders SET custom_product_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category IN ('goods','sourcing','accessory','certificate','box','other')),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL),labor_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category IN ('labor','design')),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL),shipping_cost=(SELECT COALESCE(sum(amount_cny) FILTER(WHERE category='shipping'),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL) WHERE id=$1`,[id]);await touch(c,id);};
  router.post("/:id/items/:itemId/sourcing-status",mutate(async(c,req)=>{
    const id=uuid(req.params.id),itemId=uuid(req.params.itemId),{order}=await writeOrder(c,req.actor!,id);
    if(order.cancelled)throw new HttpError(409,"已登记跑单，不能修改接待（PH）标记");
    const item=(await c.query("SELECT id,label,material_ref,kind,sourcing_no_settle FROM order_items WHERE id=$1 AND order_id=$2 FOR UPDATE",[itemId,id])).rows[0];
    if(!item)throw new HttpError(404,"商品明细不存在");
    if(item.kind==="service")throw new HttpError(400,"纯工费/服务项无需设置接待（PH）标记");
    const nextStatus=Boolean(req.body?.sourcingNoSettle);
    const reason=textField(req.body?.reason??"","说明",500,false);
    await c.query("UPDATE order_items SET sourcing_no_settle=$2 WHERE id=$1",[item.id,nextStatus]);
    await touch(c,id);
    await audit(c,req,"order_item_sourcing_status",id,{itemId:item.id,label:item.label,materialRef:item.material_ref,before:item.sourcing_no_settle,after:nextStatus,reason});
    return {id:item.id,sourcingNoSettle:nextStatus};
  }));
  router.post("/:id/expenses",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);const b=req.body??{};
    const charge=await afterSaleCharge(c,id,b.afterSaleChargeId);
    const body={orderId:id,businessDate:dateField(b.businessDate,config.businessTimezone),category:textField(b.category,"费用类别"),label:textField(b.label,"费用说明"),amountCny:amount(b.amountCny,"费用金额",true),counterparty:textField(b.counterparty??"","供应/服务方",128,false),itemId:b.itemId?uuid(b.itemId):null,note:textField(b.note??"","费用备注",500,false),afterSaleChargeId:charge?.id??null};
    if(!["goods","labor","certificate","box","shipping","other","sourcing","accessory","design"].includes(body.category))throw new HttpError(400,"费用类别无效");
    if(body.itemId){
      const linkedItem=(await c.query("SELECT id,sourcing_no_settle FROM order_items WHERE id=$1 AND order_id=$2",[body.itemId,id])).rows[0];
      if(!linkedItem)throw new HttpError(400,"费用对应商品不属于此单");
      if(linkedItem.sourcing_no_settle&&body.category==="goods")throw new HttpError(409,"该件料子已标记为接待（PH）未售出，不用跟供应商结料款；请按「市场配货采购款」登记接待费用，或先取消接待（PH）标记");
    }
    const hash=hashPayload(body),old=await replay(c,"order_expenses",uuid(b.requestKey),hash,id);if(old)return {id:old.id,replayed:true};
    const row=(await c.query("INSERT INTO order_expenses(order_id,business_date,category,label,amount_cny,created_by,request_key,payload_hash,counterparty,item_id,note,payment_tracking_started) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE) RETURNING id",[id,body.businessDate,body.category,body.label,body.amountCny,req.actor!.id,b.requestKey,hash,body.counterparty,body.itemId,body.note])).rows[0];
    if(charge){await c.query('UPDATE order_expenses SET after_sale_charge_id=$2 WHERE id=$1',[row.id,charge.id]);await c.query('UPDATE order_charges SET costs_completed_at=NULL WHERE id=$1',[charge.id]);}
    await syncCosts(c,id);await audit(c,req,"order_expense_create",id,{id:row.id,...body});return {id:row.id};
  }));
  router.post("/:id/expenses/:expenseId/void",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);const reason=textField(req.body?.reason,"作废原因",500);
    const row=(await c.query("SELECT id,voided_at,after_sale_charge_id FROM order_expenses WHERE id=$1 AND order_id=$2 FOR UPDATE",[uuid(req.params.expenseId),id])).rows[0];
    if(!row)throw new HttpError(404,"费用不存在");if(row.voided_at)return {id:row.id};
    if((await c.query("SELECT 1 FROM supplier_payments WHERE expense_id=$1 AND voided_at IS NULL",[row.id])).rowCount)throw new HttpError(409,"已有实际付款，请财务先纠正关联付款");
    if ((await c.query("SELECT 1 FROM warehouse_bills WHERE expense_id=$1 AND status<>'rejected'", [row.id])).rowCount) throw new HttpError(409, "成本已关联库房结账单，不能直接作废");
    await c.query("UPDATE order_expenses SET voided_at=now(),void_reason=$2 WHERE id=$1",[row.id,reason]);if(row.after_sale_charge_id)await c.query('UPDATE order_charges SET costs_completed_at=NULL WHERE id=$1',[row.after_sale_charge_id]);await syncCosts(c,id);await audit(c,req,"order_expense_void",id,{id:row.id,reason});return {id:row.id};
  }));
  router.post("/:id/shipping",mutate(async(c,req)=>{
    const id=uuid(req.params.id),{order}=await writeOrder(c,req.actor!,id);
    if(order.cancelled)throw new HttpError(409,'已登记跑单，不能登记发货');
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
    const requested = String(req.query.kind ?? "card");
    if (!["card", "shipping_proof", "payment_proof"].includes(requested)) throw new HttpError(400, "\u56fe\u7247\u5206\u7c7b\u65e0\u6548");
    const kind = requested;
    const old=(await c.query("SELECT id,kind FROM order_attachments WHERE order_id=$1 AND sha256=$2",[id,sha])).rows[0];
    if(old){if(old.kind===kind)return {id:old.id};throw new HttpError(409,"\u8fd9\u5f20\u56fe\u7247\u5df2\u7528\u4e8e\u5176\u4ed6\u5206\u7c7b\uff0c\u8bf7\u53e6\u9009");}
    const itemId=kind==="card"&&req.query.itemId?uuid(String(req.query.itemId)):null;
    if(kind!=="card"&&req.query.itemId)throw new HttpError(400,"\u8fd9\u7c7b\u56fe\u7247\u4e0d\u6302\u5230\u5355\u4ef6\u5546\u54c1");
    if(itemId&&!(await c.query("SELECT 1 FROM order_items WHERE id=$1 AND order_id=$2",[itemId,id])).rowCount)throw new HttpError(400,"\u7167\u7247\u5bf9\u5e94\u6599\u5b50\u4e0d\u5c5e\u4e8e\u6b64\u5355");
    const limit=kind==="shipping_proof"?3:kind==="payment_proof"?30:12;
    const message=kind==="shipping_proof"?"\u6bcf\u5355\u6700\u591a 3 \u5f20\u5feb\u9012\u8bb0\u5f55\u622a\u56fe":kind==="payment_proof"?"\u6bcf\u5355\u6700\u591a 30 \u5f20\u4ed8\u6b3e\u51ed\u8bc1":"\u6bcf\u5355\u6700\u591a\u7559\u5b5812\u5f20\u539f\u56fe";
    if(Number((await c.query("SELECT count(*) FROM order_attachments WHERE order_id=$1 AND kind=$2",[id,kind])).rows[0].count)>=limit)throw new HttpError(409,message);
    const filename=textField(req.query.filename??(kind==="shipping_proof"?"\u5feb\u9012\u8bb0\u5f55\u622a\u56fe":kind==="payment_proof"?"\u4ed8\u6b3e\u51ed\u8bc1":"\u7559\u5e95\u7167\u7247"),"\u6587\u4ef6\u540d",180).replace(/[\\/\r\n\u0000-\u001f]/g,"_");
    const row=(await c.query("INSERT INTO order_attachments(order_id,item_id,filename,mime_type,image_bytes,sha256,created_by,kind) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[id,itemId,filename,mime,bytes,sha,req.actor!.id,kind])).rows[0];
    await audit(c,req,kind==="shipping_proof"?"order_shipping_proof_create":kind==="payment_proof"?"order_payment_proof_create":"order_photo_create",id,{id:row.id,filename,sha256:sha,itemId,kind});return {id:row.id};
  }));
  router.delete("/:id/attachments/:attachmentId",mutate(async(c,req)=>{
    const id=uuid(req.params.id);await writeOrder(c,req.actor!,id);
    const attachmentId=uuid(req.params.attachmentId);
    const row=(await c.query("SELECT id,kind FROM order_attachments WHERE order_id=$1 AND id=$2",[id,attachmentId])).rows[0];
    if(!row)throw new HttpError(404,"图片不存在");
    if(row.kind!=="shipping_proof"&&row.kind!=="payment_proof")throw new HttpError(409,"\u5f00\u5355\u5361\u539f\u56fe\u4e0d\u5728\u8fd9\u91cc\u5220\u9664");
    if(row.kind==="payment_proof"){const linked=(await c.query("SELECT payment_id FROM order_attachments WHERE id=$1",[row.id])).rows[0]; if(linked?.payment_id){const pay=(await c.query("SELECT verify_status,voided_at FROM customer_payments WHERE id=$1",[linked.payment_id])).rows[0]; if(pay&&!pay.voided_at&&pay.verify_status!=="rejected")throw new HttpError(409,"\u4ed8\u6b3e\u51ed\u8bc1\u5df2\u6302\u5230\u6536\u6b3e\uff0c\u4e0d\u80fd\u76f4\u63a5\u5220\u9664");}}
    await c.query("DELETE FROM order_attachments WHERE id=$1",[row.id]);
    await audit(c,req,"order_shipping_proof_delete",id,{id:row.id});return {id:row.id};
  }));
  router.get("/:id/attachments/:attachmentId",async(req,res,next)=>{try{
    await visibleOrder(db,req.actor!,req.params.id);
    const row=(await db.query("SELECT mime_type,image_bytes FROM order_attachments WHERE order_id=$1 AND id=$2",[uuid(req.params.id),uuid(req.params.attachmentId)])).rows[0];if(!row)throw new HttpError(404,"图片不存在");
    res.set({"Content-Type":row.mime_type,"Content-Disposition":`inline; filename="${req.params.attachmentId}.${row.mime_type.split("/")[1]}"`,"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}).send(row.image_bytes);
  }catch(e){next(e);}});
  return router;
}

function readDealChannel(input:unknown):"live"|"private" {
  if(input===undefined||input===null||input==="")return "live";
  if(input==="live"||input==="private")return input;
  throw new HttpError(400,"销售方式无效");
}
function optionalAmount(input:unknown,name:string):string|null {
  if(input===undefined||input===null||String(input).trim()==="")return null;
  return amount(input,name,false);
}
function readItems(input:unknown,dealChannel:"live"|"private"="live") {
  if(!Array.isArray(input)||!input.length||input.length>50)throw new HttpError(400,"每单需1至50条商品明细");
  return input.map(i=>{
    if(!i||typeof i!=="object")throw new HttpError(400,"商品明细无效");
    const kind=textField(i.kind,"商品类别"),priceCny=amount(i.priceCny,"谈成价格",true);
    if(!["material","finished","service"].includes(kind))throw new HttpError(400,"商品类别无效");
    const rawFee=(i as Record<string,unknown>).buyingFeeCny;
    const buyingFeeCny=rawFee!==undefined&&rawFee!==null&&String(rawFee).trim()!==""
      ? amount(rawFee,"代购费",false)
      : (dealChannel==="private"||kind!=="material" ? "0.00" : buyingFee(priceCny,kind));
    const sourcingNoSettle=kind!=="service"&&Boolean((i as Record<string,unknown>).sourcingNoSettle);
    return {kind,label:textField(i.label,"商品名称"),materialRef:textField(i.materialRef??"","料子编号",128,false),priceCny,buyingFeeCny,sourcingNoSettle};
  });
}
