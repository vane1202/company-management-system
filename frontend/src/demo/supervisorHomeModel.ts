import { shareLabel, type AssessmentLead, type EmployeeRecord } from "./assessmentFoundation";

export const supervisorTeamIds = ["demo-team-a", "registered-team-qiuju"];

export function openingSnapshot(leads: AssessmentLead[], employees: EmployeeRecord[], period: string | { from: string; to: string }, teamIds?: readonly string[]) {
  const ids = new Set(employees.filter((employee) => teamIds?.includes(employee.teamId)).map((employee) => employee.id));
  const from = typeof period === "string" ? period : period.from;
  const to = typeof period === "string" ? period : period.to;
  const rows = leads.filter((lead) => lead.businessDate >= from && lead.businessDate <= to && (!teamIds || ids.has(lead.employeeId)));
  const replied = rows.filter((lead) => lead.contact === "replied");
  const qualified = replied.filter((lead) => lead.qualified).length;
  return { leadCount: rows.length, replied: replied.length, qualified, rate: replied.length === 0 ? "正常沟通为0" : shareLabel(qualified, replied.length) };
}

export type DeskCustomer = {
  id: string;
  name: string;
  employeeId: string;
  employeeName: string;
  spendTier: "" | "A" | "B" | "C";
  status: "valid" | "dealt" | "invalid";
  pending: boolean;
  sample: boolean;
  createdOn: string;
  need: string;
  attemptContact?: boolean;
};

export type DeskPerson = {
  id: string;
  name: string;
  following: number;
  dealt: number;
  pending: number;
  tiers: { A: number; B: number; C: number };
};

export function customerDesk(customers: DeskCustomer[], holders: { id: string; name: string }[]): { following: number; dealt: number; pending: number; tiers: DeskPerson["tiers"]; people: DeskPerson[] } {
  const names = new Map<string, string>();
  for (const holder of holders) names.set(holder.id, holder.name);
  for (const customer of customers) names.set(customer.employeeId, customer.employeeName);
  const people = [...names].map(([id, name]) => {
    const rows = customers.filter((customer) => customer.employeeId === id);
    const active = rows.filter((customer) => customer.status !== "invalid");
    return {
      id,
      name,
      following: active.length,
      dealt: rows.filter((customer) => customer.status === "dealt").length,
      pending: rows.filter((customer) => customer.pending && customer.status !== "invalid").length,
      tiers: { A: active.filter((customer) => customer.spendTier === "A").length, B: active.filter((customer) => customer.spendTier === "B").length, C: active.filter((customer) => customer.spendTier === "C").length }
    };
  }).sort((a, b) => b.following - a.following || b.pending - a.pending || a.name.localeCompare(b.name, "zh"));
  const active = customers.filter((customer) => customer.status !== "invalid");
  return {
    following: active.length,
    dealt: customers.filter((customer) => customer.status === "dealt").length,
    pending: customers.filter((customer) => customer.pending && customer.status !== "invalid").length,
    tiers: { A: active.filter((customer) => customer.spendTier === "A").length, B: active.filter((customer) => customer.spendTier === "B").length, C: active.filter((customer) => customer.spendTier === "C").length },
    people
  };
}

export function topBookers<T extends { name: string; count: number; turnover: bigint }>(rows: T[]): T[] {
  return rows.filter((row) => row.count > 0).sort((a, b) => (a.turnover === b.turnover ? a.name.localeCompare(b.name, "zh") : a.turnover < b.turnover ? 1 : -1)).slice(0, 3);
}
