import { fanFields } from "../dailyDetail";
import { dateIn } from "./orderTextParser";
export type FanLeadDraft = { customer: string; channel: "ms" | "ws"; summary: string; qualified: boolean };
export type FanFillFields = { businessDate: string; operatorName: string; pageName: string; personaCode: string; note: string } & Record<keyof typeof fanFields, string>;
export function emptyFanFields(): FanFillFields { return { businessDate: "", operatorName: "", pageName: "", personaCode: "", note: "", ...Object.fromEntries(Object.keys(fanFields).map(k => [k, ""])) } as FanFillFields; }
export type FanText = { fields: Partial<FanFillFields>; leads: FanLeadDraft[]; errors: string[]; warnings: string[]; unknownLines: string[] };
const aliases: Record<string, keyof FanFillFields> = {
  "日期": "businessDate", "业务日期": "businessDate", "客服": "operatorName", "经办客服": "operatorName", "主页(全名)": "pageName", "主页": "pageName", "人设": "pageName", "人设ID": "personaCode", "备注": "note",
  "本月Ms进粉总数": "msMonth", "本月Ms进粉人数": "msMonth", "本月Ws进粉人数": "wsMonth", "本月Ws进粉总数": "wsMonth", "今日Ms进粉总数": "msToday", "今日Ms进粉人数": "msToday", "今日Ws进粉人数": "wsToday", "今日Ws进粉总数": "wsToday",
  "今日有效": "validToday", "正常沟通回复": "commReplied", "取得沟通": "commReplied", "已读不回": "commReadNoReply", "未读": "commUnread", "无效粉": "commInvalid", "无效客源": "commInvalid",
  ...Object.fromEntries(Object.entries(fanFields).map(([key, label]) => [label.replace(/\s/g, ""), key]))
};
export const fanFillLabels: Record<keyof FanFillFields, string> = { businessDate: "业务日期", operatorName: "经办客服姓名", pageName: "人设 / 主页", personaCode: "人设ID", note: "备注", ...fanFields };
export function parseFanText(text: string, today: string): FanText {
  const result: FanText = { fields: {}, leads: [], errors: [], warnings: [], unknownLines: [] };
  if (!text.trim() || text.length > 12000) { result.errors.push("请粘贴一个接待账号、一张主页的日报，最多12000字。"); return result; }
  const seen = new Set<string>();
  let channel: "ms" | "ws" | null = null;
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.normalize("NFKC").replace(/\\\s*$/, "").trim();
    if (!line) continue;
    const pair = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(line);
    const normalized = pair?.[1].replace(/\s/g, "").replace(/messenger|message/gi, "Ms").replace(/whatsapp/gi, "Ws").replace(/ms/gi, "Ms").replace(/ws/gi, "Ws").replace(/id$/i, "ID");
    const key = normalized ? aliases[normalized] : undefined;
    if (key && pair) {
      if (seen.has(key)) { result.errors.push(`「${fanFillLabels[key]}」重复出现，请拆分日报或核对后重新识别。`); continue; }
      seen.add(key); const value = pair[2].trim();
      if (key === "msToday" || key === "wsToday") channel = key === "msToday" ? "ms" : "ws";
      if (key in fanFields) {
        if (!/^\d{1,7}(?:人|个)?$/.test(value)) result.errors.push(`「${fanFillLabels[key]}」须为非负整数。`);
        else result.fields[key] = String(Number(value.replace(/[人个]$/, "")));
      } else if (key === "businessDate") {
        const date = dateIn(value, today);
        if (date) result.fields.businessDate = date;
        else result.warnings.push("业务日期缺少年份、无效或晚于今天，请手动补填，未默认归入今天。");
      } else if (value.length > (key === "note" ? 1000 : 128)) result.errors.push(`「${fanFillLabels[key]}」过长，请精简。`);
      else result.fields[key] = value;
      continue;
    }
    const numbered = /^\d+[.、)\s]+\s*(.+)$/.exec(line)?.[1];
    const lead = numbered ? (/^(.+?)\s+([\p{Script=Han}\d].*)$/u.exec(numbered) || /^(.+?)\s{2,}(.+)$/.exec(numbered)) : null;
    if (lead && channel) {
      result.leads.push({ customer: lead[1].trim(), channel, summary: lead[2].trim(), qualified: false });
    } else result.unknownLines.push(line);
  }
  const ids = new Set<string>();
  for (const row of result.leads) { const id = `${row.channel}:${row.customer.toLowerCase()}`; if (ids.has(id)) result.errors.push(`客户「${row.customer}」在同一渠道重复，请核对。`); ids.add(id); }
  if (result.leads.length > 100) result.errors.push("客户明细超过100条，请拆分日报。");
  if (result.leads.length) result.warnings.push("客户姓名与描述已拆分为待核对明细；姓名含空格时请核对分界。是否明确需求均留待客服确认，不自动判定初步转化成功。");
  for (const [key, ch] of [["msToday", "ms"], ["wsToday", "ws"]] as const) {
    if (result.fields[key] !== undefined && result.leads.filter(l => l.channel === ch).length !== Number(result.fields[key])) result.warnings.push(`${ch === "ms" ? "Messenger" : "WhatsApp"}客户明细条数与今日进粉数不同，请补充或核对。`);
  }
  result.warnings.push("本月进粉仅保留累计快照；沟通情况按当日汇报，不要求与今日进粉合计相等。");
  return result;
}
