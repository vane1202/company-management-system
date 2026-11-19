import { useEffect, useState } from "react";

export type FinanceBadge = { text: string; attention: boolean };
export type FinanceBadges = Partial<Record<"warehouse" | "reimbursement" | "dailyExpenses", FinanceBadge>>;
type Bill = { id: string; amount: string; status: "submitted" | "approved" | "rejected" };
type Claim = { id: string; amount: string; status: "pending" | "approved" | "rejected" };
type Payment = { amount: string; billId?: string; claimId?: string };
type DailyExpense = { date: string };

const cents = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
};
const paidFor = (payments: Payment[], key: "billId" | "claimId", id: string) =>
  payments.filter(payment => payment[key] === id).reduce((total, payment) => total + cents(payment.amount), 0n);
const describe = (parts: [number, string][]) => {
  const active = parts.filter(([count]) => count > 0);
  return { text: active.length ? active.map(([count, label]) => `${label} ${count}`).join(" · ") : "暂无待办", attention: active.length > 0 };
};

export function buildFinanceBadges(input: {
  bills: Bill[]; billPayments: Payment[]; claims: Claim[]; claimPayments: Payment[]; expenses: DailyExpense[]; month: string;
}): FinanceBadges {
  const unpaidBills = input.bills.filter(bill => bill.status === "approved" && paidFor(input.billPayments, "billId", bill.id) < cents(bill.amount)).length;
  const unpaidClaims = input.claims.filter(claim => claim.status === "approved" && paidFor(input.claimPayments, "claimId", claim.id) < cents(claim.amount)).length;
  const monthCount = input.expenses.filter(expense => expense.date.startsWith(input.month)).length;
  return {
    warehouse: describe([[input.bills.filter(bill => bill.status === "submitted").length, "待审核"], [unpaidBills, "待付款"]]),
    reimbursement: describe([[input.claims.filter(claim => claim.status === "pending").length, "待核对"], [unpaidClaims, "待付款"]]),
    dailyExpenses: monthCount ? { text: `本月已登记 ${monthCount} 笔`, attention: false } : { text: "本月未登记", attention: true },
  };
}

async function read<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("读取失败");
  return response.json() as Promise<T>;
}

export function useFinanceBadges(enabled: boolean, month: string, refreshKey: unknown) {
  const [badges, setBadges] = useState<FinanceBadges>({});
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    Promise.all([
      read<{ state: { bills: Bill[]; payments: Payment[] } }>("/api/demo/warehouse"),
      read<{ state: { claims: Claim[]; payments: Payment[] } }>("/api/demo/reimbursements"),
      read<{ records: DailyExpense[] }>("/api/demo/daily-expenses"),
    ]).then(([warehouse, reimbursements, daily]) => {
      if (live) setBadges(buildFinanceBadges({ bills: warehouse.state.bills, billPayments: warehouse.state.payments, claims: reimbursements.state.claims, claimPayments: reimbursements.state.payments, expenses: daily.records, month }));
    }).catch(() => { if (live) setBadges({}); });
    return () => { live = false; };
  }, [enabled, month, refreshKey]);
  return badges;
}