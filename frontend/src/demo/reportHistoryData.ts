export const reportKinds = { fans: "每日加粉", orders: "开单记录", "after-sales": "售后费用", attendance: "入场登记" } as const;
export type ReportKind = keyof typeof reportKinds;
export type HistoryField = { key: string; label: string; value: string; type: "text" | "count" | "money" | "date"; editable: boolean };
export type HistoryRecord = { id: string; kind: ReportKind; accountId: string; accountLabel: string; teamName: string; businessDate: string; employeeName: string; employeeCode: string; title: string; source: string; version: number; fields: HistoryField[] };
export type HistoryData = { records: HistoryRecord[]; accounts: { id: string; label: string; teamName: string }[]; canPreviewCorrections: boolean; demo: true };
export type Correction = { record: HistoryRecord; before: HistoryRecord; reason: string; at: string };

export function previewCorrection(record: HistoryRecord, values: Record<string, string>, reason: string, expectedVersion: number, role: string, today: string): { record: HistoryRecord } | { error: string } {
  if (role !== "cs_supervisor") return { error: "仅客服主管可以更正本组历史记录" };
  if (record.version !== expectedVersion) return { error: "记录版本已变化，请重新打开" };
  if (!reason.trim() || reason.trim().length > 500) return { error: "请填写更正原因，最多500字" };
  if (Object.keys(values).some((key) => !record.fields.some((field) => field.key === key && field.editable))) return { error: "不能修改账号、业务日期、考核归属或财务核定信息" };
  let changed = false;
  const fields = record.fields.map((field) => {
    const value = values[field.key] ?? field.value;
    changed ||= value !== field.value;
    return { ...field, value };
  });
  for (const field of fields.filter((item) => item.editable)) {
    if (field.value.length > 1000) return { error: field.label + "最多1000字" };
    if (field.type === "text" && !field.value.trim() && field.key !== "note") return { error: "请填写" + field.label };
    if (field.type === "count" && !/^\d{1,7}$/.test(field.value)) return { error: field.label + "须为非负整数" };
    if (field.type === "money" && !/^\d{1,12}(\.\d{1,2})?$/.test(field.value)) return { error: field.label + "须为非负金额，最多两位小数" };
    if (field.type === "date" && field.value && (!/^\d{4}-\d{2}-\d{2}$/.test(field.value) || !Number.isFinite(Date.parse(field.value)) || new Date(field.value + "T00:00:00Z").toISOString().slice(0, 10) !== field.value || field.value > today)) return { error: field.label + "无效或晚于今天" };
  }
  const entered = fields.find((field) => field.key === "enteredCount");
  const ordered = fields.find((field) => field.key === "orderedCount");
  if (entered && ordered && ordered.value !== "未关联" && Number(entered.value) < Number(ordered.value)) return { error: "入场人数不能少于已关联的开单客户人数" };
  if (!changed) return { error: "尚未修改任何内容" };
  return { record: { ...record, fields, version: record.version + 1 } };
}
