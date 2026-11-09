import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type Payroll, type PayrollEmployee, type PayrollItem, type PayrollKind, type SalaryEmployee } from "./api";
import { roleLabel } from "./access";
import { createRequestGate } from "./requestGate";
import { toErrorMessage } from "./errors";
import { Field } from "./OrderWorkspace";
import { submissionKey } from "./commerceUi";
import { isPayMonth, payrollAmountError, payrollKindLabel, shiftMonth, signedLabel } from "./payrollUi";

type ItemDraft = { kind: PayrollKind; amount: string; note: string };
const emptyDraft = (): ItemDraft => ({ kind: "commission", amount: "", note: "" });

/** 月度工资单：财务录入提成/奖金/扣款并锁定；BOSS 只读。手机 360px 优先。 */
export function PayrollMonth({ today, readOnly, employees }: { today: string; readOnly: boolean; employees: SalaryEmployee[] }) {
  const [month, setMonth] = useState(() => shiftMonth(today)), [userId, setUserId] = useState("");
  const [data, setData] = useState<Payroll | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [open, setOpen] = useState<string>(""), [message, setMessage] = useState("");
  const gate = useRef(createRequestGate());
  async function load(keepMessage = false) {
    const ticket = gate.current.next();
    setLoading(true); setError(""); if (!keepMessage) setMessage("");
    try { const result = await api.payroll(month, userId); if (ticket.isCurrent()) setData(result); }
    catch (e) { if (ticket.isCurrent()) { setData(null); setError(toErrorMessage(e)); } }
    finally { if (ticket.isCurrent()) setLoading(false); }
  }
  useEffect(() => { setData(null); void load(); return () => { gate.current.next(); }; }, [month, userId]);
  const t = data?.totals;
  return <>
    <section className="card payroll-filter">
      <div className="payroll-month-row">
        <button type="button" className={month === shiftMonth(today) ? "" : "secondary"} onClick={() => setMonth(shiftMonth(today))}>本月</button>
        <button type="button" className={month === shiftMonth(today, -1) ? "" : "secondary"} onClick={() => setMonth(shiftMonth(today, -1))}>上月</button>
        <input aria-label="工资月份" type="month" value={month} onChange={e => { if (isPayMonth(e.target.value)) setMonth(e.target.value); }} />
      </div>
      <Field label="员工"><select value={userId} onChange={e => setUserId(e.target.value)}><option value="">全部员工</option>{employees.map(e => <option key={e.id} value={e.id}>{e.displayName} · {roleLabel[e.role]}{!e.isActive ? "（已停用）" : ""}</option>)}</select></Field>
    </section>
    {error && <p className="error" role="alert">{error} <button className="secondary" onClick={() => void load()}>重试</button></p>}
    {message && <p className="success" role="status">{message}</p>}
    <section className="card payroll-totals" aria-label="工资单合计">
      <div className="payroll-net"><small>{month} 实发合计 · 人民币</small><strong className={t?.netNegative ? "negative" : ""}>{t ? `¥ ${t.net}` : loading ? "核算中…" : "—"}</strong></div>
      <dl className="payroll-breakdown">
        <div><dt>底薪</dt><dd>{t ? t.base : "—"}</dd></div>
        <div><dt>提成</dt><dd>{t ? `+${t.commission}` : "—"}</dd></div>
        <div><dt>奖金</dt><dd>{t ? `+${t.bonus}` : "—"}</dd></div>
        <div><dt>扣款</dt><dd>{t ? `−${t.deduction}` : "—"}</dd></div>
      </dl>
      {t && <p className="notice">{t.employeeCount} 人 · 已锁定 {t.lockedCount} 人{t.negativeCount ? <> · <b className="negative">{t.negativeCount} 人实发为负，需财务核对</b></> : null}</p>}
    </section>
    {data && data.roles.length > 1 && <section className="card"><h2>各岗位合计</h2>{data.roles.map(r => <article key={r.role} className="commerce-record"><span><strong>{roleLabel[r.role]}</strong><small>{r.employeeCount} 人 · 底薪 {r.base} · 提成 {r.commission} · 奖金 {r.bonus} · 扣款 {r.deduction}</small></span><span className={`commerce-amount ${r.netNegative ? "negative" : ""}`}>¥ {r.net}<small>实发</small></span></article>)}</section>}
    <section className="card">
      <h2>员工工资单</h2>
      {data && !data.employees.length && <p>本月暂无工资标准或工资项目。{readOnly ? "" : "先在“工资标准”登记底薪，或选择员工后录入项目。"}</p>}
      {data?.employees.map(emp => <EmployeeSlip key={emp.userId} emp={emp} month={month} readOnly={readOnly} open={open === emp.userId} onToggle={() => setOpen(open === emp.userId ? "" : emp.userId)} onSaved={async text => { setMessage(text); await load(true); }} />)}
      {data && <p className="notice">{data.note}</p>}
    </section>
  </>;
}

