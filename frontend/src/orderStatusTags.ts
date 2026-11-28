import { cents, money } from "./commerceUi";
import { yuan } from "./dashboardDisplay";
import type { Order } from "./api";

export type OrderStatusFacts = {
  cancelled?: boolean;
  status?: string;
  customerDue?: string | null;
  basePaid?: string | null;
  basePaymentCount?: number;
  hasSplitPayment?: boolean;
  hasFullPayment?: boolean;
  shippedOn?: string | null;
  chargeDue?: string | null;
  chargePaid?: string | null;
  hasSourcingNoSettle?: boolean;
  currency?: string;
};

export type OrderTagTone = "wait" | "balance" | "settled" | "ship" | "shipped" | "after" | "ph" | "void";
export type OrderTag = { key: string; label: string; tone: OrderTagTone };
export type PaymentKind = "unpaid" | "balance" | "settled-split" | "settled-full" | "void";
export type OrderStatusView = {
  tags: OrderTag[];
  voided: boolean;
  payment: PaymentKind;
  unshipped: boolean;
  aftersalesDue: boolean;
  followup: string | null;
};

function asCents(value: string | null | undefined): bigint {
  if (value == null || String(value).trim() === "") return 0n;
  return cents(String(value).trim()) ?? 0n;
}

function minorToYuan(value: number) {
  const safe = Number.isFinite(value) ? Math.trunc(value) : 0;
  const abs = Math.abs(safe);
  return (safe < 0 ? "-" : "") + Math.trunc(abs / 100) + "." + String(abs % 100).padStart(2, "0");
}

function formatAmount(value: bigint, currency?: string) {
  const text = yuan(money(value));
  if (!currency || currency === "CNY") return text;
  return text.replace(/^\u00a5/, "") + " " + currency;
}

export function classifyOrderStatus(facts: OrderStatusFacts): OrderStatusView {
  const ran = Boolean(facts.cancelled);
  const refunded = facts.status === "refunded";
  const voided = ran || refunded;
  const dueText = facts.customerDue;
  const dueKnown = dueText != null && String(dueText).trim() !== "";
  const due = dueKnown ? asCents(dueText) : 0n;
  const paid = asCents(facts.basePaid);
  const aftersalesDue = asCents(facts.chargeDue) > asCents(facts.chargePaid);
  const settled = dueKnown && due > 0n && paid >= due;
  const count = facts.basePaymentCount ?? 0;
  const full = settled && count === 1 && Boolean(facts.hasFullPayment) && !facts.hasSplitPayment;
  let payment: PaymentKind = "unpaid";
  if (voided) payment = "void";
  else if (full) payment = "settled-full";
  else if (settled) payment = "settled-split";
  else if (paid > 0n) payment = "balance";

  const tags: OrderTag[] = [];
  if (voided) tags.push({ key: "void", label: ran ? "已跑单" : "已退款", tone: "void" });
  else {
    const payLabel = payment === "balance" ? "补尾款" : payment === "settled-split" ? "已补尾款" : payment === "settled-full" ? "已全款" : "待付款";
    const payTone: OrderTagTone = payment === "balance" ? "balance" : payment === "unpaid" ? "wait" : "settled";
    tags.push({ key: "pay", label: payLabel, tone: payTone });
    tags.push(facts.shippedOn ? { key: "ship", label: "已发货", tone: "shipped" } : { key: "ship", label: "未发货", tone: "ship" });
    if (aftersalesDue) tags.push({ key: "after", label: "售后待收", tone: "after" });
  }
  if (facts.hasSourcingNoSettle) tags.push({ key: "ph", label: "接待（PH）", tone: "ph" });

  const balance = due > paid ? due - paid : 0n;
  const followup = payment === "balance" && dueKnown
    ? "已付定金 " + formatAmount(paid, facts.currency) + " · 待补尾款 " + formatAmount(balance, facts.currency)
    : null;
  return { tags, voided, payment, unshipped: !voided && !facts.shippedOn, aftersalesDue: aftersalesDue && !voided, followup };
}

export type StatusFilter = "all" | "balance" | "unshipped" | "aftersales" | "settled-split" | "settled-full";
export const statusFilters: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "balance", label: "补尾款" },
  { id: "unshipped", label: "未发货" },
  { id: "aftersales", label: "售后待收" },
  { id: "settled-split", label: "已补尾款" },
  { id: "settled-full", label: "已全款" }
];

export function matchesStatusFilter(view: OrderStatusView, filter: StatusFilter) {
  if (filter === "all") return true;
  if (filter === "balance") return view.payment === "balance";
  if (filter === "unshipped") return view.unshipped;
  if (filter === "aftersales") return view.aftersalesDue;
  if (filter === "settled-split") return view.payment === "settled-split";
  return view.payment === "settled-full";
}

export function apiOrderFacts(order: Order): OrderStatusFacts {
  return {
    cancelled: order.cancelled,
    status: order.status,
    customerDue: order.customerDue,
    basePaid: order.basePaid,
    basePaymentCount: order.basePaymentCount,
    hasSplitPayment: order.hasSplitPayment,
    hasFullPayment: order.hasFullPayment,
    shippedOn: order.shippedOn,
    chargeDue: order.chargeDue,
    chargePaid: order.chargePaid,
    hasSourcingNoSettle: order.hasSourcingNoSettle,
    currency: order.customerCurrency
  };
}

export function factsFromCrm(order: {
  cancelled: boolean;
  sourcingNoSettle?: boolean;
  channel: "live" | "private";
  materialCents: number;
  feeCents: number;
  customerCurrency?: string;
  customerDueMinor?: number;
  receipts?: { purpose: string; amountMinor: number }[];
  replacesId?: string;
  transferMinor?: number;
}): OrderStatusFacts {
  const due = order.customerDueMinor ?? order.materialCents + (order.channel === "private" ? 0 : order.feeCents);
  const receipts = order.receipts ?? [];
  const received = receipts.reduce((sum, row) => sum + row.amountMinor, 0);
  const carried = order.replacesId ? order.transferMinor ?? 0 : 0;
  const paid = order.cancelled ? 0 : received + carried;
  const split = receipts.some(row => row.purpose === "deposit" || row.purpose === "balance") || carried > 0;
  return {
    cancelled: order.cancelled,
    customerDue: minorToYuan(due),
    basePaid: minorToYuan(Math.max(0, paid)),
    basePaymentCount: receipts.length,
    hasSplitPayment: split,
    hasFullPayment: receipts.length === 1 && receipts[0]?.purpose === "full" && !split,
    shippedOn: null,
    hasSourcingNoSettle: Boolean(order.sourcingNoSettle),
    currency: order.customerCurrency || "CNY"
  };
}
