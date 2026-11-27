import { useEffect, useState } from "react";
import { api } from "../api";
import { fillHolder, type FillAccount } from "./serviceDirectory";
import { fanFields, fanNote } from "../dailyDetail";
import { Field } from "../OrderWorkspace";
import { invalidReasonLabels, shareLabel, type ContactStatus, type EmployeeRecord, type InvalidReason, type TenureRecord } from "./assessmentFoundation";
import ReportTextImport from "./ReportTextImport";
import { emptyFanFields, fanFillLabels, parseFanText, type FanLeadDraft } from "./fanText";

const contactLabels: Record<ContactStatus | "", string> = { "": "待确认", replied: "正常沟通", read_no_reply: "已读不回", unread: "未读", invalid: "无效粉" };
const blankLead = (): FanLeadDraft & { invalidNote: string } => ({ customer: "", channel: "ms", summary: "", qualified: false, contact: "", invalidReason: "", invalidNote: "", roster: "intake" });
function PreviewFields({ fields }: { fields: Record<string, string | undefined> }) {
  return <dl className="fill-preview-fields">{Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{fanFillLabels[key as keyof typeof fanFillLabels] || key}</dt><dd>{value}</dd></div>)}</dl>;
}

export default function FanFillForm({ today, account, employees, tenures, onRegister }: { today: string; account: FillAccount; employees: EmployeeRecord[]; tenures: TenureRecord[]; onRegister?: (leads: Array<FanLeadDraft & { invalidNote: string }>, source: { pageName: string; businessDate: string; adAccountId: string }) => void }) {
  const [form, setForm] = useState(() => ({ ...emptyFanFields(), businessDate: account.registeredHolderId ? today : "", operatorName: account.holderName || "" }));
  const [leads, setLeads] = useState<Array<FanLeadDraft & { invalidNote: string }>>([]);
  const [reviewed, setReviewed] = useState(false);
  const [needsReviewed, setNeedsReviewed] = useState(false);
  const [draftReason, setDraftReason] = useState<"" | InvalidReason>("");
  const [draftNote, setDraftNote] = useState("");
  const [personaOptions, setPersonaOptions] = useState<string[]>([]);
  const [personaLoading, setPersonaLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setPersonaLoading(true);
    void api.orderPersonaOptions().then((list) => {
      if (active) setPersonaOptions(list);
    }).catch(() => {
      if (active) setPersonaOptions([]);
    }).finally(() => {
      if (active) setPersonaLoading(false);
    });
    return () => { active = false; };
  }, []);
  const dirty = Object.entries(form).some(([key, value]) => !!value && (key !== "operatorName" || value !== (account.holderName || ""))) || leads.length > 0;
  const intake = leads.filter((lead) => lead.roster !== "reviewOnly");
  const total = /^\d+$/.test(form.msToday) && /^\d+$/.test(form.wsToday) ? Number(form.msToday) + Number(form.wsToday) : null;
  const unique = new Set(leads.map((lead) => lead.channel + ":" + lead.customer.trim().toLowerCase()));
  const complete = total !== null && intake.length === total && unique.size === leads.length && intake.filter((lead) => lead.channel === "ms").length === Number(form.msToday) && intake.filter((lead) => lead.channel === "ws").length === Number(form.wsToday) && leads.every((lead) => lead.customer.trim() && (!lead.qualified || lead.summary.trim()));
  const contactsReady = leads.length > 0 && leads.every((lead) => lead.contact && (lead.contact !== "invalid" || (lead.invalidReason && (lead.invalidReason !== "custom" || lead.invalidNote.trim()))) && (!lead.qualified || lead.summary.trim()));
  const replied = leads.filter((lead) => lead.contact === "replied").length;
  const qualified = leads.filter((lead) => lead.contact === "replied" && lead.qualified && lead.summary.trim()).length;
  const namedInvalid = leads.filter((lead) => lead.contact === "invalid").length;
  const invalidTotal = /^\d+$/.test(form.commInvalid) ? Number(form.commInvalid) : null;
  const employee = fillHolder(account, form.businessDate, today, employees, tenures) || (form.businessDate === today && account.holderName ? { id: account.registeredHolderId || account.id, name: account.holderName, code: "" } : null);
  const blocked = !employee;
  const rate = complete && contactsReady && needsReviewed && employee ? (replied === 0 ? "正常沟通为0" : shareLabel(qualified, replied)) : null;
  const example = "客服：演示客服甲（09001）\n日期：" + today + "\n主页(全名)：演示主页甲\n本月Ms进粉总数：40\n本月Ws进粉人数：12\n今日Ms进粉总数：2\n1 演示客户甲 已读不回\n2 演示客户乙 白冰手镯，预算4000台币\n今日Ws进粉人数：0\n今日有效：2\n正常沟通回复：2\n已读不回：6\n未读：28\n无效粉：16\n不会中文：1\n误点咨询：0\n色情咨询：0\n今日申请无效：\n1  演示客户丙  Messenger  非中文客户  全程英文，无法沟通";
  function updateLead(index: number, patch: Partial<FanLeadDraft & { invalidNote: string }>) {
    setLeads(leads.map((lead, position) => {
      if (position !== index) return lead;
      const next = { ...lead, ...patch };
      if (next.contact !== "replied") next.qualified = false;
      if (next.contact !== "invalid") { next.invalidReason = ""; next.invalidNote = ""; }
      else if (patch.invalidReason === undefined && !next.invalidReason && draftReason) { next.invalidReason = draftReason; next.invalidNote = draftReason === "custom" ? draftNote : ""; }
      return next;
    }));
  }
  return <div className="card"><h2>新增客资登记</h2>
    <ReportTextImport name="每日加粉" example={example} dirty={dirty} parse={(text) => parseFanText(text, today)} preview={(result) => <><PreviewFields fields={result.fields} /><p>今日进粉明细：{result.leads.filter((lead) => lead.roster !== "reviewOnly").length}条 · 可复核无效客户 {result.leads.filter((lead) => lead.contact === "invalid").length} 人 · 明确需求待逐条确认</p></>} onApply={(result) => { setForm((current) => ({ ...current, ...result.fields })); setLeads(result.leads.map(lead => ({ ...lead, invalidNote: lead.invalidNote || "", roster: lead.roster || "intake" }))); setReviewed(false); setNeedsReviewed(false); }} />
    <form onSubmit={(event) => { event.preventDefault(); setReviewed(true); }} onChange={() => { setReviewed(false); setNeedsReviewed(false); }}>
      <div className="grid two">{(["businessDate", "operatorName", "pageName", "adAccountId"] as const).map((key) => {
        const label = key === "pageName" ? "人设" : key === "operatorName" ? "经办客服" : fanFillLabels[key];
        if (key === "pageName") {
          const current = form.pageName.trim();
          const options = personaOptions.filter((name) => name !== "无");
          const hasLegacy = Boolean(current && current !== "无" && !options.includes(current));
          return <Field key={key} label={label}><select required value={form.pageName} onChange={(event) => setForm({ ...form, pageName: event.target.value })}><option value="">{personaLoading ? "正在读取人设列表…" : "请选择人设"}</option><option value="无">无</option>{options.map((name) => <option key={name} value={name}>{name}</option>)}{hasLegacy && <option value={current}>{current}（历史记录）</option>}</select></Field>;
        }
        return <Field key={key} label={label}><input required={key !== "adAccountId"} inputMode={key === "adAccountId" ? "text" : undefined} pattern={key === "adAccountId" ? "[0-9]{0,32}" : undefined} type={key === "businessDate" ? "date" : "text"} max={key === "businessDate" ? today : undefined} maxLength={key === "adAccountId" ? 32 : 128} placeholder={key === "adAccountId" ? "例如 01871，前导零会保留" : undefined} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>;
      })}</div>
      <p className="notice">下粉广告户ID记在这一批新客户上，按原文保存。同一天承接多个广告户时分开登记。没有填写的客户显示“来源待补”，不会按客服或主页补上。此项只记录来源，不对应广告消耗。</p>
      {!employee && form.businessDate && <p className="notice">这一天没有对应的使用人，不能把日报记到当前持有人名下。</p>}
      <h3>进粉与当日沟通</h3><p className="notice">{fanNote}</p>
      <div className="grid two fill-num-grid">{Object.entries(fanFields).map(([key, label]) => <Field key={key} label={label}><input required inputMode="numeric" pattern="[0-9]{1,7}" value={form[key as keyof typeof fanFields]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></Field>)}</div>
      <h3>无效粉原因</h3><p className="notice">只把写了称呼的客户送主管复核。日报里的无效粉人数不会自动生成客户。预设原因是非中文客户、误点咨询、淫秽、色情类；其他情况选自定义并填写。已读不回和未读不算无效粉。</p>
      {leads.some((lead) => lead.contact === "invalid") ? leads.map((lead, index) => lead.contact !== "invalid" ? null : <div className="grid two" key={"reason-" + index}><Field label={(lead.customer.trim() || "客户 " + (index + 1)) + " 的原因"}><select required aria-label={(lead.customer.trim() || "客户 " + (index + 1)) + " 的无效原因"} value={lead.invalidReason} onChange={(event) => updateLead(index, { contact: "invalid", invalidReason: event.target.value as InvalidReason, invalidNote: event.target.value === "custom" ? lead.invalidNote : "" })}><option value="">请选择原因</option>{Object.entries(invalidReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{lead.invalidReason === "custom" && <Field label="自定义填写"><input required maxLength={1000} aria-label={(lead.customer.trim() || "客户 " + (index + 1)) + " 的自定义原因"} value={lead.invalidNote} placeholder="填写具体原因" onChange={(event) => updateLead(index, { invalidNote: event.target.value })} /></Field>}</div>) : <div className="grid two"><Field label="无效原因"><select aria-label="无效原因" value={draftReason} onChange={(event) => { const value = event.target.value as "" | InvalidReason; setDraftReason(value); if (value !== "custom") setDraftNote(""); }}><option value="">请选择原因</option>{Object.entries(invalidReasonLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>{draftReason === "custom" && <Field label="自定义填写"><input required maxLength={1000} aria-label="自定义填写" value={draftNote} placeholder="填写具体原因" onChange={(event) => setDraftNote(event.target.value)} /></Field>}</div>}
      {!leads.some((lead) => lead.contact === "invalid") && <p className="notice">先选原因。下方客户的沟通结果选为无效粉后，就使用这个原因；多位无效客户可以分别修改。</p>}
      {invalidTotal !== null && invalidTotal > namedInvalid && <p className="notice">日报无效粉 {invalidTotal} 人，本次只有 {namedInvalid} 人建档送复核。其余 {invalidTotal - namedInvalid} 人只计入当日人数，主管无法逐个复核。</p>}
      <h3>今日承接客户明细</h3><p className="notice">只登记当日新承接的客户。开口转化率 ＝ 已明确具体需求的人数 ÷ 已正常沟通的人数。普通回复、打招呼和已读不回不算明确需求。</p>
      {leads.map((lead, index) => <fieldset key={index} className="fill-line"><legend>客户 {index + 1}{lead.roster === "reviewOnly" ? " · 只送复核" : ""}</legend><div className="grid two"><Field label="客户ID / 昵称"><input required maxLength={128} value={lead.customer} onChange={(event) => updateLead(index, { customer: event.target.value })} /></Field><Field label="咨询渠道"><select value={lead.channel} onChange={(event) => updateLead(index, { channel: event.target.value as "ms" | "ws" })}><option value="ms">Messenger</option><option value="ws">WhatsApp</option></select></Field><Field label="沟通结果"><select value={lead.contact} onChange={(event) => updateLead(index, { contact: event.target.value as FanLeadDraft["contact"] })}><option value="">待确认</option>{(["replied", "read_no_reply", "unread", "invalid"] as const).map((value) => <option key={value} value={value}>{contactLabels[value]}</option>)}</select></Field>{lead.contact === "invalid" && <p className="notice">{lead.invalidReason === "custom" ? (lead.invalidNote.trim() ? "自定义：" + lead.invalidNote : "请在上方选择自定义并填写原因。") : lead.invalidReason ? "原因：" + invalidReasonLabels[lead.invalidReason] : "请在上方选择无效原因。"}</p>}</div><Field label="沟通情况 / 具体需求摘要"><textarea required={lead.qualified} maxLength={1000} value={lead.summary} onChange={(event) => updateLead(index, { summary: event.target.value })} /></Field><label className="fill-check"><input type="checkbox" disabled={lead.contact !== "replied"} checked={lead.contact === "replied" && lead.qualified} onChange={(event) => updateLead(index, { contact: "replied", qualified: event.target.checked })} />已聊出客户的具体需求</label><button type="button" className="secondary fill-remove" onClick={() => setLeads(leads.filter((_, position) => position !== index))}>移除此客户</button></fieldset>)}
      <button type="button" className="secondary fill-add" disabled={leads.length >= 100} onClick={() => setLeads([...leads, blankLead()])}>＋ 添加客户明细</button>
      <div className="actions"><button type="button" className="secondary" disabled={!complete || !contactsReady || blocked} onClick={() => setNeedsReviewed(true)}>确认以上客户沟通和需求判定</button></div>
      <div className="fill-totals"><span>当日承接 <strong>{total ?? "—"} 人</strong></span><span>正常沟通 <strong>{contactsReady ? replied + " 人" : "—"}</strong></span><span>已明确需求 <strong>{contactsReady ? qualified + " 人" : "—"}</strong></span><span>开口转化率 <strong>{rate ?? "待核对"}</strong></span></div>
      {complete && contactsReady && !needsReviewed && <p className="notice">请确认沟通结果和需求判定后再看开口转化率。分母是正常沟通人数，不是当日承接人数。</p>}
      {!complete && <p className="notice">明细须与各渠道今日进粉数相符、无重复客户后，才能核对开口转化率。月累计和当日沟通回复人数不作分母。</p>}
      <Field label="备注"><textarea maxLength={1000} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></Field>
      <div className="actions"><button type="button" disabled={blocked} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) setReviewed(true); }}>检查内容</button>{onRegister && <button type="button" disabled={!complete || !contactsReady || blocked} onClick={(event) => { if (event.currentTarget.form?.reportValidity()) onRegister(leads.map(lead => ({ ...lead, invalidNote: lead.invalidNote || "" })), { pageName: form.pageName, businessDate: form.businessDate, adAccountId: form.adAccountId.trim() }); }}>登记到本次客资库</button>}</div>
      {reviewed && <p role="status">{employee ? "归属 " + employee.name + (employee.code ? " · " + employee.code : "") + "。" : ""}{complete && contactsReady ? "基础项和客户沟通结果已填写。" : "请继续补齐客户明细和沟通结果。"}演示未保存。</p>}
    </form></div>;
}
