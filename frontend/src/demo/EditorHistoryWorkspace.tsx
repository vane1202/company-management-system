import { useEffect, useState } from "react";
import { Field } from "../OrderWorkspace";
import { editorFields, editorNote } from "../dailyDetail";
import { editorNames } from "../productionGroups";
import "./customer-fill.css";
import "./editor-history.css";

type Line = Record<keyof typeof editorFields, string> & { personaName: string; note: string };
type SavedLine = Record<keyof typeof editorFields, number> & { personaName: string; note: string };
type Snapshot = { businessDate: string; lines: SavedLine[] };
type EditRecord = Snapshot & { id: string; editorName: string; version: number; sample: boolean; updatedAt: string; history: { at: string; actor: string; action: string; reason: string; before: Snapshot | null; after: Snapshot }[] };
const blank = (): Line => ({ personaName: "", shootCount: "", editCount: "", sentToOpsCount: "", inventorySnapshot: "", note: "" });
const keys = Object.keys(editorFields) as (keyof typeof editorFields)[];
const integer = (value: string) => /^\d{1,7}$/.test(value);
async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) throw Error(data.error || "拍剪日报操作失败"); return data;
}
const errorText = (cause: unknown) => cause instanceof Error ? cause.message : "拍剪日报操作失败";

export default function EditorHistoryWorkspace({ today }: { today: string }) {
  const [editor, setEditor] = useState("");
  const [pendingEditor, setPendingEditor] = useState<string | null>(null), [pendingView, setPendingView] = useState<"fill" | "history" | null>(null);
  const [view, setView] = useState<"fill" | "history">("fill");
  const [businessDate, setBusinessDate] = useState(today), [lines, setLines] = useState<Line[]>([blank()]);
  const [reviewed, setReviewed] = useState(false), [reason, setReason] = useState("");
  const [editing, setEditing] = useState<EditRecord | null>(null), [records, setRecords] = useState<EditRecord[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: "", to: "", persona: "" });
  const dirty = !!editing || lines.some(line => line.personaName.trim() || line.note.trim() || keys.some(key => line[key] !== ""));
  const names = lines.map(line => line.personaName.trim()).filter(Boolean), duplicate = names.length !== new Set(names).size;
  const complete = Boolean(editor && businessDate) && businessDate <= today && lines.length > 0 && lines.every(line => line.personaName.trim() && keys.every(key => integer(line[key]))) && !duplicate;
  const sum = (key: keyof typeof editorFields) => lines.every(line => integer(line[key])) ? lines.reduce((total, line) => total + Number(line[key]), 0) : null;
  useEffect(() => { let live = true; request<{ editor: string }>("/api/demo/editor-identity").then(data => { if (live) setEditor(data.editor); }).catch(cause => { if (live) setError(errorText(cause)); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  useEffect(() => {
    if (!editor) { setRecords([]); return; }
    let live = true; setLoading(true); setRecords([]);
    request<{ records: EditRecord[] }>("/api/demo/editor-history").then(data => { if (live) setRecords(data.records); }).catch(cause => { if (live) setError(errorText(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [editor]);
  function resetForm() { setLines([blank()]); setBusinessDate(today); setEditing(null); setReason(""); setReviewed(false); }
  async function selectEditor(next: string) {
    if (!next) { setEditor(""); resetForm(); return; }
    setBusy(true); setError("");
    try { await request("/api/demo/editor-identity", { editor: next }); setEditor(next); setPendingEditor(null); setPendingView(null); setNotice(""); resetForm(); setFilters({ from: "", to: "", persona: "" }); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function choose(next: string) { if (next === editor) return; if (dirty) setPendingEditor(next); else void selectEditor(next); }
  function navigate(next: "fill" | "history") { if (next === view && !editing) return; if (dirty) setPendingView(next); else { resetForm(); setView(next); } }
  function update(index: number, patch: Partial<Line>) { setLines(lines.map((line, item) => item === index ? { ...line, ...patch } : line)); setReviewed(false); }
  function openRecord(record: EditRecord) {
    setEditing(record); setBusinessDate(record.businessDate); setLines(record.lines.map(line => ({ personaName: line.personaName, note: line.note, shootCount: String(line.shootCount), editCount: String(line.editCount), sentToOpsCount: String(line.sentToOpsCount), inventorySnapshot: String(line.inventorySnapshot) }))); setReason(""); setReviewed(false); setError(""); setNotice(""); setView("fill"); window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function save() {
    if (!complete || busy || !reviewed) return;
    setBusy(true); setError("");
    try {
      const data = await request<{ records: EditRecord[] }>("/api/demo/editor-history", { id: editing?.id, version: editing?.version, businessDate, lines, reason });
      setRecords(data.records); setNotice(editing ? "历史日报已更新，修改前后内容已留存。仅保存在当前浏览器会话。" : "日报已登记，可在历史填报管理中查看或修改。仅保存在当前浏览器会话。"); resetForm(); setView("history");
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const visible = records.filter(record => (!filters.from || record.businessDate >= filters.from) && (!filters.to || record.businessDate <= filters.to) && (!filters.persona || record.lines.some(line => line.personaName === filters.persona)));
  const personas = [...new Set(records.flatMap(record => record.lines.map(line => line.personaName)))];
  return <main className="customer-fill editor-fill"><header><p className="eyebrow">拍剪组 · 日常填报</p><h1>拍剪工作台</h1><p className="notice">演示按所选拍剪师查看和修改。业务样本为虚构；新增与修改仅在当前浏览器会话内保留，不写入正式后台。</p></header>
    <section className="card fill-account"><Field label="当前拍剪师"><select aria-label="拍剪师" disabled={busy} value={editor} onChange={event => choose(event.target.value)}><option value="">请选择拍剪师</option>{editorNames.map(name => <option key={name}>{name}</option>)}</select></Field>
      {pendingEditor !== null && <div role="alert"><p>切换拍剪师会放弃尚未保存的填写或修改。</p><div className="actions"><button type="button" disabled={busy} onClick={() => void selectEditor(pendingEditor)}>确认切换并清空</button><button type="button" className="secondary" onClick={() => setPendingEditor(null)}>保留当前拍剪师</button></div></div>}
      {pendingView && <div role="alert"><p>当前有未保存内容，是否放弃并切换页面？</p><button type="button" onClick={() => { resetForm(); setView(pendingView); setPendingView(null); }}>放弃并切换</button><button type="button" className="secondary" onClick={() => setPendingView(null)}>继续填写</button></div>}
    </section>
    <nav className="editor-fill-tabs" aria-label="拍剪工作台导航"><button type="button" aria-pressed={view === "fill"} disabled={busy} onClick={() => navigate("fill")}>{editing ? "修改日报" : "每日填报"}</button><button type="button" aria-pressed={view === "history"} disabled={busy} onClick={() => navigate("history")}>历史填报管理</button></nav>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
    {!editor ? <section className="card fill-empty"><strong>先选择拍剪师</strong><p>选好后即可填写今日拍摄、剪辑和囤量。</p></section> : loading ? <p role="status">正在读取本人填报历史…</p> : view === "history" ? <section className="card editor-report-history" aria-label="本人拍剪填报历史"><h2>{editor}的填报历史</h2><div className="grid two fill-filter-grid"><Field label="开始日期"><input type="date" max={filters.to || today} value={filters.from} onChange={event => setFilters({ ...filters, from: event.target.value })} /></Field><Field label="结束日期"><input type="date" min={filters.from} max={today} value={filters.to} onChange={event => setFilters({ ...filters, to: event.target.value })} /></Field><Field label="人设／主页"><select value={filters.persona} onChange={event => setFilters({ ...filters, persona: event.target.value })}><option value="">全部人设</option>{personas.map(persona => <option key={persona}>{persona}</option>)}</select></Field></div><button type="button" className="secondary fill-clear" onClick={() => setFilters({ from: "", to: "", persona: "" })}>清除筛选</button><p className="hint">{visible.length}份日报 · 囤量为当日快照，不跨日期累加</p>
      {visible.map(record => <article className="editor-history-record" key={record.id}><header><div><strong>{record.businessDate}</strong><small>{record.lines.length}个人设 · 版本{record.version}{record.sample ? " · 演练样本" : ""}</small></div><button type="button" className="secondary" onClick={() => openRecord(record)}>查看／修改</button></header>{record.lines.map(line => <div className="editor-history-line" key={line.personaName}><strong>{line.personaName}</strong><span>拍摄 {line.shootCount} · 剪辑 {line.editCount} · 发给运营 {line.sentToOpsCount} · 囤量 {line.inventorySnapshot}</span>{line.note && <small>{line.note}</small>}</div>)}<details><summary>修改记录 · {record.history.filter(item => item.action === "correct").length}次</summary>{record.history.length ? record.history.map((item, index) => <section key={index} className="editor-change"><p>{item.at.replace("T", " ").slice(0, 19)} UTC · {item.actor}</p><p>{item.reason}</p>{item.before && <SnapshotBlock title="修改前" snapshot={item.before} />}<SnapshotBlock title={item.before ? "修改后" : "登记内容"} snapshot={item.after} /></section>) : <p className="hint">该演练样本尚无修改。</p>}</details></article>)}{!visible.length && <p className="empty-state">该范围没有本人填报记录。</p>}
    </section> : <form className="card editor-daily-form" onSubmit={event => { event.preventDefault(); if (complete) setReviewed(true); }}><h2>{editing ? "修改历史日报" : "拍剪日报"}</h2><p className="notice">{editorNote}发给运营不等于已发布。</p><fieldset disabled={busy}><Field label="业务日"><input required aria-label="业务日" type="date" max={today} value={businessDate} onChange={event => { setBusinessDate(event.target.value); setReviewed(false); }} /></Field>
      {lines.map((line, index) => <fieldset className="fill-line" key={index}><legend>人设 {index + 1}</legend><Field label="人设／主页"><input required aria-label={"第 " + (index + 1) + " 个人设"} maxLength={128} value={line.personaName} onChange={event => update(index, { personaName: event.target.value })} /></Field><div className="grid two fill-num-grid">{keys.map(key => <Field key={key} label={editorFields[key]}><input required aria-label={"第 " + (index + 1) + " 个" + editorFields[key]} inputMode="numeric" pattern="[0-9]{1,7}" value={line[key]} onChange={event => update(index, { [key]: event.target.value })} /></Field>)}</div><Field label="备注（可选）"><textarea maxLength={500} value={line.note} onChange={event => update(index, { note: event.target.value })} /></Field>{lines.length > 1 && <button type="button" className="secondary fill-remove" onClick={() => { setLines(lines.filter((_, item) => item !== index)); setReviewed(false); }}>移除此人设</button>}</fieldset>)}
      <button type="button" className="secondary fill-add" disabled={lines.length >= 20} onClick={() => { setLines([...lines, blank()]); setReviewed(false); }}>＋ 再填一个人设</button>{duplicate && <p className="error" role="alert">同一日期的人设不能重复，请合并后再登记。</p>}
      <div className="fill-totals">{keys.map(key => <span key={key}>{editorFields[key]} <strong>{sum(key) ?? "—"}</strong></span>)}</div>
      {editing && <Field label="修改原因"><textarea required aria-label="修改原因" maxLength={300} value={reason} onChange={event => { setReason(event.target.value); setReviewed(false); }} /></Field>}
      <button type="submit">核对填报内容</button></fieldset>{reviewed && <section className="editor-save-confirm" aria-label="日报保存确认"><p>{editor} · {businessDate} · {lines.length}个人设。{editing ? "修改前后内容将保留。" : "该日已有记录时请改用历史修改。"}</p><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : editing ? "确认修改" : "确认登记"}</button></section>}
    </form>}
  </main>;
}

function SnapshotBlock({ title, snapshot }: { title: string; snapshot: Snapshot }) { return <div className="editor-snapshot"><b>{title} · {snapshot.businessDate}</b>{snapshot.lines.map(line => <p key={line.personaName}>{line.personaName}：拍摄{line.shootCount}、剪辑{line.editCount}、发给运营{line.sentToOpsCount}、囤量{line.inventorySnapshot}{line.note ? "；" + line.note : ""}</p>)}</div>; }
