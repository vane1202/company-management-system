import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { Pool, PoolClient } from "pg";
import type { AppConfig } from "../config.js";
import { HttpError } from "../types.js";
import { writeAudit } from "../audit.js";
import { amount, dateField, hashPayload, textField, uuid } from "../lib/commerce.js";
import { centsToMoney, moneyToCents } from "../lib/money.js";
import { businessToday } from "../lib/dates.js";

const queueActions = new Set(["price", "manual", "pack", "recall", "resubmitBatch", "batchReview", "markPaid"]);

type ItemRow = {
  itemId: string; orderId: string; label: string; materialRef: string; kind: string;
  sourcingNoSettle: boolean; orderRef: string; customerLabel: string; businessDate: string;
  status: string; referenceCny: string | null; operatorName: string; shippedOn: string | null;
  balance: string; cancelled: boolean;
};
type LineRow = {
  id: string; source: string; queueKind: string; orderId: string | null; itemId: string | null;
  label: string; materialRef: string; referenceCny: string | null; customerLabel: string;
  operatorName: string; triggerLabel: string; attachmentId: string | null; counterparty: string;
  amount: string; date: string; status: string; batchId: string | null; version: number;
  expenseId: string | null; owns_expense?: boolean; orderRef: string | null;
};
type BatchRow = {
  id: string; batchRef: string; counterparty: string; status: string; amount: string; date: string;
  version: number; reviewNote: string; paidOn: string | null; payee: string; payAccount: string;
  payReference: string; createdAt: string;
};

function day(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}
function moneyText(value: unknown): string | null {
  if (value == null || value === "") return null;
  const text = String(value);
  return text.includes(".") ? text : `${text}.00`;
}
function qualifies(row: ItemRow): "material" | "finished" | null {
  if (row.cancelled || row.status === "refunded") return null;
  if (row.kind === "material" && !row.sourcingNoSettle && moneyToCents(moneyText(row.balance) || "0.00") <= 0n) return "material";
  if (row.kind === "finished" && row.shippedOn) return "finished";
  return null;
}
function triggerLabel(kind: "material" | "finished", shippedOn: string | null) {
  return kind === "material" ? "已付全款 · 非PH 自动推入" : `已发货 ${shippedOn} 自动推入`;
}
function offsetNote(line: LineRow, row: ItemRow | undefined): string {
  if (line.status !== "batched" || line.queueKind === "other" || !row) return "";
  const cancelled = row.cancelled || row.status === "refunded";
  if (line.queueKind === "material") {
    if (cancelled) return "订单已跑单或退款，请冲抵";
    if (row.sourcingNoSettle) return "已补标接待（PH），请冲抵";
    if (moneyToCents(moneyText(row.balance) || "0.00") > 0n) return "尾款未结清，请冲抵";
  }
  if (line.queueKind === "finished") {
    if (cancelled) return "订单已作废，请冲抵";
    if (!row.shippedOn) return "发货日期已取消，请冲抵";
  }
  return "";
}

async function replay(client: PoolClient, req: Request, entityId?: string) {
  const body = req.body ?? {};
  const requestKey = uuid(body.requestKey);
  const payloadHash = hashPayload(body);
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["warehouse-queue:" + requestKey]);
  const previous = (await client.query("SELECT * FROM warehouse_queue_actions WHERE request_key=$1", [requestKey])).rows[0];
  if (previous) {
    if (previous.actor_id !== req.actor!.id || previous.payload_hash !== payloadHash) throw new HttpError(409, "提交标识已用于其他内容，请重新提交");
    return { requestKey, payloadHash, done: true as const };
  }
  return { requestKey, payloadHash, done: false as const, entityId };
}

async function remember(client: PoolClient, req: Request, requestKey: string, payloadHash: string, entityId: string | null) {
  await client.query("INSERT INTO warehouse_queue_actions(request_key,actor_id,payload_hash,entity_id) VALUES($1,$2,$3,$4)", [requestKey, req.actor!.id, payloadHash, entityId]);
  await writeAudit(client, { actorId: req.actor!.id, action: "warehouse_" + String(req.body?.action ?? ""), entityType: "warehouse_batch", entityId, before: null, after: req.body, ip: req.ip });
}

