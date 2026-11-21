import type { CsAccount, Currency, Order, OrderRecord } from "../api";
import { convertCustomerPayments, type CustomerPaymentRow } from "./adExchangeRates";

export type Source = { identity: Order; record: OrderRecord };
export type Selection = { from: string; to: string; operator: string; account: string; persona: string; room: string };
export const UNKNOWN = "待确认归属";
export function amount(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw Error("金额待核对");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export const money = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
export const operatorOf = (s: Source) => s.record.details?.operatorName.trim() || s.identity.operatorName?.trim() || UNKNOWN;
export function channelOf(s: Source): "live" | "private" {
  return s.record.details?.dealChannel === "private" || s.identity.dealChannel === "private" ? "private" : "live";
}
export const inRange = (date: string, from: string, to: string) => date >= from && date <= to;
export function shiftDay(date: string, n: number) {
  const clock = new Date(`${date}T00:00:00Z`); clock.setUTCDate(clock.getUTCDate() + n);
  return clock.toISOString().slice(0, 10);
}
export function matching(s: Source, f: Selection) {
  return (!f.operator || operatorOf(s) === f.operator) && (!f.account || s.identity.userId === f.account)
    && (!f.persona || (s.identity.personaCode || s.identity.personaName) === f.persona)
    && (!f.room || s.identity.liveRoomCode === f.room);
}
const activeOrder = (s: Source) => !s.record.order.cancelled && s.record.order.status !== "refunded";
export function booking(s: Source) {
  try {
    if (s.record.items?.length) return s.record.items.reduce((n, item) => n + amount(item.price_cny) + amount(item.buying_fee_cny), 0n);
    return s.identity.bookingAmount != null ? amount(s.identity.bookingAmount) : null;
  } catch { return null; }
}
export type Pending = { source: Source; kind: "待付款" | "尾款待收" | "售后待收" | "资料待补"; currency: Currency | null; balance: string | null; missing?: string };
export function pendingFor(s: Source, to: string): Pending[] {
  try { return calculatePending(s,to); }
  catch { return [{source:s,kind:"资料待补",currency:null,balance:null,missing:"应收或收款金额待核对"}]; }
}
function calculatePending(s: Source, to: string): Pending[] {
  const o = s.record.order, d = s.record.details;
  if (o.business_date > to || !activeOrder(s)) return [];
  const missing = [operatorOf(s) === UNKNOWN && "经办客服", !o.customer_label && "客户姓名", channelOf(s) !== "private" && !d?.liveRoomCode && "直播间"].filter(Boolean).join("、");
  const rows: Pending[] = missing ? [{source: s, kind: "资料待补", currency: null, balance: null, missing}] : [];
  if (!d || s.record.legacy || d.baseCustomerDue == null) return [...rows, {source: s, kind: "资料待补", currency: null, balance: null, missing: "约定应收／付款归属"}];
  const payments = (s.record.payments || []).filter(p => !p.voided_at && p.payment_date <= to);
  const charges = (s.record.charges || []).filter(c => !c.voided_at && c.business_date <= to);
  const ids = new Set(charges.map(c => c.id));
  if (payments.some(p => p.after_sale_charge_id && !ids.has(p.after_sale_charge_id))) return [...rows, {source:s, kind:"资料待补", currency:null, balance:null, missing:"收款关联的售后收费"}];
  const basePaid = payments.filter(p => !p.after_sale_charge_id).reduce((n, p) => n + amount(p.credit_amount), 0n);
  const baseBalance = amount(d.baseCustomerDue) - basePaid;
  if (baseBalance < 0n || charges.some(c => payments.filter(p=>p.after_sale_charge_id===c.id).reduce((n,p)=>n+amount(p.credit_amount),0n)>amount(c.customer_amount))) {
    return [...rows, {source:s, kind:"资料待补", currency:null, balance:null, missing:"收款抵扣超过关联应收，待核对"}];
  }
  if (baseBalance > 0n) rows.push({source: s, kind: basePaid ? "尾款待收" : "待付款", currency: d.customerCurrency, balance: money(baseBalance)});
  for (const c of charges) {
    const paid = payments.filter(p => p.after_sale_charge_id === c.id).reduce((n, p) => n + amount(p.credit_amount), 0n);
    const balance = amount(c.customer_amount) - paid;
    if (balance > 0n) rows.push({source: s, kind: "售后待收", currency: d.customerCurrency, balance: money(balance), missing: c.label});
  }
  return rows;
}
export function paymentRows(sources: Source[], from: string, to: string, kind?: "base" | "after"): CustomerPaymentRow[] {
  return sources.flatMap(s => (s.record.payments || []).filter(p => !p.voided_at && inRange(p.payment_date, from, to)
    && (!kind || (kind === "after" ? !!p.after_sale_charge_id : !p.after_sale_charge_id)))
    .map(p => ({date:p.payment_date, amount:p.amount, currency:p.currency})));
}
export async function convert(rows: CustomerPaymentRow[], quote?: Parameters<typeof convertCustomerPayments>[2]) {
  const totals: Record<Currency, bigint> = {CNY:0n, TWD:0n, USD:0n, SGD:0n, HKD:0n};
  for (const row of rows) {
    if (!(row.currency in totals)) throw Error("不支持的币种，金额待核对");
    totals[row.currency as Currency] += amount(row.amount);
  }
  return convertCustomerPayments(rows, {CNY:money(totals.CNY), TWD:money(totals.TWD), USD:money(totals.USD)}, quote);
}
export function aggregate(sources: Source[], f: Selection, accounts: CsAccount[] = []) {
  // Personal/account focus must not turn a person's share of the team into 100%.
  const teamValid=sources.filter(s=>matching(s,{...f,operator:"",account:""})&&inRange(s.record.order.business_date,f.from,f.to)&&activeOrder(s));
  const teamUnknownBookings=teamValid.filter(s=>booking(s)===null).length;
  const teamTurnover=teamValid.reduce((n,s)=>n+(booking(s)||0n),0n);
  const scoped = sources.filter(s => matching(s, f));
  const bookings = scoped.filter(s => inRange(s.record.order.business_date, f.from, f.to));
  const valid = bookings.filter(activeOrder);
  const unknownBookings = valid.filter(s => booking(s) === null).length;
  const turnover = valid.reduce((n, s) => n + (booking(s) || 0n), 0n);
  const cancelled = bookings.filter(s => s.record.order.cancelled).reduce((n,s) => n + (booking(s) || 0n), 0n);
  const pending = scoped.flatMap(s => pendingFor(s, f.to));
  const names = new Set(scoped.map(operatorOf));
  // Current holders can have zero business; they never replace the order's historical operator.
  if (!f.persona && !f.room) for (const a of accounts) if ((!f.account || a.id === f.account) && a.holderName && (!f.operator || a.holderName === f.operator)) names.add(a.holderName);
  const sumBooking = (rows: Source[]) => rows.reduce((n,s)=>n+(booking(s)||0n),0n);
  const contributions = [...names].filter(name => !f.operator || name === f.operator).map(name => {
    const records = scoped.filter(s => operatorOf(s) === name);
    const stats = valid.filter(s => operatorOf(s) === name);
    const live = stats.filter(s => channelOf(s) !== "private"), pushed = stats.filter(s => channelOf(s) === "private");
    return {name, sources:records, count:stats.length, turnover:sumBooking(stats), liveTurnover:sumBooking(live), privateTurnover:sumBooking(pushed), privateCount:pushed.length, unknown:stats.some(s=>booking(s)===null),
      accounts:[...new Set(records.map(s=>s.record.order.wechat_id || s.identity.wechatId || "原账号"))],
      pending:pending.filter(p=>operatorOf(p.source)===name)};
  });
  const customers = new Set(valid.map(s => `${s.identity.userId}:${s.identity.customerCode || s.record.order.customer_label || s.identity.id}`)).size;
  const liveValid = valid.filter(s => channelOf(s) !== "private"), privateValid = valid.filter(s => channelOf(s) === "private");
  const liveTurnover = liveValid.reduce((n,s)=>n+(booking(s)||0n),0n), privateTurnover = privateValid.reduce((n,s)=>n+(booking(s)||0n),0n);
  return {scoped, bookings, valid, turnover, liveTurnover, privateTurnover, privateCount: privateValid.length, unknownLive: liveValid.filter(s=>booking(s)===null).length, unknownBookings, cancelled, pending, contributions, customers,teamTurnover,teamUnknownBookings};
}
export function teamShare(turnover:bigint,teamTurnover:bigint,unknown:number):number|null {
  return unknown||teamTurnover<=0n?null:Number(turnover*10000n/teamTurnover)/100;
}
