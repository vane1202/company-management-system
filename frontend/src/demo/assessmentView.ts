import { formatShare, type AssessmentAttendance, type AssessmentLead } from "./assessmentFoundation";

export type DayRate = { date: string; part: number; whole: number; unlinked: number; value: string | null; reason: string };
export type PeriodRate = { part: number; whole: number; unlinked: number; value: string | null; percent: string; fraction: string };

function percentText(value: string | null): string {
  if (value === null) return "—";
  return (value.endsWith(".0") ? value.slice(0, -2) : value) + "%";
}

export function rateOf(part: number, whole: number, unlinked: number, empty: string): PeriodRate {
  const value = formatShare(part, whole);
  return { part, whole, unlinked, value, percent: percentText(value), fraction: value === null ? empty : part + "/" + whole + "人" };
}

function dayRate(date: string, part: number, whole: number, unlinked: number, empty: string): DayRate {
  const rated = rateOf(part, whole, unlinked, empty);
  return { date, part, whole, unlinked, value: rated.value, reason: rated.value === null ? empty : "" };
}

export function openingDays(leads: AssessmentLead[], days: string[], employeeId = ""): DayRate[] {
  return days.map((date) => {
    const rows = leads.filter((lead) => lead.businessDate === date && (!employeeId || lead.employeeId === employeeId));
    const replied = rows.filter((lead) => lead.contact === "replied");
    const qualified = replied.filter((lead) => lead.qualified).length;
    const empty = rows.length === 0 ? "未报" : "正常沟通为0";
    return dayRate(date, qualified, replied.length, 0, empty);
  });
}

export function orderDays(attendance: AssessmentAttendance[], days: string[], employeeId = ""): DayRate[] {
  return days.map((date) => {
    const rows = attendance.filter((row) => row.businessDate === date && (!employeeId || row.employeeId === employeeId));
    const linked = rows.filter((row) => row.orderLink === "linked");
    const customers = new Set<string>();
    for (const row of linked) for (const id of row.orderedCustomerIds) customers.add(id);
    const entered = linked.reduce((sum, row) => sum + row.enteredCount, 0);
    const unlinked = rows.filter((row) => row.orderLink !== "linked").reduce((sum, row) => sum + row.enteredCount, 0);
    const empty = rows.length === 0 ? "未报" : unlinked > 0 && entered === 0 ? "尚未关联" : "入场为0";
    return dayRate(date, customers.size, entered, unlinked, empty);
  });
}

export function periodRate(days: DayRate[], empty: string): PeriodRate {
  const part = days.reduce((sum, day) => sum + day.part, 0);
  const whole = days.reduce((sum, day) => sum + day.whole, 0);
  const unlinked = days.reduce((sum, day) => sum + day.unlinked, 0);
  const fallback = whole > 0 ? "" : unlinked > 0 && days.every((day) => day.whole === 0) ? "尚未关联" : days.every((day) => day.reason === "未报" || day.reason === "") && part === 0 && whole === 0 ? "未报" : empty;
  return rateOf(part, whole, unlinked, fallback || empty);
}

export type PersonRate = PeriodRate & { employeeId: string };
export function peopleRates(employeeIds: string[], leads: AssessmentLead[], attendance: AssessmentAttendance[], days: string[], kind: "opening" | "order"): PersonRate[] {
  return employeeIds.map((employeeId) => {
    const series = kind === "opening" ? openingDays(leads, days, employeeId) : orderDays(attendance, days, employeeId);
    return { employeeId, ...periodRate(series, kind === "opening" ? "正常沟通为0" : "未报") };
  }).filter((row) => row.part > 0 || row.whole > 0 || row.unlinked > 0);
}