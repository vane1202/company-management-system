import { useEffect, useState } from "react";
import OpsIdentity from "./OpsIdentity";
import { opsRequest, type OpsFeedbackRecord, type OpsWorkspace } from "./opsWorkspace";
import "./ops-workspace.css";

const categories = { lead_quality: "客资质量", creative: "素材表现", strategy: "投放策略", page: "主页问题", other: "其他" };
const statuses = { pending: "待跟进", progress: "跟进中", done: "已完成" };
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "反馈操作失败";

export default function OpsFeedback({ today }: { today: string }) {
  const [workspace, setWorkspace] = useState<OpsWorkspace | null>(null), [records, setRecords] = useState<OpsFeedbackRecord[]>([]), [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [readingFiles, setReadingFiles] = useState(false);
  const [view, setView] = useState<"write" | "list">("write");
  const [form, setForm] = useState(() => {
    let account = ""; try { account = sessionStorage.getItem("cms-demo-ops-feedback-context") || ""; sessionStorage.removeItem("cms-demo-ops-feedback-context"); } catch { /* Optional chart context. */ }
    return { account, persona: "", from: today, to: today, date: today, category: "lead_quality", problem: "", suggestion: "" };
  });
  const [attachments, setAttachments] = useState<{ name: string; data: string }[]>([]);
  const [filters, setFilters] = useState({ account: "", persona: "", from: "", to: "", status: "" });
  const [editing, setEditing] = useState(""), [followup, setFollowup] = useState(""), [status, setStatus] = useState<OpsFeedbackRecord["status"]>("pending");
  useEffect(() => { const controller = new AbortController(); Promise.all([opsRequest<OpsWorkspace>("/api/demo/ops-workspace", undefined, controller.signal), opsRequest<{ records: OpsFeedbackRecord[] }>("/api/demo/ops-feedback", undefined, controller.signal)]).then(([config, data]) => { setWorkspace(config); setRecords(data.records); setForm(previous => ({ ...previous, account: config.accounts.some(item => item.id === previous.account) ? previous.account : "" })); }).catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);
  const accounts = workspace?.accounts || [];
  const personas = [...new Set(accounts.flatMap(account => account.personas))];
  const formPersonas = [...new Set(accounts.filter(account => !form.account || account.id === form.account).flatMap(account => account.personas))];
  const visible = records.filter(record => (!filters.account || record.account === filters.account) && (!filters.persona || record.persona === filters.persona) && (!filters.from || record.date >= filters.from) && (!filters.to || record.date <= filters.to) && (!filters.status || record.status === filters.status)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function readFiles(files: File[]) {
    setError(""); setReadingFiles(true);
    try {
      if (files.length > 3 || files.some(file => file.size > 300 * 1024 || !["image/png", "image/jpeg", "image/webp"].includes(file.type))) throw Error("最多3张PNG、JPEG或WebP截图，每张不超过300KB");
      const images = await Promise.all(files.map(file => new Promise<{ name: string; data: string }>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name.slice(0, 120), data: String(reader.result) }); reader.onerror = () => reject(Error("截图读取失败")); reader.readAsDataURL(file); })));
      setAttachments(images);
    } catch (cause) { setAttachments([]); setError(errorText(cause)); }
    finally { setReadingFiles(false); }
  }
  async function save(body: Record<string, unknown>) {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try {
      const result = await opsRequest<{ records: OpsFeedbackRecord[]; message: string }>("/api/demo/ops-feedback", body);
      setRecords(result.records); setNotice(result.message); setEditing(""); setView("list");
      if (!body.kind) { setForm(previous => ({ ...previous, problem: "", suggestion: "" })); setAttachments([]); }
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  }

  return <section className="ops-feedback"><OpsIdentity /><header className="desk-heading"><div><p className="eyebrow">运营 · 本人反馈</p><h1>反馈与建议</h1></div></header>
    <nav className="analysis-tabs" aria-label="反馈视图"><button type="button" aria-pressed={view === "write"} onClick={() => setView("write")}>填写反馈</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>我的反馈 · {records.length}</button></nav>
    {notice && <p className="notice" role="status">{notice}</p>}{error && <p className="error" role="alert">{error}</p>}{loading && <p role="status">正在读取运营反馈…</p>}
    {!loading && workspace && (view === "write" ? <form className="card ops-feedback-form" onSubmit={event => { event.preventDefault(); void save({ ...form, attachments }); }}>
      <div className="grid two"><label className="row">广告账户<select value={form.account} onChange={event => setForm({ ...form, account: event.target.value, persona: "" })}><option value="">不指定账户</option>{accounts.map(account => <option key={account.id}>{account.id}</option>)}</select></label><label className="row">人设／主页<select value={form.persona} onChange={event => setForm({ ...form, persona: event.target.value })}><option value="">不指定人设</option>{formPersonas.map(persona => <option key={persona}>{persona}</option>)}</select></label><label className="row">反馈类型<select value={form.category} onChange={event => setForm({ ...form, category: event.target.value })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="row">反馈日期<input required type="date" max={today} value={form.date} onChange={event => setForm({ ...form, date: event.target.value })} /></label><label className="row">观察开始日期<input required type="date" max={form.to} value={form.from} onChange={event => setForm({ ...form, from: event.target.value })} /></label><label className="row">观察结束日期<input required type="date" min={form.from} max={today} value={form.to} onChange={event => setForm({ ...form, to: event.target.value })} /></label></div>
      <p className="hint">广告账户与人设至少选择一项。提交人：{workspace.current.name}</p>
      <label className="row">发现的问题<textarea required maxLength={1500} rows={4} value={form.problem} onChange={event => setForm({ ...form, problem: event.target.value })} /></label><label className="row">调整建议<textarea required maxLength={1500} rows={4} value={form.suggestion} onChange={event => setForm({ ...form, suggestion: event.target.value })} /></label>
      <label className="row">截图附件（选填）<input type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={event => void readFiles(Array.from(event.target.files || []))} /><small>最多3张，每张300KB以内；仅保留在本次浏览器会话。</small></label>
      {!!attachments.length && <div className="ops-feedback-images">{attachments.map((file, index) => <img key={index} src={file.data} alt={file.name} />)}<button type="button" className="secondary" onClick={() => setAttachments([])}>移除截图</button></div>}
      <button type="submit" disabled={busy || readingFiles}>{busy ? "提交中…" : readingFiles ? "读取截图…" : "提交反馈"}</button>
    </form> : <><details className="card ops-feedback-filters"><summary>筛选反馈 · {visible.length}条</summary><div className="grid two"><label className="row">广告账户<select value={filters.account} onChange={event => setFilters({ ...filters, account: event.target.value })}><option value="">全部账户</option>{accounts.map(account => <option key={account.id}>{account.id}</option>)}</select></label><label className="row">人设／主页<select value={filters.persona} onChange={event => setFilters({ ...filters, persona: event.target.value })}><option value="">全部人设</option>{personas.map(persona => <option key={persona}>{persona}</option>)}</select></label><label className="row">状态<select value={filters.status} onChange={event => setFilters({ ...filters, status: event.target.value })}><option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="row">开始日期<input type="date" value={filters.from} max={filters.to || today} onChange={event => setFilters({ ...filters, from: event.target.value })} /></label><label className="row">结束日期<input type="date" min={filters.from} max={today} value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></label></div><button type="button" className="secondary" onClick={() => setFilters({ account: "", persona: "", from: "", to: "", status: "" })}>清除筛选</button></details>
      {!visible.length && <p className="empty-state">当前没有符合条件的反馈。</p>}{visible.map(record => <article key={record.id} className="card ops-feedback-record"><header><strong>{categories[record.category as keyof typeof categories]}</strong><span>{statuses[record.status]}</span></header><p className="hint">{record.date} · {record.authorName} · {record.account || "仅关联人设"}{record.persona ? " · " + record.persona : ""}</p><p className="hint">观察周期：{record.from} 至 {record.to}</p><h3>发现的问题</h3><p>{record.problem}</p><h3>调整建议</h3><p>{record.suggestion}</p>{!!record.attachments.length && <details><summary>截图 · {record.attachments.length}</summary><div className="ops-feedback-images">{record.attachments.map((file, index) => <img key={index} src={file.data} alt={file.name} />)}</div></details>}{record.followup && <><h3>跟进措施／结果</h3><p>{record.followup}</p></>}
        {editing === record.id ? <div className="ops-feedback-followup"><label className="row">处理状态<select value={status} onChange={event => setStatus(event.target.value as typeof status)}>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="row">跟进措施／结果<textarea maxLength={1500} rows={3} value={followup} onChange={event => setFollowup(event.target.value)} /></label><button type="button" disabled={busy} onClick={() => void save({ kind: "followup", id: record.id, status, followup })}>保存跟进</button><button type="button" className="secondary" onClick={() => setEditing("")}>取消</button></div> : <button type="button" className="secondary" onClick={() => { setEditing(record.id); setStatus(record.status); setFollowup(record.followup); }}>更新跟进</button>}
      </article>)}</>)}
  </section>;
}
