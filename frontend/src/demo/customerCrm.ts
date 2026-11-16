import { useCallback, useRef, useState } from "react";
import { shiftDate, type InvalidReason } from "./assessmentFoundation";

export const invalidReasons = {
  no_chinese: "非中文客户",
  misclick: "误点咨询",
  obscene: "淫秽、色情类",
  custom: "自定义"
} as const satisfies Record<InvalidReason, string>;

export type SpendTier = "" | "A" | "B" | "C";
export type CustomerStatus = "valid" | "dealt" | "invalid";
export type ReviewStatus = "pending" | "approved" | "rejected" | "restored";
export type CrmActor = { role: "cs" | "cs_supervisor"; employeeId: string; employeeName: string; teamIds: string[] };

export type CrmCustomer = {
  id: string;
  customerRef: string;
  name: string;
  teamId: string;
  teamName: string;
  employeeId: string;
  employeeName: string;
  accountId: string;
  source: string;
  adAccountId: string;
  createdOn: string;
  need: string;
  spendTier: SpendTier;
  sample: boolean;
};

export type CrmOrder = {
  id: string;
  customerId: string;
  employeeId: string;
  employeeName: string;
  businessDate: string;
  channel: "live" | "private";
  materialCents: number;
  feeCents: number;
  cancelled: boolean;
  customerCurrency?: 'CNY'|'TWD'|'USD';
  customerDueMinor?: number;
  materialRef?: string;
  items?: {kind:string; materialRef:string; priceCny:string; buyingFeeCny:string}[];
  receipts?: CrmReceipt[];
  replacesId?: string;
  replacedById?: string;
  transferMinor?: number;
  transferReason?: string;
  transferredOn?: string;
  transferredBy?: string;
};
export type CrmReceipt = { id:string; date:string; amountMinor:number; purpose:'deposit'|'balance'; channel:string; reference:string; reportedBy:string };
export type CrmOrderDraft = { businessDate:string; channel:'live'|'private'; materialCny:string; feeCny:string; customerCurrency?:'CNY'|'TWD'|'USD'; customerDue?:string; materialRef?:string; items?:CrmOrder['items'] };

export function orderFunds(order: CrmOrder) {
  const due = order.customerDueMinor ?? order.materialCents + (order.channel==='private'?0:order.feeCents);
  const received = (order.receipts??[]).reduce((sum,row)=>sum+row.amountMinor,0);
  const carried = order.replacesId ? order.transferMinor??0 : 0;
  const allocated = order.cancelled ? 0 : received+carried;
  return { currency:order.customerCurrency??'CNY', due, received, carried, allocated, balance:order.cancelled?0:due-allocated };
}
export function effectiveOrderCents(order:CrmOrder) { return order.cancelled?0:order.materialCents+(order.channel==='private'?0:order.feeCents); }

export type CrmReview = {
  id: string;
  customerId: string;
  teamId: string;
  reason: InvalidReason;
  note: string;
  status: ReviewStatus;
  requestedAt: string;
  requestedBy: string;
  reviewer?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

export type CrmState = { customers: CrmCustomer[]; orders: CrmOrder[]; reviews: CrmReview[] };
export type NewLead = {
  name: string;
  accountId: string;
  employeeId: string;
  employeeName: string;
  teamId: string;
  teamName: string;
  source: string;
  adAccountId: string;
  createdOn: string;
  need: string;
  contact: "" | "replied" | "read_no_reply" | "unread" | "invalid";
  invalidReason: "" | InvalidReason;
  invalidNote: string;
};
export type DirectorySample = { teamId: string; teamName: string; personId: string; personName: string; accountId: string };

const storageKey = "cms-demo-customer-crm-v1";
const money = /^(\d{1,9})(?:\.(\d{1,2}))?$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export function yuanToCents(value: string): number | null {
  const match = money.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
}
export function centsToYuan(value: number): string {
  return Math.trunc(value / 100) + "." + String(Math.abs(value) % 100).padStart(2, "0");
}

function reviewsOf(state: CrmState, customerId: string): CrmReview[] {
  return state.reviews.filter(review => review.customerId === customerId).sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id));
}
export function customerStatus(state: CrmState, customer: CrmCustomer): CustomerStatus {
  const latest = reviewsOf(state, customer.id).at(-1);
  if (latest?.status === "approved") return "invalid";
  if (state.orders.some(order => order.customerId === customer.id && !order.cancelled)) return "dealt";
  return "valid";
}
export function validOrderCount(state: CrmState, customerId: string): number {
  return state.orders.filter(order => order.customerId === customerId && !order.cancelled).length;
}
export function customerTags(state: CrmState, customer: CrmCustomer): string[] {
  const status = customerStatus(state, customer);
  const tags = [status === "dealt" ? "已成交" : status === "invalid" ? "无效" : "有效"];
  if (customer.spendTier) tags.push(customer.spendTier + "档");
  if (validOrderCount(state, customer.id) > 2) tags.push("复购");
  if (state.reviews.some(review => review.customerId === customer.id && review.status === "pending")) tags.push("待复核");
  return tags;
}
export function officialInvalidCustomers(state: CrmState): CrmCustomer[] {
  return state.customers.filter(customer => customerStatus(state, customer) === "invalid");
}

