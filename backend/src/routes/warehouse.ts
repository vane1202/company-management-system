import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import type { Pool, PoolClient } from "pg";
import { withTransaction } from "../db.js";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { amount, dateField, hashPayload, textField, uuid } from "../lib/commerce.js";
import { centsToMoney, moneyToCents } from "../lib/money.js";
import { writeAudit } from "../audit.js";

const kinds: Record<string, string> = { goods: "原石出库", sourcing: "售后接待", labor: "加工雕刻", design: "设计", accessory: "配件", certificate: "证书", box: "包装", shipping: "运费", other: "其他对外结账" };
type Bill = {
  id: string; order_id: string; expense_id: string | null; owns_expense?: boolean; after_sale_charge_id: string | null;
  category: string; label: string; counterparty: string; amount_cny: string; business_date: string;
  material_ref: string; proof: string; note: string; status: string; version: number; created_by: string;
};

async function snapshot(client: PoolClient, finance: boolean) {
  const bills = (await client.query(`SELECT b.id,b.order_id AS "orderId",b.expense_id AS "expenseId",
    b.after_sale_charge_id AS "afterSaleChargeId",b.category,b.label,b.counterparty,b.amount_cny AS amount,
    b.business_date AS date,b.material_ref AS "materialRef",b.proof,b.note,b.status,b.version,
    b.created_by AS "createdById",u.display_name AS "createdBy",b.created_at AS "createdAt",
    b.review_note AS "reviewNote",r.display_name AS "reviewedBy"
    FROM warehouse_bills b JOIN users u ON u.id=b.created_by LEFT JOIN users r ON r.id=b.reviewed_by
    ORDER BY b.created_at,b.id`)).rows;
  const payments = (await client.query(`SELECT id,warehouse_bill_id AS "billId",amount_cny AS amount,
    paid_on AS date,payee,CASE WHEN $1 THEN account ELSE '' END AS account,
    CASE WHEN $1 THEN reference ELSE '' END AS reference
    FROM supplier_payments WHERE warehouse_bill_id IS NOT NULL AND voided_at IS NULL ORDER BY created_at,id`, [finance])).rows;
  const expenses = (await client.query(`SELECT e.id,e.order_id,e.category,e.label,e.amount_cny,e.counterparty,
    e.business_date,e.after_sale_charge_id,e.voided_at,i.material_ref,
    CASE WHEN e.payment_tracking_started THEN (e.amount_cny-COALESCE((SELECT sum(p.amount_cny)
      FROM supplier_payments p WHERE p.expense_id=e.id AND p.voided_at IS NULL),0))::numeric(14,2) ELSE NULL END AS pending_cny
    FROM order_expenses e LEFT JOIN order_items i ON i.id=e.item_id WHERE e.voided_at IS NULL`)).rows;
  const orders = (await client.query(`SELECT o.id,o.order_ref AS "orderRef",o.customer_label AS "customerLabel",
    d.live_room_code AS "liveRoomCode",d.host_name AS "hostName",d.operator_name AS "operatorName",
    d.persona_name AS "personaName",d.customer_code AS "customerCode",
    o.status<>'refunded' AND NOT EXISTS(SELECT 1 FROM order_cancellations c WHERE c.order_id=o.id AND c.voided_at IS NULL) AS "canCreate"
    FROM orders o JOIN order_details d ON d.order_id=o.id ORDER BY o.business_date DESC,o.created_at DESC`)).rows;
  const charges = (await client.query(`SELECT id,order_id AS "orderId",label FROM order_charges WHERE voided_at IS NULL ORDER BY created_at`)).rows;
  return { state: { bills, payments }, expenses, orders, charges, kinds };
}

async function lockOrder(client: PoolClient, orderId: string, requireActive = true) {
  const order = (await client.query("SELECT id,status,business_date FROM orders WHERE id=$1 FOR UPDATE", [orderId])).rows[0];
  if (!order || !(await client.query("SELECT 1 FROM order_details WHERE order_id=$1", [orderId])).rowCount) throw new HttpError(404, "订单不存在或资料不完整");
  if (requireActive && (order.status === "refunded" || (await client.query("SELECT 1 FROM order_cancellations WHERE order_id=$1 AND voided_at IS NULL", [orderId])).rowCount)) throw new HttpError(409, "跑单或退款订单不能新增、批准结账单");
  return order;
}

