import { addMoney, formatMoney } from "./money.js";

export const FAN_STATS_INCOMPLETE_NOTE =
  "历史加粉只有旧 added_count，无法拆成 Messenger/WhatsApp；未分类旧数已单独保留。月累计取各主页最后一次上报的本月累计，不把每天的月累计再相加。系统没有比当时群报更完整的历史期初，不能把旧数自动重分配到渠道或改写成 0。";

export const OPS_CURRENCY_NOTE =
  "美元投放指标与人民币工资、历史 promo_cost 隔离，未建汇率，不自行换汇。旧 promo_cost 币种未知，按 legacy 保留并继续进入原经营估算；新 spend_usd 不进入原估算。余额与咨询成本都是独立上报值，余额是快照不按天求和，咨询成本不按花费÷咨询数回算。没有曝光量时不回算点击率。";

export const EDITOR_FIELD_NOTE =
  "发给运营条数是独立新字段，不等于旧 published_count，也不会用旧已发布数自动改写。视频囤量是人设快照，区间内取每人设最后一次，不按天求和。";

export type FanMetricRow = {
  user_id: string;
  business_date: string;
  page_name?: string | null;
  added_count?: number | string | null;
  ms_today?: number | string | null;
  ws_today?: number | string | null;
  ms_month?: number | string | null;
  ws_month?: number | string | null;
  valid_today?: number | string | null;
  comm_replied?: number | string | null;
  comm_read_no_reply?: number | string | null;
  comm_unread?: number | string | null;
  comm_invalid?: number | string | null;
};

export type NamedSnapshotRow = {
  user_id: string;
  persona_name?: string | null;
  business_date: string;
  value: number | string | null;
};

function asInt(value: unknown): number {
  if (value == null || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function asNullableInt(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function fanRowIsLegacyUnclassified(row: FanMetricRow): boolean {
  return (
    asNullableInt(row.ms_today) == null &&
    asNullableInt(row.ws_today) == null &&
    asNullableInt(row.ms_month) == null &&
    asNullableInt(row.ws_month) == null &&
    asNullableInt(row.valid_today) == null &&
    asNullableInt(row.comm_replied) == null &&
    asNullableInt(row.comm_read_no_reply) == null &&
    asNullableInt(row.comm_unread) == null &&
    asNullableInt(row.comm_invalid) == null
  );
}

/** 当天进粉展示值：未分类旧行用 added_count；明细行用当日 Ms+Ws 增量，不把月累计加进来。 */
export function fanTodayIncrement(row: FanMetricRow): number {
  if (fanRowIsLegacyUnclassified(row)) return asInt(row.added_count);
  return asInt(row.ms_today) + asInt(row.ws_today);
}

export function summarizeFanRows(rows: FanMetricRow[]) {
  let legacyUnclassifiedAdded = 0;
  let msToday = 0;
  let wsToday = 0;
  let validToday = 0;
  let commReplied = 0;
  let commReadNoReply = 0;
  let commUnread = 0;
  let commInvalid = 0;
  let detailedRows = 0;
  let legacyRows = 0;

  for (const row of rows) {
    if (fanRowIsLegacyUnclassified(row)) {
      legacyRows += 1;
      legacyUnclassifiedAdded += asInt(row.added_count);
      continue;
    }
    detailedRows += 1;
    msToday += asInt(row.ms_today);
    wsToday += asInt(row.ws_today);
    validToday += asInt(row.valid_today);
    commReplied += asInt(row.comm_replied);
    commReadNoReply += asInt(row.comm_read_no_reply);
    commUnread += asInt(row.comm_unread);
    commInvalid += asInt(row.comm_invalid);
  }

  return {
    legacyUnclassifiedAdded,
    msToday,
    wsToday,
    validToday,
    commReplied,
    commReadNoReply,
    commUnread,
    commInvalid,
    detailedRows,
    legacyRows,
    todayTotal: legacyUnclassifiedAdded + msToday + wsToday,
    statsIncomplete: legacyRows > 0,
    note: FAN_STATS_INCOMPLETE_NOTE
  };
}

/** 月累计：每个 (user, page) 取日期最近的一次上报值，绝不把每天的月累计再相加。 */
export function lastMonthCumulative(
  rows: FanMetricRow[],
  field: "ms_month" | "ws_month"
): number {
  const latest = new Map<string, { date: string; value: number }>();
  for (const row of rows) {
    if (fanRowIsLegacyUnclassified(row)) continue;
    const value = asNullableInt(row[field]);
    if (value == null) continue;
    const page = String(row.page_name ?? "");
    const key = `${row.user_id}\u0000${page}`;
    const prev = latest.get(key);
    if (!prev || row.business_date >= prev.date) {
      latest.set(key, { date: row.business_date, value });
    }
  }
  let total = 0;
  for (const item of latest.values()) total += item.value;
  return total;
}

/** 快照：每人设取区间内最后一次，再跨人设相加；同一人设不得按天求和。 */
export function lastSnapshotsThenSum(rows: NamedSnapshotRow[]): number {
  const latest = new Map<string, { date: string; value: number }>();
  for (const row of rows) {
    const value = asNullableInt(row.value);
    if (value == null) continue;
    const persona = String(row.persona_name ?? "");
    const key = `${row.user_id}\u0000${persona}`;
    const prev = latest.get(key);
    if (!prev || row.business_date >= prev.date) {
      latest.set(key, { date: row.business_date, value });
    }
  }
  let total = 0;
  for (const item of latest.values()) total += item.value;
  return total;
}

/** 余额以分为单位精确相加，避免用浮点求和后四舍五入。 */
export function lastMoneySnapshotsThenSum(rows: NamedSnapshotRow[]): string {
  const latest = new Map<string, NamedSnapshotRow>();
  for (const row of rows) {
    if (row.value == null) continue;
    const key = `${row.user_id}\u0000${row.persona_name ?? ""}`;
    const previous = latest.get(key);
    if (!previous || row.business_date >= previous.business_date) latest.set(key, row);
  }
  return addMoney([...latest.values()].map((row) => formatMoney(row.value)));
}

export function fanDetailFieldsEqual(
  left: Partial<Record<keyof FanMetricRow | "note", unknown>>,
  right: Partial<Record<keyof FanMetricRow | "note", unknown>>
): boolean {
  const keys: Array<keyof FanMetricRow | "note"> = [
    "added_count",
    "page_name",
    "ms_today",
    "ws_today",
    "ms_month",
    "ws_month",
    "valid_today",
    "comm_replied",
    "comm_read_no_reply",
    "comm_unread",
    "comm_invalid"
  ];
  for (const key of keys) {
    const a = left[key] ?? null;
    const b = right[key] ?? null;
    if (String(a ?? "") !== String(b ?? "")) return false;
  }
  return String(left.note ?? "") === String(right.note ?? "");
}
