const directCategories = new Set(["design", "labor", "certificate", "box", "shipping", "packaging", "sourcing", "accessory"]);
const shippingCategories = new Set(["shipping", "certificate", "box", "packaging"]);

export type CommissionLine = {
  id: string;
  businessDate: string;
  orderRef: string;
  customer: string;
  channel: "live" | "private";
  host: string;
  operator: string;
  status: "ready" | "pending" | "reversed";
  pendingReason: string;
  revenueCents: number;
  costCents: number;
  netCents: number;
  hostCents: number | null;
  csCents: number | null;
};

export type WelfareDeduction = {
  id: string;
  expenseDate: string;
  operator: string;
  customer: string;
  purpose: string;
  amountCents: number;
};

function deductWelfareFromCs(rawNet: number, rawCs: number, welfareCents: number): number {
  if (welfareCents <= 0) return rawCs;
  if (rawNet > 0 && rawCs > 0) {
    if (welfareCents <= rawNet) {
      return rawCs - Math.round((welfareCents * rawCs) / rawNet);
    }
    return cutOf(rawNet - welfareCents, 500);
  }
  return rawCs - cutOf(welfareCents, 500);
}

export function centsOf(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function cutOf(net: number, basisPoints: number): number {
  const sign = net < 0 ? -1 : 1;
  return sign * Math.round((Math.abs(net) * basisPoints) / 10000);
}

export function yuan(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return sign + "¥" + Math.trunc(abs / 100).toLocaleString("zh-CN") + "." + String(abs % 100).padStart(2, "0");
}

function pending(base: Pick<CommissionLine, "id" | "businessDate" | "orderRef" | "customer" | "channel" | "host" | "operator">, reason: string): CommissionLine {
  return { ...base, status: "pending", pendingReason: reason, revenueCents: 0, costCents: 0, netCents: 0, hostCents: null, csCents: null };
}

export type CommissionInput = {
  order: {
    id: string;
    business_date: string;
    order_ref: string;
    status: string;
    material_cost_cny?: string | null;
    cancelled?: boolean;
    customer_label?: string | null;
  };
  details?: { hostName?: string | null; operatorName?: string | null } | null;
  items?: { price_cny: string; buying_fee_cny: string }[];
  charges?: { amount_cny: string; voided_at?: string | null }[];
  expenses?: { category: string; amount_cny: string; voided_at?: string | null }[];
};

export function commissionLine(record: CommissionInput, channel: "live" | "private"): CommissionLine {
  const order = record.order;
  const base = {
    id: order.id,
    businessDate: order.business_date,
    orderRef: order.order_ref,
    customer: order.customer_label || "未登记称呼",
    channel,
    host: record.details?.hostName?.trim() || "",
    operator: record.details?.operatorName?.trim() || ""
  };
  if (order.cancelled || order.status === "refunded") {
    return { ...base, status: "reversed", pendingReason: "", revenueCents: 0, costCents: 0, netCents: 0, hostCents: 0, csCents: 0 };
  }
  const items = record.items ?? [];
  if (!items.length) return pending(base, "商品明细未登记");
  let revenue = 0;
  for (const item of items) {
    const price = centsOf(item.price_cny);
    const fee = centsOf(item.buying_fee_cny);
    if (price == null || fee == null) return pending(base, "成交金额待核对");
    revenue += price + (channel === "private" ? 0 : fee);
  }
  for (const charge of record.charges ?? []) {
    if (charge.voided_at) continue;
    const amount = centsOf(charge.amount_cny);
    if (amount == null) return pending(base, "追加收费金额待核对");
    revenue += amount;
  }
  const materialText = order.material_cost_cny;
  const material = centsOf(materialText);
  if (materialText == null || materialText.trim() === "" || material == null) return pending(base, "料子本钱未登记");
  const expenses = (record.expenses ?? []).filter((expense) => !expense.voided_at);
  if (!expenses.some((expense) => shippingCategories.has(expense.category))) return pending(base, "发货成本未登记");
  let extra = 0;
  for (const expense of expenses) {
    if (!directCategories.has(expense.category)) continue;
    const amount = centsOf(expense.amount_cny);
    if (amount == null) return pending(base, "直接成本金额待核对");
    extra += amount;
  }
  const cost = material + extra;
  const net = revenue - cost;
  const rates = channel === "private" ? { host: 500, cs: 1000 } : { host: 1000, cs: 500 };
  return { ...base, status: "ready", pendingReason: "", revenueCents: revenue, costCents: cost, netCents: net, hostCents: base.host ? cutOf(net, rates.host) : null, csCents: base.operator ? cutOf(net, rates.cs) : null };
}

export function commissionSummary(lines: CommissionLine[], welfareDeductions: WelfareDeduction[] = []) {
  const ready = lines.filter((line) => line.status === "ready");
  const orderNet = ready.reduce((sum, line) => sum + line.netCents, 0);
  const welfareCents = welfareDeductions.reduce((sum, item) => sum + item.amountCents, 0);
  const net = orderNet - welfareCents;
  const people = commissionPeople(lines, welfareDeductions);
  return {
    net,
    welfareCents,
    welfareCount: welfareDeductions.length,
    host: ready.reduce((sum, line) => sum + (line.hostCents ?? 0), 0),
    cs: people.staff.reduce((sum, person) => sum + person.cents, 0),
    supervisor: cutOf(net, 500),
    pending: lines.filter((line) => line.status === "pending").length,
    unassigned: ready.filter((line) => line.channel === "private" && !line.host).length,
    ready: ready.length
  };
}

export function commissionPeople(lines: CommissionLine[], welfareDeductions: WelfareDeduction[] = []) {
  const ready = lines.filter((line) => line.status === "ready");
  function group(nameOf: (line: CommissionLine) => string, amountOf: (line: CommissionLine) => number | null) {
    const totals = new Map<string, number>();
    for (const line of ready) {
      const name = nameOf(line);
      const amount = amountOf(line);
      if (!name || amount == null) continue;
      totals.set(name, (totals.get(name) ?? 0) + amount);
    }
    return [...totals].map(([name, cents]) => ({ name, cents })).sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, "zh"));
  }
  const staffMap = new Map<string, { rawNet: number; rawCs: number; welfareCents: number }>();
  for (const line of ready) {
    const name = line.operator;
    if (!name || line.csCents == null) continue;
    const entry = staffMap.get(name) ?? { rawNet: 0, rawCs: 0, welfareCents: 0 };
    entry.rawNet += line.netCents;
    entry.rawCs += line.csCents;
    staffMap.set(name, entry);
  }
  for (const item of welfareDeductions) {
    const name = item.operator.trim();
    if (!name || item.amountCents <= 0) continue;
    const entry = staffMap.get(name) ?? { rawNet: 0, rawCs: 0, welfareCents: 0 };
    entry.welfareCents += item.amountCents;
    staffMap.set(name, entry);
  }
  const staff = [...staffMap.entries()]
    .map(([name, entry]) => ({
      name,
      cents: deductWelfareFromCs(entry.rawNet, entry.rawCs, entry.welfareCents),
      welfareCents: entry.welfareCents
    }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name, "zh"));
  return { hosts: group((line) => line.host, (line) => line.hostCents), staff };
}

export function estimateCsCommission(lines: CommissionLine[], welfareDeductions: WelfareDeduction[] = []) {
  let rawNet = 0;
  let amount = 0;
  let ready = 0;
  let pendingCount = 0;
  for (const line of lines) {
    if (line.status === "reversed") continue;
    if (line.status === "ready" && line.csCents !== null) {
      rawNet += line.netCents;
      amount += line.csCents;
      ready += 1;
    } else {
      pendingCount += 1;
    }
  }
  const welfareCents = welfareDeductions.reduce((sum, item) => sum + item.amountCents, 0);
  const netCents = ready || pendingCount === 0 ? deductWelfareFromCs(rawNet, amount, welfareCents) : null;
  return { cents: netCents, pendingCount, welfareCents, welfareCount: welfareDeductions.length };
}