export async function loadWarehouseFlow(client: PoolClient, finance: boolean) {
  const items = (await client.query(`SELECT i.id AS "itemId", i.order_id AS "orderId", i.label, i.material_ref AS "materialRef",
    i.kind, COALESCE(i.sourcing_no_settle,FALSE) AS "sourcingNoSettle", o.order_ref AS "orderRef",
    o.customer_label AS "customerLabel", o.business_date AS "businessDate", o.status,
    o.material_cost_cny::text AS "referenceCny", d.operator_name AS "operatorName", d.shipped_on AS "shippedOn",
    (d.customer_due + COALESCE((SELECT sum(c.customer_amount) FROM order_charges c WHERE c.order_id=o.id AND c.voided_at IS NULL),0)
      - COALESCE((SELECT sum(p.credit_amount) FROM customer_payments p WHERE p.order_id=o.id AND p.voided_at IS NULL AND p.verify_status <> 'rejected'),0))::numeric(14,2)::text AS balance,
    EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL) AS cancelled
    FROM order_items i JOIN orders o ON o.id=i.order_id JOIN order_details d ON d.order_id=o.id
    WHERE i.kind IN ('material','finished')`)).rows.map((row) => ({ ...row, shippedOn: day(row.shippedOn), businessDate: day(row.businessDate), referenceCny: moneyText(row.referenceCny), balance: moneyText(row.balance) || "0.00" })) as ItemRow[];
  const photos = (await client.query(`SELECT DISTINCT ON (order_id, COALESCE(item_id::text,'')) id, order_id AS "orderId", item_id AS "itemId"
    FROM order_attachments WHERE kind='card' ORDER BY order_id, COALESCE(item_id::text,''), created_at DESC`)).rows as { id: string; orderId: string; itemId: string | null }[];
  const proofs = (await client.query(`SELECT id, order_id AS "orderId" FROM order_attachments WHERE kind='shipping_proof' ORDER BY created_at, id`)).rows as { id: string; orderId: string }[];
  const proofsFor = (orderId: string | null) => proofs.filter(photo => photo.orderId === orderId).map(photo => ({ id: photo.id }));
  const photoFor = (orderId: string, itemId: string) => photos.find((photo) => photo.orderId === orderId && photo.itemId === itemId)?.id
    ?? photos.find((photo) => photo.orderId === orderId && !photo.itemId)?.id ?? null;
  const blocks = (await client.query(`SELECT order_id AS "orderId", material_ref AS "materialRef", category FROM warehouse_bills WHERE status<>'rejected'`)).rows as { orderId: string; materialRef: string; category: string }[];
  const lines = (await client.query(`SELECT l.id,l.source,l.queue_kind AS "queueKind",l.order_id AS "orderId",l.item_id AS "itemId",
    l.label,l.material_ref AS "materialRef",l.reference_cny::text AS "referenceCny",l.customer_label AS "customerLabel",
    l.operator_name AS "operatorName",l.trigger_label AS "triggerLabel",l.attachment_id AS "attachmentId",l.counterparty,
    l.amount_cny::text AS amount,l.business_date AS date,l.status,l.batch_id AS "batchId",l.version,l.expense_id AS "expenseId",
    o.order_ref AS "orderRef" FROM warehouse_lines l LEFT JOIN orders o ON o.id=l.order_id ORDER BY l.created_at,l.id`)).rows.map((row) => ({ ...row, date: day(row.date), referenceCny: moneyText(row.referenceCny), amount: moneyText(row.amount) })) as LineRow[];
  const batches = (await client.query(`SELECT id,batch_ref AS "batchRef",counterparty,status,amount_cny::text AS amount,business_date AS date,
    version,review_note AS "reviewNote",paid_on AS "paidOn",payee,pay_account AS "payAccount",
    CASE WHEN $1 THEN pay_reference ELSE '' END AS "payReference",created_at AS "createdAt"
    FROM warehouse_batches WHERE status<>'withdrawn' ORDER BY created_at,id`, [finance])).rows.map((row) => ({ ...row, date: day(row.date), paidOn: day(row.paidOn), amount: moneyText(row.amount) })) as BatchRow[];
  const batchOf = new Map(batches.map((batch) => [batch.id, batch]));
  const itemOf = new Map(items.map((item) => [item.itemId, item]));
  const held = new Set<string>();
  for (const line of lines) {
    if (!line.itemId) continue;
    const row = itemOf.get(line.itemId);
    const batch = line.batchId ? batchOf.get(line.batchId) : undefined;
    const livePriced = line.status === "priced" && !!row && qualifies(row) !== null;
    const liveBatch = line.status === "batched" && !!batch;
    if (livePriced || liveBatch) held.add(line.itemId);
  }
  const queue = items.flatMap((row) => {
    const kind = qualifies(row);
    if (!kind || held.has(row.itemId)) return [];
    if (blocks.some((bill) => bill.orderId === row.orderId && bill.materialRef === row.materialRef && (bill.category === "goods" || bill.category === "sourcing"))) return [];
    return [{
      key: row.itemId, orderId: row.orderId, itemId: row.itemId, queueKind: kind, label: row.label, materialRef: row.materialRef,
      referenceCny: row.referenceCny, customerLabel: row.customerLabel, operatorName: row.operatorName, orderRef: row.orderRef,
      triggerLabel: triggerLabel(kind, row.shippedOn), attachmentId: photoFor(row.orderId, row.itemId), shippingProofs: kind === "finished" ? proofsFor(row.orderId) : [], businessDate: row.businessDate
    }];
  });
  const visible = lines.flatMap((line) => {
    const batch = line.batchId ? batchOf.get(line.batchId) : undefined;
    if (line.status === "batched" && !batch) return [];
    if (line.status === "priced") {
      if (line.queueKind === "other") return [{ ...line, offsetNote: "" }];
      const row = line.itemId ? itemOf.get(line.itemId) : undefined;
      if (!row || !qualifies(row)) return [];
    }
    return [{ ...line, offsetNote: offsetNote(line, line.itemId ? itemOf.get(line.itemId) : undefined), shippingProofs: line.queueKind === "finished" ? proofsFor(line.orderId) : [] }];
  });
  return { queue, lines: visible, batches: batches.map((batch) => ({ ...batch, lineIds: visible.filter((line) => line.batchId === batch.id).map((line) => line.id) })) };
}