function EmployeeSlip({ emp, month, readOnly, open, onToggle, onSaved }: { emp: PayrollEmployee; month: string; readOnly: boolean; open: boolean; onToggle: () => void; onSaved: (text: string) => Promise<void> }) {
  const locked = emp.status === "locked", canEdit = !readOnly && !locked;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [draft, setDraft] = useState<ItemDraft>(emptyDraft), key = useRef(submissionKey());
  const [action, setAction] = useState<{ item: PayrollItem; mode: "void" | "correct"; reason: string; draft: ItemDraft } | null>(null), correctKey = useRef(submissionKey());
  const [unlockReason, setUnlockReason] = useState(""), [unlocking, setUnlocking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setAction(null); setError(""); setUnlocking(false); }, [emp.status, emp.statusVersion, month]);
  async function run(task: () => Promise<unknown>, text: string, after?: () => void) {
    if (busy) return; setBusy(true); setError("");
    try { await task(); after?.(); await onSaved(`${emp.displayName}：${text}`); }
    catch (e) { setError(toErrorMessage(e)); requestAnimationFrame(() => panelRef.current?.querySelector(".error")?.scrollIntoView({ block: "nearest" })); }
    finally { setBusy(false); }
  }
  function addItem(e: FormEvent) {
    e.preventDefault();
    const amountError = payrollAmountError(draft.amount); if (amountError) { setError(amountError); return; }
    const body = { userId: emp.userId, month, ...draft, amount: draft.amount.trim(), note: draft.note.trim() };
    void run(() => api.createPayrollItem({ ...body, requestKey: key.current(body) }), `已录入${payrollKindLabel[draft.kind]}`, () => { key.current = submissionKey(); setDraft(emptyDraft()); });
  }
  function submitAction(e: FormEvent) {
    e.preventDefault(); if (!action) return;
    if (action.mode === "void") { void run(() => api.voidPayrollItem(action.item.id, { version: action.item.version, reason: action.reason.trim() }), "项目已作废", () => setAction(null)); return; }
    const amountError = payrollAmountError(action.draft.amount); if (amountError) { setError(amountError); return; }
    const body = { ...action.draft, amount: action.draft.amount.trim(), note: action.draft.note.trim(), version: action.item.version, reason: action.reason.trim() };
    void run(() => api.correctPayrollItem(action.item.id, { ...body, requestKey: correctKey.current({ id: action.item.id, ...body }) }), "项目已更正（原项目作废留痕）", () => { correctKey.current = submissionKey(); setAction(null); });
  }
  const active = emp.items.filter(i => !i.voided), voided = emp.items.filter(i => i.voided);
  return <article className={`payroll-slip ${emp.netNegative ? "is-negative" : ""}`}>
    <button type="button" className="payroll-slip-head" aria-expanded={open} onClick={onToggle}>
      <span><strong>{emp.displayName}</strong><small>{roleLabel[emp.role]}{!emp.isActive ? " · 已停用" : ""} · <span className={`payroll-badge ${locked ? "locked" : ""}`}>{locked ? "已锁定" : "草稿"}</span></small></span>
      <span className={`commerce-amount ${emp.netNegative ? "negative" : ""}`}>¥ {emp.net}<small>{emp.netNegative ? "实发为负·待核对" : "实发"}</small></span>
    </button>
    {open && <div className="payroll-slip-body" ref={panelRef}>
      <dl className="payroll-breakdown">
        <div><dt>底薪</dt><dd>{emp.base}</dd></div><div><dt>提成</dt><dd>+{emp.commission}</dd></div>
        <div><dt>奖金</dt><dd>+{emp.bonus}</dd></div><div><dt>扣款</dt><dd>−{emp.deduction}</dd></div>
      </dl>
      {emp.netNegative && <p className="error">扣款大于应发，实发为负数。系统不自动截断为 0，请财务核对扣款或跨月处理。</p>}
      {locked && emp.changedAfterLock && <p className="error">锁定后工资标准有变动：锁定金额底薪 {emp.base}、实发 {emp.net}；按现行标准应为底薪 {emp.liveBase}、实发 {emp.liveNet}。如需更新请财务解锁后重新锁定。</p>}
      <h3>底薪来源</h3>
      {!emp.baseRecords.length && <p className="notice">本月无工资标准，底薪为 0。</p>}
      {emp.baseRecords.map(r => <p key={r.id} className="payroll-line"><span>月薪 {r.monthlyAmount}<small>{r.effectiveFrom} 至 {r.effectiveTo ?? "长期"}</small></span><b>{r.allocated}</b></p>)}
      <h3>提成 / 奖金 / 扣款明细</h3>
      {!active.length && <p className="notice">暂无有效项目。</p>}
      {active.map(item => <div key={item.id} className="payroll-item">
        <p className="payroll-line"><span><b>{payrollKindLabel[item.kind]}</b> · {item.note}<small>{item.createdByName} · {new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}{item.correctsId ? " · 更正项" : ""}</small></span><b className={item.kind === "deduction" ? "negative" : ""}>{signedLabel(item.kind, item.amount)}</b></p>
        {canEdit && <div className="payroll-item-actions"><button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); setAction({ item, mode: "correct", reason: "", draft: { kind: item.kind, amount: item.amount, note: item.note } }); }}>更正</button><button type="button" className="secondary" disabled={busy} onClick={() => { setError(""); setAction({ item, mode: "void", reason: "", draft: emptyDraft() }); }}>作废</button></div>}
        {action?.item.id === item.id && <form className="payroll-inline-form" onSubmit={submitAction}>
          {action.mode === "correct" && <ItemFields value={action.draft} onChange={d => setAction({ ...action, draft: d })} />}
          <Field label={action.mode === "void" ? "作废原因（必填）" : "更正原因（必填）"}><input required maxLength={500} value={action.reason} onChange={e => setAction({ ...action, reason: e.target.value })} /></Field>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="payroll-item-actions"><button disabled={busy}>{busy ? "保存中…" : action.mode === "void" ? "确认作废" : "保存更正"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { setAction(null); setError(""); }}>取消</button></div>
        </form>}
      </div>)}
      {voided.length > 0 && <details className="payroll-voided"><summary>已作废 {voided.length} 条（保留留痕，不计入）</summary>{voided.map(item => <p key={item.id} className="payroll-line commerce-void"><span><s>{payrollKindLabel[item.kind]} · {item.note}</s><small>作废：{item.voidReason}{item.voidedByName ? ` · ${item.voidedByName}` : ""}{item.correctedById ? " · 已由更正项替代" : ""}</small></span><s>{signedLabel(item.kind, item.amount)}</s></p>)}</details>}
      {canEdit && !action && <form className="payroll-inline-form payroll-add" onSubmit={addItem}>
        <h3>＋ 录入项目</h3>
        <ItemFields value={draft} onChange={setDraft} />
        {error && <p className="error" role="alert">{error}</p>}
        <button disabled={busy}>{busy ? "保存中…" : "保存项目"}</button>
      </form>}
      {!readOnly && <div className="payroll-lock">
        {!locked && <button type="button" className="secondary" disabled={busy || !!action} onClick={() => { if (window.confirm(`锁定 ${emp.displayName} ${month} 工资单？锁定后不能再改项目。`)) void run(() => api.payrollMonthAction("lock", { userId: emp.userId, month, version: emp.statusVersion }), "工资单已锁定"); }}>锁定本月工资单</button>}
        {locked && !unlocking && <button type="button" className="secondary" disabled={busy} onClick={() => { setUnlocking(true); setUnlockReason(""); setError(""); }}>解锁修改</button>}
        {locked && unlocking && <form className="payroll-inline-form" onSubmit={e => { e.preventDefault(); void run(() => api.payrollMonthAction("unlock", { userId: emp.userId, month, version: emp.statusVersion, reason: unlockReason.trim() }), "已解锁，可修改项目"); }}>
          <Field label="解锁原因（必填）"><input required maxLength={500} value={unlockReason} onChange={e => setUnlockReason(e.target.value)} /></Field>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="payroll-item-actions"><button disabled={busy}>确认解锁</button><button type="button" className="secondary" onClick={() => setUnlocking(false)}>取消</button></div>
        </form>}
        {locked && !unlocking && error && <p className="error" role="alert">{error}</p>}
      </div>}
      {readOnly && <p className="notice">BOSS 只读；项目由财务录入和锁定。</p>}
    </div>}
  </article>;
}

function ItemFields({ value, onChange }: { value: ItemDraft; onChange: (v: ItemDraft) => void }) {
  return <div className="grid two">
    <Field label="类型"><select value={value.kind} onChange={e => onChange({ ...value, kind: e.target.value as PayrollKind })}><option value="commission">提成</option><option value="bonus">奖金</option><option value="deduction">扣款</option></select></Field>
    <Field label="金额 · 人民币（正数）"><input required inputMode="decimal" placeholder="例如 300.00" value={value.amount} onChange={e => onChange({ ...value, amount: e.target.value })} /></Field>
    <Field label="备注（必填，如项目或依据）"><input required maxLength={500} value={value.note} onChange={e => onChange({ ...value, note: e.target.value })} /></Field>
  </div>;
}
