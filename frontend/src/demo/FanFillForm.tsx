import { useState } from "react";
import type { CsAccount } from "../api";
import { fanFields, fanNote } from "../dailyDetail";
import { Field } from "../OrderWorkspace";
import { holderOn, invalidReasonLabels, reasonGap, shareLabel, type ContactStatus, type EmployeeRecord, type InvalidReason, type TenureRecord } from "./assessmentFoundation";
import ReportTextImport from "./ReportTextImport";
import { emptyFanFields, fanFillLabels, parseFanText, type FanLeadDraft } from "./fanText";

const contactLabels: Record<ContactStatus | "", string> = { "": "待确认", replied: "正常沟通", read_no_reply: "已读不回", unread: "未读", invalid: "无效粉" };
const blankLead = (): FanLeadDraft => ({ customer: "", channel: "ms", summary: "", qualified: false, contact: "", invalidReason: "" });
function PreviewFields({ fields }: { fields: Record<string, string | undefined> }) {
  return <dl className="fill-preview-fields">{Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{fanFillLabels[key as keyof typeof fanFillLabels] || key}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function FanFillForm({ today, account, employees, tenures }: { today: string; account: CsAccount; employees: EmployeeRecord[]; tenures: TenureRecord[] }) {
  const [form, setForm] = useState(() => ({ ...emptyFanFields(), operatorName: account.holderName || "" }));
  const [leads, setLeads] = useState<FanLeadDraft[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [needsReviewed, setNeedsReviewed] = useState(false);
  const dirty = Object.entries(form).some(([key, value]) => !!value && (key !== "operatorName" || value !== (account.holderName || ""))) || leads.length > 0;
  const total = /^\d+$/.test(form.msToday) && /^\d+$/.test(form.wsToday) ? Number(form.msToday) + Number(form.wsToday) : null;
  const unique = new Set(leads.map((lead) => lead.channel + ":" + lead.customer.trim().toLowerCase()));
  const complete = total !== null && leads.length === total && unique.size === leads.length && leads.filter((lead) => lead.channel === "ms").length === Number(form.msToday) && leads.filter((lead) => lead.channel === "ws").length === Number(form.wsToday) && leads.every((lead) => lead.customer.trim() && (!lead.qualified || lead.summary.trim()));
  const contactsReady = leads.length > 0 && leads.every((lead) => lead.contact && (lead.contact !== "invalid" || lead.invalidReason) && (!lead.qualified || lead.summary.trim()));
  const replied = leads.filter((lead) => lead.contact === "replied").length;
  const qualified = leads.filter((lead) => lead.contact === "replied" && lead.qualified && lead.summary.trim()).length;
  const gap = reasonGap(form.commInvalid, [form.invalidNoChinese, form.invalidMisclick, form.invalidObscene]);
  const employee = employees.find((item) => item.id === holderOn(tenures, account.id, form.businessDate)?.employeeId) || null;
  const blocked = !employee || gap.status === "over" || gap.status === "invalid";
  const rate = complete && contactsReady && needsReviewed && employee ? (replied === 0 ? "正常沟通为0" : shareLabel(qualified, replied)) : null;
  const example = "客服：演示客服甲\n日期：" + today + "\n主页(全名)：演示主页甲\n本月Ms进粉总数：40\n本月Ws进粉人数：12\n今日Ms进粉总数：2\n1 演示客户甲 已读不回\n2 演示客户乙 白冰手镯，预算4000台币\n今日Ws进粉人数：0\n今日有效：2\n正常沟通回复：2\n已读不回：6\n未读：28\n无效粉：16\n不会中文：1\n误点咨询：0\n色情咨询：0";
  function updateLead(index: number, patch: Partial<FanLeadDraft>) {
    setLeads(leads.map((lead, position) => {
      if (position !== index) return lead;
      const next = { ...lead, ...patch };
      if (next.contact !== "replied") next.qualified = false;
      if (next.contact !== "invalid") next.invalidReason = "";
      return next;
    }));
  }
  return <div className="card"><h2>每日加粉填报</h2>
    <ReportTextImport name="每日加粉" example={example} dirty={dirty} parse={(text) => parseFanText(text, today)} preview={(result) => <><PreviewFields fields={result.fields} /><p>客户明细：{result.leads.length}条 · 正常沟通 {result.leads.filter((lead) => lead.contact === "replied").length} · 无效粉 {result.leads.filter((lead) => lead.contact === "invalid").length} · 明确需求待逐条确认</p></>} onApply={(result) => { setForm((current) => ({ ...current, ...result.fields })); setLeads(result.leads); setReviewed(false); setNeedsReviewed(false); }} />
    <form onSubmit={(event) => { event.preventDefault(); setReviewed(true); }} onChange={() => { setReviewed(false); setNeedsReviewed(false); }}>
      <div className="grid two">{(["businessDate", "operatorName", "pageName", "personaCode"] as const).map((key) => <Field key={key} label={fanFillLabels[key]}><input required={key !== "personaCode"} type={key === "businessDate" ? "date" : "text"} max={key === "businessDate" ? today : undefined} maxLength={128} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>)}</div>
      <Field label="考核归属"><input readOnly value={employee ? employee.name + " · " + employee.code : ""} placeholder={form.businessDate ? "该日期没有账号使用人" : "先填写业务日期"} /><small className="hint">按业务日的账号使用历史封存，不随当前持有人改变。手填姓名不一致时，仍以使用历史为准。</small></Field>
      {!employee && form.businessDate && <p className="notice">这一天没有对应的使用人，不能把日报记到当前持有人名下。</p>}
      <h3>进粉与当日沟通</h3><p className="notice">{fanNote}</p>
      <div className="grid two">{Object.entries(fanFields).map(([key, label]) => <Field key={key} label={label}><input required inputMode="numeric" pattern="[0-9]{1,7}" value={form[key as keyof typeof fanFields]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>)}</div>
      <h3>无效粉原因</h3><p className="notice">只区分不具备中文沟通能力、误点咨询、淫秽色情。留空表示尚未区分；填0表示这一类没有。已读不回和未读不算无效粉，也不进入开口转化率。</p>
      <div className="grid two">{(["invalidNoChinese", "invalidMisclick", "invalidObscene"] as const).map((key) => <Field key={key} label={fanFillLabels[key]}><input inputMode="numeric" pattern="[0-9]{1,7}" value={form[key]} placeholder="未区分可留空" onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>)}</div>
      {gap.status === "over" && <p className="error" role="alert">三类原因合计不能超过无效粉人数。</p>}
      {gap.status === "ok" && gap.unspecified ? <p className="notice">还有 {gap.unspecified} 位无效粉未区分原因，记为待补。</p> : null}
      {gap.status === "missing" && Number(form.commInvalid) > 0 && <p className="notice">无效粉尚未按固定原因区分，暂不能供运营分析。</p>}
      <h3>今日承接客户明细</h3><p className="notice">只登记当日新承接的客户。开口转化率 ＝ 已明确具体需求的人数 ÷ 已正常沟通的人数。普通回复、打招呼和已读不回不算明确需求。</p>
      {leads.map((lead, index) => <fieldset key={index} className="fill-line"><legend>客户 {index + 1}</legend><div className="grid two"><Field label="客户ID / 昵称"><input required maxLength={128} value={lead.customer} onChange={(event) => updateLead(index, { customer: event.target.value })} /></Field><Field label="咨询渠道"><select value={lead.channel} onChange={(event) => updateLead(index, { channel: event.target.value as "ms" | "ws" })}><option value="ms">Messenger</option><option value="ws">WhatsApp</option></select></Field><Field label="沟通结果"><select value={lead.contact} onChange={(event) => updateLead(index, { contact: event.target.value as FanLeadDraft["contact"] })}><option value="">待确认</option>{(["replied", "read_no_reply", "unread", "invalid"] as const).map((value) => <option key={value} value={value}>{contactLabels[value]}</option>)}</select></Field>{lead.contact === "invalid" && <Field label="无效原因"><select required value={lead.invalidReason} onChange={(event) => updateLead(index, { contact: "invalid", invalidReason: event.target.value as InvalidReason })}><option value="">请选择原因</option>{Object.entries(invalidReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}</div><Field label="沟通情况 / 具体需求摘要"><textarea required={lead.qualified} maxLength={1000} value={lead.summary} onChange={(event) => updateLead(index, { summary: event.target.value })} /></Field><label className="fill-check"><input type="checkbox" disabled={lead.contact !== "replied"} checked={lead.contact === "replied" && lead.qualified} onChange={(event) => updateLead(index, { contact: "replied", qualified: event.target.checked })} />已聊出客户的具体需求</label><button type="button" className="secondary" onClick={() => setLeads(leads.filter((_, position) => position !== index))}>移除此客户</button></fieldset>)}
      <button type="button" className="secondary" disabled={leads.length >= 100} onClick={() => setLeads([...leads, blankLead()])}>＋ 添加客户明细</button>
      <div className="actions"><button type="button" className="secondary" disabled={!complete || !contactsReady || blocked} onClick={() => setNeedsReviewed(true)}>确认以上客户沟通和需求判定</button></div>
      <div className="fill-totals"><span>当日承接 <strong>{total ?? "—"} 人</strong></span><span>正常沟通 <strong>{contactsReady ? replied + " 人" : "—"}</strong></span><span>已明确需求 <strong>{contactsReady ? qualified + " 人" : "—"}</strong></span><span>开口转化率 <strong>{rate ?? "待核对"}</strong></span></div>
      {complete && contactsReady && !needsReviewed && <p className="notice">请确认沟通结果和需求判定后再看开口转化率。分母是正常沟通人数，不是当日承接人数。</p>}
      {!complete && <p className="notice">明细须与各渠道今日进粉数相符、无重复客户后，才能核对开口转化率。月累计和当日沟通回复人数不作分母。</p>}
      <Field label="备注"><textarea maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
      <button type="button" disabled={blocked} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) setReviewed(true); }}>检查试填内容（不保存）</button>
      {reviewed && <p role="status">{employee ? "归属 " + employee.name + " · " + employee.code + "。" : ""}{complete && contactsReady ? "基础项和客户沟通结果已填写。" : "请继续补齐客户明细和沟通结果。"}演示未保存。</p>}
    </form></div>;
}
