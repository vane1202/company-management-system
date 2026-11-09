export const fanFields = {
  msToday: "Messenger 今日进粉", wsToday: "WhatsApp 今日进粉",
  msMonth: "Messenger 本月累计", wsMonth: "WhatsApp 本月累计",
  validToday: "今日有效", commReplied: "正常沟通回复", commReadNoReply: "已读不回",
  commUnread: "未读", commInvalid: "无效粉"
};
export const opsFields = {
  spendUsd: "美元花费 USD", consultCount: "咨询数", consultCostUsd: "每次咨询成本 USD",
  clickCount: "点击量", ctrPercent: "点击率 %", balanceUsd: "余额快照 USD"
};
export const editorFields = {
  shootCount: "今日拍摄", editCount: "今日剪辑", sentToOpsCount: "发给运营", inventorySnapshot: "视频囤量快照"
};
export const fanNote = "只统计当天新增客户。月累计按主页取最后一次，不按天相加。四类状态及今日有效独立填写，暂不限制合计关系。历史未分类数无法拆分渠道，统计不完整。";
export const opsNote = "USD 单独记录，不与人民币工资或未知币种旧费用相加。咨询成本独立填写，点击率不回算；余额为快照，不按天相加。";
export const editorNote = "按人设分别保存。发给运营与历史已发布数分开；囤量取每人设最后一次快照，不按天相加。";

export function detailLines(kind: string, payload: Record<string, unknown>): string[] {
  const fields = kind === "fan_report" ? fanFields : kind === "ops_report" ? opsFields : editorFields;
  const legacy = kind === "fan_report" && payload.msToday == null && payload.wsToday == null;
  const name = kind === "fan_report" ? `主页：${payload.pageName || "历史未分类"}` : `人设/主页：${payload.personaName || "历史未命名"}`;
  const lines = [name, ...Object.entries(fields).map(([key, label]) => `${label}：${payload[key] ?? "未记录"}`)];
  if (legacy) lines.push(`未分类旧加粉：${payload.addedCount ?? 0}（统计不完整）`);
  if (kind === "ops_report") lines.push(`历史费用（币种未知）：${payload.promoCost ?? "未记录"}`, `推广视频：${payload.promoVideoCount ?? "未记录"}`, `平台：${payload.platform || "未记录"}`);
  if (kind === "editor_report") lines.push(`历史成片：${payload.finishedCount ?? "未记录"}`, `历史已发布：${payload.publishedCount ?? "未记录"}`, `囤量校正：${payload.inventoryAdjusted ? "是" : "否"}`);
  if (payload.note) lines.push(`备注：${payload.note}`);
  return lines;
}