export type PersonalPerformance = { liveCents: number; privateCents: number; totalCents: number; liveCount: number; privateCount: number };
export function personalPerformance(state: CrmState, employeeId: string): PersonalPerformance {
  const rows = state.orders.filter(order => order.employeeId === employeeId && !order.cancelled);
  const live = rows.filter(order => order.channel === "live");
  const privateRows = rows.filter(order => order.channel === "private");
  const liveCents = live.reduce((sum, order) => sum + order.materialCents + order.feeCents, 0);
  const privateCents = privateRows.reduce((sum, order) => sum + order.materialCents, 0);
  return { liveCents, privateCents, totalCents: liveCents + privateCents, liveCount: live.length, privateCount: privateRows.length };
}

function assertTeam(actor: CrmActor, teamId: string) {
  if (!actor.teamIds.includes(teamId)) throw Error("只能处理本组客资");
}
function assertOwnCustomer(actor: CrmActor, customer: CrmCustomer) {
  assertTeam(actor, customer.teamId);
  if (actor.role === "cs" && actor.employeeId !== customer.employeeId) throw Error("只能登记本人负责的客户");
}
function nextId(state: CrmState, prefix: string): string {
  const used = new Set([...state.customers, ...state.orders, ...state.reviews].map(item => item.id));
  let number = used.size + 1;
  while (used.has(prefix + number)) number += 1;
  return prefix + number;
}

function buildSamples(today: string, owner: DirectorySample, prefix: string): CrmState {
  const base = { teamId: owner.teamId, teamName: owner.teamName, employeeId: owner.personId, employeeName: owner.personName, accountId: owner.accountId, adAccountId: "", sample: true, spendTier: "" as SpendTier, source: "演练样本" };
  const customers: CrmCustomer[] = [
    { ...base, id: prefix + "valid", customerRef: prefix.toUpperCase() + "001", name: "演练客户·未成交", createdOn: today, need: "想看手镯，尚未报价" },
    { ...base, id: prefix + "dealt", customerRef: prefix.toUpperCase() + "002", name: "演练客户·已成交", createdOn: shiftDate(today, -2), need: "白冰手镯", spendTier: "B" },
    { ...base, id: prefix + "repeat", customerRef: prefix.toUpperCase() + "003", name: "演练客户·复购", createdOn: shiftDate(today, -6), need: "多次购买原石", spendTier: "A" },
    { ...base, id: prefix + "pending", customerRef: prefix.toUpperCase() + "004", name: "演练客户·待复核", createdOn: today, need: "对方表示按错咨询" },
    { ...base, id: prefix + "invalid", customerRef: prefix.toUpperCase() + "005", name: "演练客户·已无效", createdOn: shiftDate(today, -1), need: "不会中文" },
    { ...base, id: prefix + "private", customerRef: prefix.toUpperCase() + "006", name: "演练客户·私推", createdOn: shiftDate(today, -1), need: "私聊成交一件挂件", spendTier: "C" }
  ];
  const order = (id: string, customerId: string, day: number, channel: "live" | "private", material: number, fee: number): CrmOrder => ({ id, customerId, employeeId: owner.personId, employeeName: owner.personName, businessDate: shiftDate(today, day), channel, materialCents: material, feeCents: fee, cancelled: false });
  const orders = [
    order(prefix + "o1", prefix + "dealt", -2, "live", 98000, 9800),
    order(prefix + "o2", prefix + "repeat", -6, "live", 120000, 12000),
    order(prefix + "o3", prefix + "repeat", -4, "live", 80000, 8000),
    order(prefix + "o4", prefix + "repeat", -1, "live", 150000, 15000),
    order(prefix + "o5", prefix + "invalid", -1, "live", 50000, 5000),
    order(prefix + "o6", prefix + "private", -1, "private", 60000, 0),
    { ...order(prefix + "o7", prefix + "repeat", -3, "live", 99900, 9990), cancelled: true }
  ];
  const reviews: CrmReview[] = [
    { id: prefix + "r1", customerId: prefix + "pending", teamId: owner.teamId, reason: "misclick", note: "客户说明按错了咨询按钮", status: "pending", requestedAt: today + "T02:00:00.000Z", requestedBy: owner.personName },
    { id: prefix + "r2", customerId: prefix + "invalid", teamId: owner.teamId, reason: "no_chinese", note: "全程无法用中文沟通", status: "approved", requestedAt: shiftDate(today, -1) + "T02:00:00.000Z", requestedBy: owner.personName, reviewer: "演示客服主管", reviewedAt: shiftDate(today, -1) + "T06:00:00.000Z", reviewNote: "确认后供运营参考" }
  ];
  return { customers, orders, reviews };
}

