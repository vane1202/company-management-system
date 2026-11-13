import { useEffect, useState } from "react";
import { api, type CsAccount } from "../api";
import { toErrorMessage } from "../errors";
import { Field } from "../OrderWorkspace";
import { applyHandover, attendanceShare, cohortFacts, shareLabel, type AssessmentFoundation, type EmployeeRecord } from "./assessmentFoundation";

export default function AccountTenurePanel({ accounts }: { accounts: CsAccount[] }) {
  const [data, setData] = useState<AssessmentFoundation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState("");
  const [preview, setPreview] = useState<AssessmentFoundation["tenures"] | null>(null);
  const [previewError, setPreviewError] = useState("");
  async function load() {
    setLoading(true);
    try { setData(await api.assessmentFoundation()); setError(""); }
    catch (cause) { setError(toErrorMessage(cause)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const employees = data?.employees ?? [];
  const tenures = preview ?? data?.tenures ?? [];
  const nameOf = (id: string) => employees.find((item) => item.id === id);
  const accountName = (id: string) => accounts.find((item) => item.id === id)?.wechatId || id;
  const facts = cohortFacts(data?.leads ?? []);
  function personLabel(employee: EmployeeRecord | undefined) { return employee ? employee.name + " · " + employee.code + (employee.status === "left" ? " · 已离任" : "") : "使用人待核对"; }
  return <section className="card" aria-label="账号使用历史"><div className="desk-section-heading"><h2>账号使用历史</h2><button type="button" className="secondary" disabled={loading} onClick={() => void load()}>刷新</button></div>
    {loading && <p className="notice">正在读取员工编号和使用期间。</p>}
    {error && <p className="error" role="alert">{error}<button type="button" onClick={() => void load()}>重试</button></p>}
    {data && <p className="notice">{data.note}</p>}
    {data?.view === "directory" && <div className="grid two">{employees.map((employee) => <article className="review-card" key={employee.id}><h3>{employee.name}</h3><p>{employee.code} · {employee.status === "left" ? "已离任" : "在职"}</p></article>)}</div>}
    {tenures.map((tenure) => <article className="review-card" key={tenure.id}><h3>{accountName(tenure.accountId)}</h3><p>{personLabel(nameOf(tenure.employeeId))}</p><p>{tenure.startDate} 至 {tenure.endDate || "仍在使用"}{preview ? " · 本地预览" : ""}</p></article>)}
    {data?.view === "review" && <>
      <h3>封存的承接示例</h3>
      {facts.map((fact) => <article className="review-card" key={fact.employeeId + fact.businessDate}><h3>{personLabel(nameOf(fact.employeeId))} · {fact.businessDate}</h3><p>承接 {fact.received} 人 · 正常沟通 {fact.replied} 人 · 明确需求 {fact.qualified} 人</p><p>开口转化率 {fact.openingRate ? shareLabel(fact.qualified, fact.replied) : "正常沟通为0"} · 无效粉 {fact.invalid} 人，不进入分母</p></article>)}
      <h3>入场与开单关联</h3>
      {(data.attendance ?? []).map((item) => <article className="review-card" key={item.id}><h3>{personLabel(nameOf(item.employeeId))} · {item.businessDate} · {item.roomName}</h3><p>入场 {item.enteredCount} 人 · {item.orderLink === "linked" ? "开单率 " + (shareLabel(item.orderedCustomerIds.length, item.enteredCount) ?? "—") : "尚未关联开单客户，开单率不作 0%"}</p><p className="notice">{attendanceShare(item.enteredCount, item.orderedCustomerIds.length, item.orderLink) === null && item.orderLink === "linked" && item.enteredCount === 0 ? "入场为0，不计算比例。" : "封存示例。换人预览不会改写这一条。"}</p></article>)}
      <form onSubmit={(event) => { event.preventDefault(); if (!data.tenures || !employeeId || !accountId || !date) return; const result = applyHandover(data.tenures, { accountId, toEmployeeId: employeeId, date, today: data.today, tenureId: "preview-tenure" }); if ("error" in result) { setPreview(null); setPreviewError(result.error); } else { setPreview(result.tenures); setPreviewError(""); } }}>
        <h3>预览账号交接</h3><p className="notice">公开演示不保存交接。预览只改变之后的使用人，上面的历史示例仍归原员工。</p>
        <div className="grid two"><Field label="接待账号"><select required value={accountId} onChange={(event) => { setAccountId(event.target.value); setPreview(null); }}><option value="">请选择</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.wechatId}</option>)}</select></Field>
          <Field label="接手员工"><select required value={employeeId} onChange={(event) => { setEmployeeId(event.target.value); setPreview(null); }}><option value="">请选择</option>{employees.filter((employee) => employee.status === "active").map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.code}</option>)}</select></Field>
          <Field label="交接日"><input required type="date" max={data.today} value={date} onChange={(event) => { setDate(event.target.value); setPreview(null); }} /></Field></div>
        <button type="submit">生成交接预览</button>
        {previewError && <p className="error" role="alert">{previewError}</p>}
        {preview && <p role="status" className="notice">预览已生成。历史承接和入场仍显示原使用人，没有写入服务器。</p>}
      </form>
    </>}
  </section>;
}