async function lockItem(client: PoolClient, itemId: string) {
  const found = (await client.query("SELECT order_id FROM order_items WHERE id=$1", [itemId])).rows[0];
  if (!found) throw new HttpError(404, "商品不在可推送范围");
  await client.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [found.order_id]);
  const row = (await client.query(`SELECT i.id AS "itemId", i.order_id AS "orderId", i.label, i.material_ref AS "materialRef", i.kind,
    COALESCE(i.sourcing_no_settle,FALSE) AS "sourcingNoSettle", o.order_ref AS "orderRef", o.customer_label AS "customerLabel",
    o.business_date AS "businessDate", o.status, o.material_cost_cny::text AS "referenceCny", d.operator_name AS "operatorName",
    d.shipped_on AS "shippedOn",
    (d.customer_due + COALESCE((SELECT sum(c.customer_amount) FROM order_charges c WHERE c.order_id=o.id AND c.voided_at IS NULL),0)
      - COALESCE((SELECT sum(p.credit_amount) FROM customer_payments p WHERE p.order_id=o.id AND p.voided_at IS NULL AND p.verify_status <> 'rejected'),0))::numeric(14,2)::text AS balance,
    EXISTS(SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL) AS cancelled
    FROM order_items i JOIN orders o ON o.id=i.order_id JOIN order_details d ON d.order_id=o.id WHERE i.id=$1`, [itemId])).rows[0];
  if (!row) throw new HttpError(404, "商品不在可推送范围");
  const item = { ...row, shippedOn: day(row.shippedOn), businessDate: day(row.businessDate), referenceCny: moneyText(row.referenceCny), balance: moneyText(row.balance) || "0.00" } as ItemRow;
  const kind = qualifies(item);
  if (!kind) throw new HttpError(409, "这笔货目前不满足自动推送条件");
  return { item, kind };
}

async function syncCosts(client: PoolClient, orderId: string) {
  await client.query(`UPDATE orders SET
    custom_product_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category IN ('goods','sourcing','accessory','certificate','box','other')),
    labor_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category IN ('labor','design')),
    shipping_cost=(SELECT COALESCE(sum(amount_cny),0) FROM order_expenses WHERE order_id=$1 AND voided_at IS NULL AND category='shipping') WHERE id=$1`, [orderId]);
  await client.query("UPDATE order_details SET version=version+1 WHERE order_id=$1", [orderId]);
}

