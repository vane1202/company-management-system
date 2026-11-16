import { useEffect, useState } from "react";
import { toErrorMessage } from "../errors";
import { shiftDate } from "./assessmentFoundation";
import { previewCorrection, reportKinds, type Correction, type HistoryData, type HistoryRecord, type ReportKind } from "./reportHistoryData";
import "./report-history.css";

export default function ReportHistory({ today, accountId = "", kind = "fans", supervisor = false }: { today: string; accountId?: string; kind?: ReportKind; supervisor?: boolean }) {
  const [category, setCategory] = useState(kind);
  const [account, setAccount] = useState(accountId);
  const [range, setRange] = useState({ from: shiftDate(today, -29), to: today });
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [page, setPage] = useState(0);
  const [changes, setChanges] = useState<Correction[]>([]);
  const currentKind = supervisor ? category : kind;
  const currentAccount = supervisor ? account : accountId;
  const validRange = !!range.from && !!range.to && range.from <= range.to && range.to <= today && (Date.parse(range.to) - Date.parse(range.from)) / 86400000 <= 366;
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    setSelectedId("");
    setPage(0);
    if (!validRange) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const query = new URLSearchParams({ kind: currentKind, accountId: currentAccount, ...range });
    fetch("/api/demo/report-history?" + query, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "历史记录暂不可用");
      if (body.demo !== true || !Array.isArray(body.records)) throw Error("历史记录格式不匹配");
      if (!controller.signal.aborted) setData(body);
    }).catch((cause) => { if (!controller.signal.aborted) setError(toErrorMessage(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [currentKind, currentAccount, range.from, range.to, validRange, tick]);
  const records = (data?.records ?? []).map((record) => [...changes].reverse().find((change) => change.record.id === record.id)?.record ?? record);
  const selected = records.find((record) => record.id === selectedId);
  const canEdit = supervisor && data?.canPreviewCorrections === true;
  const lastPage = Math.max(0, Math.ceil(records.length / 10) - 1);
  const currentPage = Math.min(page, lastPage);
  return <section className="card report-history" aria-label="历史填报记录" aria-busy={loading}>
    <header className="rh-heading"><div><h2>{supervisor ? "本组填报历史管理" : reportKinds[currentKind] + "历史"}</h2><span className="hint">{supervisor ? "本组可更正" : "所选接待账号 · 只读"} · {currentAccount.startsWith("registered-") ? "已登记账号" : "虚构业务示例"}</span></div><button type="button" className="secondary" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button></header>
    {supervisor && <div className="rh-categories" role="group" aria-label="历史填报类别">{Object.entries(reportKinds).map(([key, label]) => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key as ReportKind)}>{label}</button>)}</div>}
    <div className="rh-filters">
      {supervisor && <label>接待账号<select aria-label="历史接待账号" value={account} onChange={(event) => setAccount(event.target.value)}><option value="">本组全部</option>{data?.accounts.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
      <label>开始日期<input aria-label="历史开始日期" type="date" max={range.to || today} value={range.from} onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
      <label>结束日期<input aria-label="历史结束日期" type="date" min={range.from} max={today} value={range.to} onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
    </div>
    {!validRange && <p className="error" role="alert">请选择有效日期范围，结束日不晚于今天，最多367天。</p>}
    {error && <p className="error" role="alert">{error}<button type="button" onClick={() => setTick((value) => value + 1)}>重新读取</button></p>}
    {loading ? <p role="status">正在读取历史记录…</p> : selected ? <>
      <button type="button" className="secondary" onClick={() => setSelectedId("")}>← 返回历史列表</button>
      <h3 tabIndex={-1}>{selected.title}</h3>
      <RecordIdentity record={selected} />
      <p className="notice">{selected.source}</p>
      <dl className="rh-fields">{selected.fields.map((field) => <div key={field.key}><dt>{field.label}</dt><dd>{field.value || "未记录"}</dd></div>)}</dl>
      {canEdit ? <CorrectionForm key={selected.id + ":" + selected.version} record={selected} today={today} onPreview={(correction) => setChanges((current) => [...current, correction])} /> : <p className="notice">需要更正时，请联系本组客服主管。</p>}
      {!!changes.filter((change) => change.record.id === selected.id).length && <details className="rh-audit"><summary>本次更正预览记录</summary>{changes.filter((change) => change.record.id === selected.id).map((change) => <article key={change.record.version}><h4>演示客服主管 · {new Date(change.at).toLocaleString("zh-CN")} · V{change.before.version} → V{change.record.version}</h4><p>更正原因：{change.reason}</p><ul>{change.record.fields.filter((field) => field.value !== change.before.fields.find((before) => before.key === field.key)?.value).map((field) => <li key={field.key}>{field.label}：{change.before.fields.find((before) => before.key === field.key)?.value || "空"} → {field.value || "空"}</li>)}</ul></article>)}<button type="button" className="secondary" onClick={() => setChanges((current) => current.filter((change) => change.record.id !== selected.id))}>还原这条预览</button></details>}
    </> : !error && validRange && <>
      <p className="hint">共 {records.length} 条 · 按业务日期排列</p>
      <div className="rh-list">{records.slice(currentPage * 10, (currentPage + 1) * 10).map((record) => <button type="button" className="rh-record secondary" key={record.id} onClick={() => setSelectedId(record.id)}><span><strong>{record.title}</strong><small>{record.businessDate} · {record.employeeName}{record.employeeCode ? " · " + record.employeeCode : ""}</small><small>{record.accountLabel}</small></span><span>{changes.some((change) => change.record.id === record.id) ? "更正预览" : "查看明细"} ›</span></button>)}</div>
      {!records.length && <p className="notice">{currentAccount.startsWith("registered-") ? "此登记账号尚无已保存的填报记录。演示试填不会生成历史。" : "所选账号和日期范围暂无" + reportKinds[currentKind] + "历史。可调整日期或账号；未填报不记为0。"}</p>}
      {lastPage > 0 && <div className="actions"><button type="button" className="secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {lastPage + 1}</span><button type="button" className="secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>下一页</button></div>}
    </>}
  </section>;
}

function RecordIdentity({ record }: { record: HistoryRecord }) {
  return <dl className="rh-fields rh-identity">{[["业务日期", record.businessDate], ["接待账号", record.accountLabel], ["所属小组", record.teamName], ["历史使用人", record.employeeName + (record.employeeCode ? " · " + record.employeeCode : "")]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function CorrectionForm({ record, today, onPreview }: { record: HistoryRecord; today: string; onPreview: (correction: Correction) => void }) {
  const [values, setValues] = useState(() => Object.fromEntries(record.fields.filter((field) => field.editable).map((field) => [field.key, field.value])));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  function preview() {
    const result = previewCorrection(record, values, reason, record.version, "cs_supervisor", today);
    if ("error" in result) { setError(result.error); return; }
    onPreview({ record: result.record, before: record, reason: reason.trim(), at: new Date().toISOString() });
  }
  return <details className="rh-correction"><summary>更正业务明细</summary><p className="notice">演示仅预览更正，刷新后还原，不影响考核与经营汇总。账号、业务日期、历史使用人及财务核定信息保持原记录。</p><form onSubmit={(event) => {
    event.preventDefault();
    preview();
  }}><div className="rh-fields">{record.fields.filter((field) => field.editable).map((field) => <label key={field.key}>{field.label}<input type={field.type === "date" ? "date" : "text"} inputMode={field.type === "count" ? "numeric" : field.type === "money" ? "decimal" : undefined} max={field.type === "date" ? today : undefined} maxLength={1000} value={values[field.key]} onChange={(event) => { setValues({ ...values, [field.key]: event.target.value }); setError(""); }} /></label>)}</div><label>更正原因<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>{error && <p className="error" role="alert">{error}</p>}<button type="button" onClick={(event) => { if (event.currentTarget.form?.reportValidity()) preview(); }}>预览更正（不保存）</button></form></details>;
}