export function createSeed(today: string): CrmState {
  return buildSamples(today, { teamId: "demo-team-a", teamName: "演示一组", personId: "demo-cs-a", personName: "演示客服甲", accountId: "demo-account-a" }, "sample-");
}
export function ensureTeamSamples(state: CrmState, today: string, directory: DirectorySample): CrmState {
  if (state.customers.some(customer => customer.teamId === directory.teamId)) return state;
  const extra = buildSamples(today, directory, "roster-");
  return { customers: [...state.customers, ...extra.customers], orders: [...state.orders, ...extra.orders], reviews: [...state.reviews, ...extra.reviews] };
}

export function reduceCrm(state: CrmState, action: CrmAction, today: string): CrmState {
  if (action.type === "registerLeads") return registerLeads(state, action.leads, today);
  if (action.type === "requestInvalid") return requestInvalid(state, action, today);
  if (action.type === "reviewInvalid") return reviewInvalid(state, action, today);
  if (action.type === "setTier") return setTier(state, action);
  if (action.type === "recordReceipt") return recordReceipt(state,action,today);
  if (action.type === "transferOrder") return transferOrder(state,action,today);
  return addOrder(state, action, today);
}

export type CrmAction =
  | { type: "registerLeads"; leads: NewLead[] }
  | { type: "requestInvalid"; actor: CrmActor; customerId: string; reason: InvalidReason; note: string }
  | { type: "reviewInvalid"; actor: CrmActor; reviewId: string; decision: "approve" | "reject" | "restore"; note: string }
  | { type: "setTier"; actor: CrmActor; customerId: string; tier: SpendTier }
  | ({ type: "addOrder"; actor: CrmActor; customerId: string } & CrmOrderDraft)
  | { type:'recordReceipt'; actor:CrmActor; orderId:string; date:string; amount:string; purpose:'deposit'|'balance'; channel:string; reference:string }
  | { type:'transferOrder'; actor:CrmActor; orderId:string; draft:CrmOrderDraft; reason:string };

function registerLeads(state: CrmState, leads: NewLead[], today: string): CrmState {
  if (!leads.length || leads.length > 100) throw Error("一次最多登记 100 位客户");
  let next = state;
  leads.forEach(lead => {
    const name = lead.name.trim();
    if (!name || name.length > 128) throw Error("客户名不能为空");
    if (!datePattern.test(lead.createdOn) || lead.createdOn > today) throw Error("登记日期无效");
    if (!lead.employeeId || !lead.teamId || !lead.accountId) throw Error("请先选择客服和接待账号");
    const customer: CrmCustomer = {
      id: nextId(next, "cust-"), customerRef: "C" + lead.createdOn.replaceAll("-", "") + "-" + String(next.customers.length + 1).padStart(3, "0"),
      name, teamId: lead.teamId, teamName: lead.teamName, employeeId: lead.employeeId, employeeName: lead.employeeName,
      accountId: lead.accountId, source: lead.source.trim().slice(0, 128), adAccountId: normalizeAdAccountId(lead.adAccountId), createdOn: lead.createdOn, need: lead.need.trim().slice(0, 1000),
      spendTier: "", sample: false
    };
    next = { ...next, customers: [...next.customers, customer] };
    if (lead.contact === "invalid") {
      if (!lead.invalidReason) throw Error("无效客资必须选择原因");
      if (lead.invalidReason === "custom" && !lead.invalidNote.trim()) throw Error("自定义无效原因需要填写");
      next = requestInvalid(next, { type: "requestInvalid", actor: { role: "cs", employeeId: lead.employeeId, employeeName: lead.employeeName, teamIds: [lead.teamId] }, customerId: customer.id, reason: lead.invalidReason, note: lead.invalidNote }, today);
    }
  });
  return next;
}