export function isWarehouseQueueAction(action: string) { return queueActions.has(action); }

export async function mutateWarehouseQueue(client: PoolClient, req: Request, config: AppConfig) {
  const body = req.body ?? {};
  const action = String(body.action ?? "");
  const warehouseOnly = ["price", "manual", "pack", "recall", "resubmitBatch"].includes(action);
  if ((warehouseOnly && req.actor!.role !== "warehouse") || (!warehouseOnly && req.actor!.role !== "finance")) throw new HttpError(403, "库房核价打包，财务审核并标记打款");
  const ticket = await replay(client, req);
  if (ticket.done) return;
  const today = businessToday(new Date(), config.businessTimezone);
  if (action === "price") {
    const { item, kind } = await lockItem(client, uuid(body.itemId));
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["warehouse-item:" + item.itemId]);
    const open = (await client.query("SELECT id,status,batch_id FROM warehouse_lines WHERE item_id=$1 AND status IN ('priced','batched') FOR UPDATE", [item.itemId])).rows[0];
    if (open?.status === "batched") throw new HttpError(409, "这笔货已在结算单中");
    const blocked = (await client.query("SELECT 1 FROM warehouse_bills WHERE order_id=$1 AND material_ref=$2 AND status<>'rejected' AND category IN ('goods','sourcing')", [item.orderId, item.materialRef])).rowCount;
    if (blocked) throw new HttpError(409, "同一料号已有未退回的库房结账单");
    const photo = (await client.query("SELECT id FROM order_attachments WHERE order_id=$1 AND kind='card' AND (item_id=$2 OR item_id IS NULL) ORDER BY (item_id=$2) DESC, created_at DESC LIMIT 1", [item.orderId, item.itemId])).rows[0];
    const next = {
      counterparty: textField(body.counterparty, "结算供应商"), amount: amount(body.amount, "核定结算价", true),
      date: dateField(body.date, config.businessTimezone), trigger: triggerLabel(kind, item.shippedOn)
    };
    if (next.date < item.businessDate) throw new HttpError(400, "费用日期不能早于开单日期");
    const id = open?.id ?? randomUUID();
    if (open) {
      await client.query(`UPDATE warehouse_lines SET counterparty=$2,amount_cny=$3,business_date=$4,reference_cny=$5,trigger_label=$6,
        attachment_id=$7,customer_label=$8,operator_name=$9,label=$10,material_ref=$11,version=version+1,updated_at=now() WHERE id=$1`,
        [id, next.counterparty, next.amount, next.date, item.referenceCny, next.trigger, photo?.id ?? null, item.customerLabel, item.operatorName, item.label, item.materialRef]);
    } else {
      await client.query(`INSERT INTO warehouse_lines(id,source,queue_kind,order_id,item_id,label,material_ref,reference_cny,customer_label,
        operator_name,trigger_label,attachment_id,counterparty,amount_cny,business_date,status,created_by,request_key)
        VALUES($1,'auto',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'priced',$15,$16)`,
        [id, kind, item.orderId, item.itemId, item.label, item.materialRef, item.referenceCny, item.customerLabel, item.operatorName, next.trigger, photo?.id ?? null, next.counterparty, next.amount, next.date, req.actor!.id, ticket.requestKey]);
    }
    await remember(client, req, ticket.requestKey, ticket.payloadHash, id);
    return;
  }
  if (action === "manual") {
    const id = randomUUID();
    const next = { label: textField(body.label, "费用名称"), counterparty: textField(body.counterparty, "供应商／收款方"), amount: amount(body.amount, "结算金额", true), date: dateField(body.date, config.businessTimezone) };
    await client.query(`INSERT INTO warehouse_lines(id,source,queue_kind,label,counterparty,amount_cny,business_date,status,trigger_label,created_by,request_key)
      VALUES($1,'manual','other',$2,$3,$4,$5,'priced','手动补录',$6,$7)`, [id, next.label, next.counterparty, next.amount, next.date, req.actor!.id, ticket.requestKey]);
    await remember(client, req, ticket.requestKey, ticket.payloadHash, id);
    return;
  }
  if (action === "pack") {
    const ids = Array.isArray(body.lineIds) ? body.lineIds.map((id: unknown) => uuid(id)) : [];
    if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new HttpError(400, "请选择要合并的账目");
    const rows = (await client.query("SELECT * FROM warehouse_lines WHERE id = ANY($1::uuid[]) FOR UPDATE", [ids])).rows;
    if (rows.length !== ids.length || rows.some((row) => row.status !== "priced" || row.batch_id)) throw new HttpError(409, "只能合并尚未提交的待结账目");
    const supplier = rows[0].counterparty;
    if (rows.some((row) => row.counterparty !== supplier)) throw new HttpError(400, "请按同一供应商分别打包");
    for (const row of rows) if (row.item_id) await lockItem(client, row.item_id);
    const total = centsToMoney(rows.reduce((sum, row) => sum + moneyToCents(String(row.amount_cny)), 0n));
    const batchId = randomUUID();
    const batchRef = "WH-" + today.replaceAll("-", "") + "-" + randomUUID().slice(0, 4).toUpperCase();
    await client.query(`INSERT INTO warehouse_batches(id,batch_ref,counterparty,status,business_date,amount_cny,created_by)
      VALUES($1,$2,$3,'submitted',$4,$5,$6)`, [batchId, batchRef, supplier, today, total, req.actor!.id]);
    await client.query("UPDATE warehouse_lines SET status='batched', batch_id=$2, version=version+1, updated_at=now() WHERE id = ANY($1::uuid[])", [ids, batchId]);
    await remember(client, req, ticket.requestKey, ticket.payloadHash, batchId);
    return;
  }
  const batchId = uuid(body.id);
  const batch = (await client.query("SELECT * FROM warehouse_batches WHERE id=$1 FOR UPDATE", [batchId])).rows[0];
  if (!batch || batch.status === "withdrawn") throw new HttpError(404, "结算单不存在");
  if (!Number.isInteger(body.version) || batch.version !== body.version) throw new HttpError(409, "结算单已更新，请刷新后重试");
  const batchLines = (await client.query("SELECT * FROM warehouse_lines WHERE batch_id=$1 FOR UPDATE", [batchId])).rows;
  if (action === "recall") {
    if (batch.status !== "submitted") throw new HttpError(409, "仅待财务审核的结算单可撤回");
    await client.query("UPDATE warehouse_lines SET status='priced', batch_id=NULL, version=version+1, updated_at=now() WHERE batch_id=$1", [batchId]);
    await client.query("UPDATE warehouse_batches SET status='withdrawn', version=version+1, updated_at=now() WHERE id=$1", [batchId]);
  } else if (action === "resubmitBatch") {
    if (batch.status !== "rejected" || batch.created_by !== req.actor!.id) throw new HttpError(403, "仅原登记人可修改并重提已退回的结算单");
    const supplier = textField(body.counterparty, "结算供应商");
    const edits = Array.isArray(body.lines) ? body.lines : [];
    if (edits.length !== batchLines.length) throw new HttpError(400, "请保持结算明细完整");
    let total = 0n;
    for (const edit of edits) {
      const line = batchLines.find((row) => row.id === uuid(edit.id));
      if (!line) throw new HttpError(400, "结算明细不存在");
      const value = amount(edit.amount, "核定结算价", true);
      total += moneyToCents(value);
      await client.query("UPDATE warehouse_lines SET amount_cny=$2, counterparty=$3, version=version+1, updated_at=now() WHERE id=$1", [line.id, value, supplier]);
    }
    await client.query(`UPDATE warehouse_batches SET counterparty=$2, amount_cny=$3, status='submitted', review_note='', reviewed_by=NULL, reviewed_at=NULL,
      version=version+1, updated_at=now() WHERE id=$1`, [batchId, supplier, centsToMoney(total)]);
  } else if (action === "batchReview") {
    if (batch.status !== "submitted") throw new HttpError(409, "仅待审核结算单可审核");
    if (!["approved", "rejected"].includes(body.decision)) throw new HttpError(400, "审核结果无效");
    const reason = textField(body.reason, "审核说明", 500);
    if (body.decision === "approved") {
      for (const line of batchLines) {
        if (!line.order_id) continue;
        await client.query("SELECT id FROM orders WHERE id=$1 FOR UPDATE", [line.order_id]);
        const expenseId = randomUUID();
        const category = line.queue_kind === "material" ? "goods" : line.queue_kind === "finished" ? "sourcing" : "other";
        await client.query(`INSERT INTO order_expenses(id,order_id,business_date,category,label,amount_cny,created_by,request_key,payload_hash,
          counterparty,note,payment_tracking_started) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE)`,
          [expenseId, line.order_id, line.business_date, category, line.label, line.amount_cny, req.actor!.id, randomUUID(), hashPayload(line), line.counterparty, `库房结算 ${batch.batch_ref}；料号：${line.material_ref || "无"}；${line.trigger_label}`]);
        await client.query("UPDATE warehouse_lines SET expense_id=$2, owns_expense=TRUE, updated_at=now() WHERE id=$1", [line.id, expenseId]);
        await syncCosts(client, line.order_id);
      }
    }
    await client.query("UPDATE warehouse_batches SET status=$2, review_note=$3, reviewed_by=$4, reviewed_at=now(), version=version+1, updated_at=now() WHERE id=$1", [batchId, body.decision, reason, req.actor!.id]);
  } else if (action === "markPaid") {
    if (batch.status !== "approved") throw new HttpError(409, "仅审核通过的结算单可标记打款");
    const paidOn = dateField(body.date, config.businessTimezone);
    const payee = textField(body.payee, "实际收款方");
    const account = textField(body.account, "公司付款账户");
    const reference = textField(body.reference, "付款流水号");
    if (batchLines.some((line) => paidOn < day(line.business_date)!)) throw new HttpError(400, "付款日期不能早于费用日期");
    for (const [index, line] of batchLines.entries()) {
      if (!line.expense_id) continue;
      const paid = (await client.query("SELECT COALESCE(sum(amount_cny),0)::text AS total FROM supplier_payments WHERE expense_id=$1 AND voided_at IS NULL", [line.expense_id])).rows[0].total;
      if (moneyToCents(paid) !== 0n) throw new HttpError(409, "关联成本已有付款，请先在付款台账核对");
      const lineReference = batchLines.filter((row) => row.expense_id).length > 1 ? `${reference}-${index + 1}` : reference;
      await client.query(`INSERT INTO supplier_payments(expense_id,paid_on,payee,account,reference,amount_cny,note,created_by,request_key,payload_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [line.expense_id, paidOn, payee, account, lineReference, line.amount_cny, "库房供应商结算打款 " + batch.batch_ref, req.actor!.id, randomUUID(), hashPayload({ batchId, lineId: line.id })]);
    }
    await client.query(`UPDATE warehouse_batches SET status='paid', paid_on=$2, payee=$3, pay_account=$4, pay_reference=$5, version=version+1, updated_at=now() WHERE id=$1`, [batchId, paidOn, payee, account, reference]);
  } else throw new HttpError(400, "结账操作无效");
  await remember(client, req, ticket.requestKey, ticket.payloadHash, batchId);
}

export async function warehouseAttachmentVisible(db: Pool | PoolClient, orderId: string) {
  const line = await db.query("SELECT 1 FROM warehouse_lines WHERE order_id=$1 LIMIT 1", [orderId]);
  if (line.rowCount) return true;
  const queue = await db.query(`SELECT 1 FROM order_items i JOIN orders o ON o.id=i.order_id JOIN order_details d ON d.order_id=o.id
    WHERE o.id=$1 AND i.kind IN ('material','finished') AND o.status<>'refunded'
      AND NOT EXISTS (SELECT 1 FROM order_cancellations x WHERE x.order_id=o.id AND x.voided_at IS NULL)
      AND ((i.kind='material' AND NOT COALESCE(i.sourcing_no_settle,FALSE) AND d.customer_due + COALESCE((SELECT sum(c.customer_amount) FROM order_charges c WHERE c.order_id=o.id AND c.voided_at IS NULL),0) - COALESCE((SELECT sum(p.credit_amount) FROM customer_payments p WHERE p.order_id=o.id AND p.voided_at IS NULL AND p.verify_status <> 'rejected'),0) <= 0)
        OR (i.kind='finished' AND d.shipped_on IS NOT NULL)) LIMIT 1`, [orderId]);
  return !!queue.rowCount;
}