async function expenseBalance(client: PoolClient, expenseId: string) {
  const expense = (await client.query("SELECT * FROM order_expenses WHERE id=$1 FOR UPDATE", [expenseId])).rows[0];
  if (!expense || expense.voided_at) throw new HttpError(409, "关联费用不存在或已作废");
  if (!expense.payment_tracking_started) throw new HttpError(409, "历史成本付款状态待核对，请财务先确认付款台账");
  const paid = (await client.query("SELECT COALESCE(sum(amount_cny),0)::text AS total FROM supplier_payments WHERE expense_id=$1 AND voided_at IS NULL", [expenseId])).rows[0].total;
  return { expense, remaining: moneyToCents(expense.amount_cny) - moneyToCents(paid) };
}

async function validateLink(client: PoolClient, bill: Pick<Bill, "id" | "order_id" | "expense_id" | "category" | "amount_cny" | "business_date" | "after_sale_charge_id">) {
  if (bill.after_sale_charge_id && !(await client.query("SELECT 1 FROM order_charges WHERE id=$1 AND order_id=$2 AND voided_at IS NULL", [bill.after_sale_charge_id, bill.order_id])).rowCount) throw new HttpError(400, "售后收费不属于此订单或已作废");
  if (!bill.expense_id) return;
  const { expense, remaining } = await expenseBalance(client, bill.expense_id);
  if (expense.order_id !== bill.order_id || expense.category !== bill.category || expense.business_date !== bill.business_date || (expense.after_sale_charge_id ?? null) !== bill.after_sale_charge_id) throw new HttpError(400, "关联成本的订单、类别、日期和售后项目须一致");
  if (moneyToCents(bill.amount_cny) > remaining) throw new HttpError(409, "结账金额超过关联成本的剩余应付");
  if ((await client.query("SELECT 1 FROM warehouse_bills WHERE expense_id=$1 AND id<>$2 AND status<>'rejected'", [bill.expense_id, bill.id])).rowCount) throw new HttpError(409, "该项成本已有待审核或已审核结账单，请查看原账单");
  if (moneyToCents(bill.amount_cny) < remaining) {
    throw new HttpError(409, `关联成本的结账金额须等于剩余应付 ${centsToMoney(remaining)} 元，财务可在审核后分次付款`);
  }
}

async function syncCosts(client: PoolClient, orderId: string) {
  await client.query(`UPDATE orders SET
    custom_product_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category IN ('goods','sourcing','accessory','certificate','box','other')),
    labor_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category IN ('labor','design')),
    shipping_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category='shipping') WHERE id=$1`, [orderId]);
  await client.query("UPDATE order_details SET version=version+1 WHERE order_id=$1", [orderId]);
}

