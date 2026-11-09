import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { HttpError, type PublicUser } from "../types.js";
import { managedTeamIds } from "../users.js";
import { isIsoDate, businessToday } from "./dates.js";
import { parseMoney, centsToMoney, moneyToCents } from "./money.js";

export type DB = Pool | PoolClient;
export function textField(input: unknown, name: string, max = 128, required = true) {
  if (typeof input !== "string" || input.trim().length > max || (required && !input.trim())) throw new HttpError(400, `${name}无效`);
  return input.trim();
}
export function uuid(input: unknown) {
  const value=String(input ?? "");
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400,"记录标识无效");
  return value;
}
export function currency(input: unknown): "CNY" | "TWD" | "USD" {
  if(input!=="CNY"&&input!=="TWD"&&input!=="USD")throw new HttpError(400,"币种无效");
  return input;
}
export function amount(input: unknown, name="金额", positive=false) {
  const value=centsToMoney(moneyToCents(parseMoney(input,name)));
  if(positive&&moneyToCents(value)<=0n)throw new HttpError(400,`${name}须大于0`);
  return value;
}
export function dateField(input: unknown, timezone: string) {
  const value=String(input ?? "");
  if(!isIsoDate(value)||value>businessToday(new Date(),timezone))throw new HttpError(400,"日期无效或晚于今日");
  return value;
}
export function hashPayload(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function buyingFee(price: string, kind: string) {
  return kind==="material" ? centsToMoney((moneyToCents(price)+5n)/10n) : "0.00";
}
export async function visibleOrder(db: DB, actor: PublicUser, id: string, lock=false): Promise<Record<string, any>> {
  const scopes=actor.role==="cs_supervisor" ? await managedTeamIds(db,actor) : null;
  if(!["boss","cs","cs_supervisor"].includes(actor.role))throw new HttpError(403,"无订单档案权限");
  const result=await db.query(`SELECT o.*,u.wechat_id,u.display_name FROM orders o JOIN users u ON u.id=o.user_id
    WHERE o.id=$1 AND ($2='' OR o.user_id::text=$2)
    AND ($3::uuid[] IS NULL OR EXISTS(SELECT 1 FROM team_memberships m WHERE m.user_id=o.user_id AND m.team_id=ANY($3::uuid[]) AND m.start_date<=o.business_date AND (m.end_date IS NULL OR m.end_date>=o.business_date))) ${lock?"FOR UPDATE OF o":""}`,[uuid(id),actor.role==="cs"?actor.id:"",scopes]);
  if(!result.rows[0])throw new HttpError(404,"订单不存在或不在可见范围");
  return result.rows[0];
}
export async function writeOrder(db: DB, actor: PublicUser, id: string) {
  if(actor.role!=="cs")throw new HttpError(403,"仅归属客服可填报订单资料");
  const order=await visibleOrder(db,actor,id,true);
  const details=(await db.query("SELECT * FROM order_details WHERE order_id=$1",[id])).rows[0];
  if(!details)throw new HttpError(409,"旧订单未登记完整币种与明细，暂不新增收款或费用");
  return {order,details};
}
export async function replay(db: DB, table: string, key: string, hash: string, owner?: string) {
  if(!["order_details","customer_payments","order_expenses","finance_settlements"].includes(table))throw new Error("Invalid request table");
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[table+":"+key]);
  const row=(await db.query(`SELECT * FROM ${table} WHERE request_key=$1`,[uuid(key)])).rows[0];
  if(row && (row.payload_hash!==hash || (owner&&String(row.order_id)!==owner)))throw new HttpError(409,"提交标识已用于另一份内容，请刷新后重试");
  return row;
}
