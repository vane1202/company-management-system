export const DEFAULT_TZ = "Asia/Shanghai";

export function businessToday(
  now = new Date(),
  timeZone = process.env.BUSINESS_TIMEZONE || DEFAULT_TZ
): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function addDays(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function daysInMonth(iso: string): number {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function startOfWeekMonday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dow = dt.getUTCDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  return addDays(iso, diff);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function resolvePeriod(
  preset: string | undefined,
  from: string | undefined,
  to: string | undefined,
  today: string
): { from: string; to: string } {
  if (from || to) {
    const start = from ?? to;
    const end = to ?? from;
    if (!start || !end || !isIsoDate(start) || !isIsoDate(end)) {
      throw new Error("日期范围无效");
    }
    if (start > end) throw new Error("开始日期不能晚于结束日期");
    return { from: start, to: end };
  }
  if (!preset || preset === "day") return { from: today, to: today };
  if (preset === "week") return { from: startOfWeekMonday(today), to: today };
  if (preset === "month") return { from: startOfMonth(today), to: today };
  throw new Error("汇总周期只能是 day、week 或 month");
}