async function mutate(client: PoolClient, req: Request, config: AppConfig) {
  const body = req.body ?? {};
  const action = String(body.action ?? "");
  if (!["create", "resubmit", "review", "pay", "withdraw"].includes(action)) throw new HttpError(400, "结账操作无效");
  if ((["create", "resubmit"].includes(action) && req.actor!.role !== "warehouse") || (["review", "pay", "withdraw"].includes(action) && req.actor!.role !== "finance")) throw new HttpError(403, "库房登记账单，财务审核并登记实际付款");
  const requestKey = uuid(body.requestKey), payloadHash = hashPayload(body);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["warehouse:" + requestKey]);
  const previous = (await client.query("SELECT * FROM warehouse_actions WHERE request_key=$1", [requestKey])).rows[0];
  if (previous) {
    if (previous.actor_id !== req.actor!.id || previous.payload_hash !== payloadHash) throw new HttpError(409, "提交标识已用于其他内容，请重新提交");
    return;
  }
  let bill: Bill | undefined;
  if (action !== "create") {
    const billId = uuid(body.id);
    const link = (await client.query("SELECT order_id FROM warehouse_bills WHERE id=$1", [billId])).rows[0];
    if (!link) throw new HttpError(404, "结账单不存在");
    await lockOrder(client, link.order_id, action === "resubmit" || (action === "review" && body.decision !== "rejected"));
    bill = (await client.query("SELECT * FROM warehouse_bills WHERE id=$1 FOR UPDATE", [billId])).rows[0];
    if (!Number.isInteger(body.version) || bill!.version !== body.version) throw new HttpError(409, "结账单已更新，请刷新后重试");
  }
  const before = bill ? { ...bill } : undefined;
  if (action === "create" || action === "resubmit") {
    const orderId = uuid(body.orderId);
    const order = await lockOrder(client, action === "create" ? orderId : bill!.order_id);
    if (action === "resubmit" && (bill!.status !== "rejected" || bill!.created_by !== req.actor!.id || bill!.order_id !== orderId)) throw new HttpError(403, "仅登记人可修改并重提交自己的已退回账单，不能更换订单");
    const category = textField(body.category, "结账类别");
    if (!Object.hasOwn(kinds, category)) throw new HttpError(400, "结账类别无效");
    const next = {
      id: bill?.id ?? randomUUID(), order_id: orderId, expense_id: body.expenseId ? uuid(body.expenseId) : null,
      after_sale_charge_id: body.afterSaleChargeId ? uuid(body.afterSaleChargeId) : null,
      category, label: textField(body.label, "结账项目"), counterparty: textField(body.counterparty, "供货／服务方"),
      amount_cny: amount(body.amount, "待结账金额", true), business_date: dateField(body.date, config.businessTimezone),
      material_ref: textField(body.materialRef, "商品编号／料号"), proof: textField(body.proof, "凭证编号"), note: textField(body.note ?? "", "备注", 1000, false)
    };
    if (next.business_date < order.business_date) throw new HttpError(400, "费用日期不能早于开单日期");
    await validateLink(client, next);
    if (bill) {
      await client.query(`UPDATE warehouse_bills SET expense_id=$2,after_sale_charge_id=$3,category=$4,label=$5,counterparty=$6,
        amount_cny=$7,business_date=$8,material_ref=$9,proof=$10,note=$11,status='submitted',reviewed_by=NULL,
        reviewed_at=NULL,review_note='',version=version+1,updated_at=now() WHERE id=$1`,
        [next.id, next.expense_id, next.after_sale_charge_id, next.category, next.label, next.counterparty, next.amount_cny, next.business_date, next.material_ref, next.proof, next.note]);
    } else {
      await client.query(`INSERT INTO warehouse_bills(id,order_id,expense_id,after_sale_charge_id,category,label,counterparty,
        amount_cny,business_date,material_ref,proof,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [...Object.values(next), req.actor!.id]);
    }
    bill = { ...next, status: "submitted", version: (bill?.version ?? 0) + 1, created_by: req.actor!.id };
  } else if (action === "review") {
    if (bill!.status !== "submitted") throw new HttpError(409, "仅待审核账单可审核");
    if (!["approved", "rejected"].includes(body.decision)) throw new HttpError(400, "审核结果无效");
    const reason = textField(body.reason, "审核说明", 500);
    if (body.decision === "approved") {
      await validateLink(client, bill!);
      if (!bill!.expense_id) {
        const expenseId = randomUUID();
        await client.query(`INSERT INTO order_expenses(id,order_id,business_date,category,label,amount_cny,created_by,request_key,payload_hash,
          counterparty,note,payment_tracking_started,after_sale_charge_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)`,
          [expenseId, bill!.order_id, bill!.business_date, bill!.category, bill!.label, bill!.amount_cny, req.actor!.id, randomUUID(), hashPayload(bill), bill!.counterparty, `${bill!.note}\n料号：${bill!.material_ref}；凭证：${bill!.proof}`, bill!.after_sale_charge_id]);
        bill!.expense_id = expenseId;
        bill!.owns_expense = true;
        if (bill!.after_sale_charge_id) await client.query("UPDATE order_charges SET costs_completed_at=NULL WHERE id=$1", [bill!.after_sale_charge_id]);
        await syncCosts(client, bill!.order_id);
      }
    }
    await client.query("UPDATE warehouse_bills SET expense_id=$2,status=$3,review_note=$4,reviewed_by=$5,owns_expense=$6,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1", [bill!.id, bill!.expense_id, body.decision, reason, req.actor!.id, bill!.owns_expense ?? false]);
  } else if (action === "withdraw") {
    if (bill!.status !== "approved" || !bill!.expense_id) throw new HttpError(409, "仅已审核账单可撤回审核");
    const reason = textField(body.reason, "撤回说明", 500);
    const { expense } = await expenseBalance(client, bill!.expense_id);
    if ((await client.query("SELECT 1 FROM supplier_payments WHERE warehouse_bill_id=$1 AND voided_at IS NULL", [bill!.id])).rowCount) throw new HttpError(409, "已有实际付款，请财务先在付款台账作废关联付款，再撤回审核");
    if (bill!.owns_expense) {
      await client.query("UPDATE order_expenses SET voided_at=now(),void_reason=$2 WHERE id=$1", [expense.id, reason]);
      if (bill!.after_sale_charge_id) await client.query("UPDATE order_charges SET costs_completed_at=NULL WHERE id=$1", [bill!.after_sale_charge_id]);
      await syncCosts(client, bill!.order_id);
      bill!.expense_id = null;
    }
    await client.query("UPDATE warehouse_bills SET expense_id=$2,owns_expense=FALSE,status='rejected',review_note=$3,reviewed_by=$4,reviewed_at=now(),version=version+1,updated_at=now() WHERE id=$1", [bill!.id, bill!.expense_id, reason, req.actor!.id]);
  } else {
    if (bill!.status !== "approved" || !bill!.expense_id) throw new HttpError(409, "仅审核通过的账单可付款");
    const { remaining } = await expenseBalance(client, bill!.expense_id);
    const paid = (await client.query("SELECT COALESCE(sum(amount_cny),0)::text AS total FROM supplier_payments WHERE warehouse_bill_id=$1 AND voided_at IS NULL", [bill!.id])).rows[0].total;
    const paymentAmount = amount(body.amount, "实际付款", true), paymentDate = dateField(body.date, config.businessTimezone);
    if (paymentDate < bill!.business_date) throw new HttpError(400, "付款日期不能早于费用日期");
    if (moneyToCents(paymentAmount) > remaining || moneyToCents(paymentAmount) + moneyToCents(paid) > moneyToCents(bill!.amount_cny)) throw new HttpError(409, "付款超过结账单或关联费用的剩余应付");
    await client.query(`INSERT INTO supplier_payments(expense_id,warehouse_bill_id,paid_on,payee,account,reference,amount_cny,
      note,created_by,request_key,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [bill!.expense_id, bill!.id, paymentDate, textField(body.payee, "实际收款方"), textField(body.account, "公司付款账户"), textField(body.reference, "付款流水号"), paymentAmount, "库房结账单付款", req.actor!.id, requestKey, payloadHash]);
    await client.query("UPDATE warehouse_bills SET version=version+1,updated_at=now() WHERE id=$1", [bill!.id]);
  }
  await client.query("INSERT INTO warehouse_actions(request_key,actor_id,payload_hash,bill_id) VALUES($1,$2,$3,$4)", [requestKey, req.actor!.id, payloadHash, bill!.id]);
  await writeAudit(client, { actorId: req.actor!.id, action: "warehouse_" + action, entityType: "warehouse_bill", entityId: bill!.id, before, after: { ...body }, ip: req.ip });
}

export function createWarehouseRouter(db: Pool, config: AppConfig) {
  const router = Router();
  router.use((req, _res, next) => ["warehouse", "finance"].includes(req.actor?.role ?? "") ? next() : next(new HttpError(403, "仅库房与财务可访问结账台账")));
  router.get("/", (req, res, next) => {
    void withTransaction(db, (client) => snapshot(client, req.actor!.role === "finance"), true)
      .then((data) => res.set("Cache-Control", "private, no-store").json(data))
      .catch(next);
  });
  router.post("/", async (req, res, next) => {
    try {
      await withTransaction(db, (client) => mutate(client, req, config));
      const data = await withTransaction(db, (client) => snapshot(client, req.actor!.role === "finance"), true);
      res.set("Cache-Control", "private, no-store").json(data);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