function requestInvalid(state: CrmState, action: Extract<CrmAction, { type: "requestInvalid" }>, today: string): CrmState {
  const customer = state.customers.find(item => item.id === action.customerId);
  if (!customer) throw Error("找不到该客户");
  assertOwnCustomer(action.actor, customer);
  if (!invalidReasons[action.reason]) throw Error("请选择无效原因");
  if (action.note.trim().length > 1000) throw Error("备注不能超过 1000 字");
  if (state.reviews.some(review => review.customerId === customer.id && review.status === "pending")) throw Error("该客户已有待复核申请");
  if (customerStatus(state, customer) === "invalid") throw Error("该客户已确认无效");
  const review: CrmReview = { id: nextId(state, "review-"), customerId: customer.id, teamId: customer.teamId, reason: action.reason, note: action.note.trim(), status: "pending", requestedAt: today + "T08:00:00.000Z", requestedBy: action.actor.employeeName };
  return { ...state, reviews: [...state.reviews, review] };
}

function reviewInvalid(state: CrmState, action: Extract<CrmAction, { type: "reviewInvalid" }>, today: string): CrmState {
  if (action.actor.role !== "cs_supervisor") throw Error("只有客服主管可以复核");
  const review = state.reviews.find(item => item.id === action.reviewId);
  if (!review) throw Error("找不到复核申请");
  assertTeam(action.actor, review.teamId);
  const note = action.note.trim();
  if (note.length > 1000) throw Error("处理原因不能超过 1000 字");
  if (action.decision !== "approve" && !note) throw Error("退回或恢复必须填写原因");
  if (action.decision === "restore" ? review.status !== "approved" : review.status !== "pending") throw Error("这条申请当前不能这样处理");
  const status: ReviewStatus = action.decision === "approve" ? "approved" : action.decision === "reject" ? "rejected" : "restored";
  return { ...state, reviews: state.reviews.map(item => item.id === review.id ? { ...item, status, reviewer: action.actor.employeeName, reviewedAt: today + "T09:00:00.000Z", reviewNote: note } : item) };
}

function setTier(state: CrmState, action: Extract<CrmAction, { type: "setTier" }>): CrmState {
  const customer = state.customers.find(item => item.id === action.customerId);
  if (!customer) throw Error("找不到该客户");
  assertOwnCustomer(action.actor, customer);
  if (!["", "A", "B", "C"].includes(action.tier)) throw Error("消费能力只能选 A、B、C 档");
  return { ...state, customers: state.customers.map(item => item.id === customer.id ? { ...item, spendTier: action.tier } : item) };
}

function addOrder(state: CrmState, action: Extract<CrmAction, { type: "addOrder" }>, today: string): CrmState {
  const customer = state.customers.find(item => item.id === action.customerId);
  if (!customer) throw Error("找不到该客户");
  assertOwnCustomer(action.actor, customer);
  validPaymentDate(action.businessDate,today);
  const material = yuanToCents(action.materialCny);
  const fee = yuanToCents(action.channel === "private" ? "0" : action.feeCny);
  if (material === null || material <= 0 || fee === null) throw Error("请填写有效的人民币金额");
  if (action.channel === "private" && action.feeCny.trim() && yuanToCents(action.feeCny) !== 0) throw Error("私推不收代购费");
  if (action.channel !== "live" && action.channel !== "private") throw Error("成交渠道无效");
  const currency=action.customerCurrency??'CNY';
  if(!['CNY','TWD','USD'].includes(currency))throw Error('付款币种无效');
  const due=currency==='CNY'?material+fee:yuanToCents(action.customerDue??'');
  if(due===null||due<=0)throw Error('请填写与客户约定的外币总应收');
  const order: CrmOrder = { id: nextId(state, "order-"), customerId: customer.id, employeeId: customer.employeeId, employeeName: customer.employeeName, businessDate: action.businessDate, channel: action.channel, materialCents: material, feeCents: action.channel === "private" ? 0 : fee, cancelled: false,customerCurrency:currency,customerDueMinor:due,materialRef:action.materialRef?.trim().slice(0,128),items:action.items,receipts:[] };
  return { ...state, orders: [...state.orders, order] };
}

function ownedOrder(state:CrmState,actor:CrmActor,id:string) {
  const order=state.orders.find(row=>row.id===id);
  const customer=state.customers.find(row=>row.id===order?.customerId);
  if(!order||!customer)throw Error('找不到原订单或客户');
  assertOwnCustomer(actor,customer);
  if(order.cancelled||order.replacedById)throw Error('已取消或已换料的订单不能重复操作');
  return order;
}
function validPaymentDate(value:string,today:string) {
  if(!datePattern.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value>today)throw Error('日期无效');
}
function recordReceipt(state:CrmState,action:Extract<CrmAction,{type:'recordReceipt'}>,today:string):CrmState {
  const order=ownedOrder(state,action.actor,action.orderId),funds=orderFunds(order);
  validPaymentDate(action.date,today);
  if(action.date<order.businessDate)throw Error('付款日期不能早于开单日期');
  const amount=yuanToCents(action.amount);
  if(amount===null||amount<=0||amount>funds.balance)throw Error('付款金额必须大于零且不超过剩余应收');
  if(!['deposit','balance'].includes(action.purpose))throw Error('请选择收款类型');
  if(!action.channel.trim()||!action.reference.trim())throw Error('请填写付款方式和流水号或凭证编号');
  if(action.channel.trim().length>128||action.reference.trim().length>128)throw Error('付款方式和凭证编号最多128字');
  if(state.orders.some(row=>row.receipts?.some(p=>p.channel===action.channel.trim()&&p.reference===action.reference.trim())))throw Error('该付款凭证已报送，请勿重复登记');
  const receipt:CrmReceipt={id:order.id+'-receipt-'+((order.receipts?.length??0)+1),date:action.date,amountMinor:amount,purpose:action.purpose,channel:action.channel.trim().slice(0,128),reference:action.reference.trim().slice(0,128),reportedBy:action.actor.employeeName};
  return {...state,orders:state.orders.map(row=>row.id===order.id?{...row,receipts:[...(row.receipts??[]),receipt]}:row)};
}
function transferOrder(state:CrmState,action:Extract<CrmAction,{type:'transferOrder'}>,today:string):CrmState {
  const original=ownedOrder(state,action.actor,action.orderId),funds=orderFunds(original);
  const reason=action.reason.trim();
  if(!reason||reason.length>500)throw Error('请填写换料原因，最多500字');
  validPaymentDate(action.draft.businessDate,today);
  if(action.draft.businessDate<original.businessDate||(original.receipts??[]).some(p=>p.date>action.draft.businessDate))throw Error('新开单日期不能早于原开单或已登记付款日期');
  if(funds.allocated<=0)throw Error('请先登记原订单定金');
  if(funds.balance<=0||(original.receipts??[]).some(p=>p.purpose==='balance'))throw Error('已结清或登记过尾款的订单请交财务处理换料');
  const added=addOrder(state,{...action.draft,type:'addOrder',actor:action.actor,customerId:original.customerId},today);
  const next=added.orders.at(-1)!;
  if(orderFunds(next).currency!==funds.currency)throw Error('转单前后约定币种须一致；跨币种请交财务核对');
  if(orderFunds(next).due<funds.allocated)throw Error('新单应收小于原定金，请先交财务处理差额');
  return {...added,orders:added.orders.map(row=>row.id===original.id?{...row,cancelled:true,replacedById:next.id,transferReason:reason,transferredOn:action.draft.businessDate,transferredBy:action.actor.employeeName}:row.id===next.id?{...row,replacesId:original.id,transferMinor:funds.allocated}:row)};
}


export function normalizeCrmState(state: CrmState): CrmState {
  return { ...state, customers: state.customers.map(customer => ({ ...customer, adAccountId: typeof customer.adAccountId === "string" ? customer.adAccountId.trim() : "" })) };
}
export function normalizeAdAccountId(value: string): string {
  const id = value.trim();
  if (!id) return "";
  if (!/^\d{1,32}$/.test(id)) throw Error("下粉广告户ID只保留数字，前导零按原文保留");
  return id;
}

function readable(today: string): CrmState {
  try {
    const raw = sessionStorage.getItem(storageKey);
    if (!raw) return createSeed(today);
    const parsed = JSON.parse(raw) as CrmState;
    if (!Array.isArray(parsed.customers) || !Array.isArray(parsed.orders) || !Array.isArray(parsed.reviews)) return createSeed(today);
    return normalizeCrmState(parsed);
  } catch {
    return createSeed(today);
  }
}

export function useCustomerCrm(today: string) {
  const [state, setState] = useState<CrmState>(() => readable(today));
  const [error, setError] = useState("");
  const stateRef = useRef(state);
  stateRef.current = state;
  const dispatch = useCallback((action: CrmAction) => {
    const next = reduceCrm(stateRef.current, action, today);
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    stateRef.current = next;
    setState(next);
    setError("");
  }, [today]);
  const adoptDirectory = useCallback((directory: DirectorySample) => {
    setState(current => {
      const next = ensureTeamSamples(current, today, directory);
      if (next !== current) sessionStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  }, [today]);
  return { state, dispatch, error, setError, adoptDirectory };
}
