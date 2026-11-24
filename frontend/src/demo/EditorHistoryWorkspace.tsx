import { useEffect, useRef, useState } from "react";
import { Field } from "../OrderWorkspace";
import { editorFields } from "../dailyDetail";
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
  const [pendingEditor, setPendingEditor] = useState<string | null>(null);
  const [view, setView] = useState<"fill" | "history">("fill");
  const [businessDate, setBusinessDate] = useState(today), [lines, setLines] = useState<Line[]>([blank()]);
  const [reviewed, setReviewed] = useState(false), [reason, setReason] = useState("");
  const [editing, setEditing] = useState<EditRecord | null>(null), [records, setRecords] = useState<EditRecord[]>([]);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: "", to: "", persona: "" });
  const drawer=useRef<HTMLDialogElement>(null);
  const [draftEdit,setDraftEdit]=useState<Line[]>([]);
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
    try { await request("/api/demo/editor-identity", { editor: next }); setEditor(next); setPendingEditor(null); setNotice(""); resetForm(); setFilters({ from: "", to: "", persona: "" }); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  function choose(next: string) { if (next === editor) return; if (dirty) setPendingEditor(next); else void selectEditor(next); }
  function navigate(next: "fill" | "history") { setView(next); }
  function update(index: number, patch: Partial<Line>) { setLines(lines.map((line, item) => item === index ? { ...line, ...patch } : line)); setReviewed(false); }
  const latestByPersona = new Map<string,SavedLine>();
  const currentRecords = [...records].sort((a,b)=>b.businessDate.localeCompare(a.businessDate));
  for(const record of currentRecords){
    if(record.businessDate>=businessDate)continue;
    for(const line of record.lines)if(!latestByPersona.has(line.personaName.trim()))latestByPersona.set(line.personaName.trim(),line);
  }
  const latest = currentRecords.find(record=>record.businessDate<businessDate);
  function applyBaseline(){
    if(!latest)return;
    setLines(current=>[...current.filter(line=>line.personaName.trim()||line.note.trim()||keys.some(key=>line[key]!=="")),
      ...latest.lines.filter(line=>!current.some(existing=>existing.personaName.trim()===line.personaName.trim())).map(line=>({...blank(),personaName:line.personaName,inventorySnapshot:String(line.inventorySnapshot)}))].slice(0,20));
    setReviewed(false);
  }
  function openRecord(record:EditRecord){
    setEditing(record);
    setDraftEdit(record.lines.map(line=>({...line,shootCount:String(line.shootCount),editCount:String(line.editCount),sentToOpsCount:String(line.sentToOpsCount),inventorySnapshot:String(line.inventorySnapshot)})));
    setReason("");setError("");setNotice("");
    drawer.current?.showModal();
  }
  async function saveCorrection(){
    if(!editing||busy||!reason.trim()||!draftEdit.every(line=>keys.every(key=>integer(line[key]))))return;
    setBusy(true);setError("");
    try {
      const data=await request<{records:EditRecord[]}>("/api/demo/editor-history",{id:editing.id,version:editing.version,businessDate:editing.businessDate,lines:draftEdit,reason});
      setRecords(data.records);setNotice("历史日报已更新，修改前后内容已留存。");
      drawer.current?.close();
    } catch(cause){setError(errorText(cause));} finally{setBusy(false);}
  }
  async function save() {
    if (!complete || busy || !reviewed) return;
    setBusy(true); setError("");
    try {
      const data = await request<{ records: EditRecord[] }>("/api/demo/editor-history", {businessDate,lines,reason:""});
      setRecords(data.records); setNotice("日报已登记，可在历史记录与修改中查看。仅保存在当前浏览器会话。"); resetForm(); setView("history");
    } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const visible = records.filter(record => (!filters.from || record.businessDate >= filters.from) && (!filters.to || record.businessDate <= filters.to) && (!filters.persona || record.lines.some(line => line.personaName === filters.persona)));
  const personas = [...new Set(records.flatMap(record => record.lines.map(line => line.personaName)))];
  const submitted = records.find(record=>record.businessDate===today)?.lines.length??0;
  return <main className="customer-fill editor-fill">
    <section className="editor-bar">
      <div><h1>翠管家 · 拍剪工作台</h1><span className="ed-badge">{loading?"正在读取":submitted?`今日已提交 ${submitted} 个人设`:"今日待填报"}</span></div>
      <Field label="当前拍剪师"><select aria-label="拍剪师" disabled={busy} value={editor} onChange={event=>choose(event.target.value)}><option value="">请选择拍剪师</option>{editorNames.map(name=><option key={name}>{name}</option>)}</select></Field>
    </section>
    {pendingEditor!==null&&<div className="card" role="alert"><p>切换拍剪师会放弃尚未保存的填写。</p><div className="actions"><button type="button" disabled={busy} onClick={()=>void selectEditor(pendingEditor)}>确认切换并清空</button><button type="button" className="secondary" onClick={()=>setPendingEditor(null)}>保留当前拍剪师</button></div></div>}
    <nav className="ed-tabs" aria-label="拍剪工作台导航">
      <button type="button" className="secondary" aria-pressed={view==="fill"} disabled={busy} onClick={()=>navigate("fill")}>今日填报</button>
      <button type="button" className="secondary" aria-pressed={view==="history"} disabled={busy} onClick={()=>navigate("history")}>历史记录与修改 ({records.length})</button>
    </nav>
    {error&&!editing&&<p className="error" role="alert">{error}</p>}{notice&&<p className="notice" role="status">{notice}</p>}
    {!editor?<section className="card"><strong>先选择拍剪师</strong></section>:loading?<p role="status">正在读取本人填报历史…</p>:view==="history"?<section className="card editor-report-history" aria-label="本人拍剪填报历史">
      <div className="ed-toolbar">
        <Field label="开始日期"><input type="date" max={filters.to||today} value={filters.from} onChange={event=>setFilters({...filters,from:event.target.value})}/></Field>
        <Field label="结束日期"><input type="date" min={filters.from} max={today} value={filters.to} onChange={event=>setFilters({...filters,to:event.target.value})}/></Field>
      </div>
      <div className="ed-pills" role="group" aria-label="人设筛选">{["",...personas].map(persona=><button type="button" key={persona} className="secondary" aria-pressed={filters.persona===persona} onClick={()=>setFilters({...filters,persona})}>{persona||"全部人设"}</button>)}</div>
      <div className="ed-table-scroll"><table className="ed-table" aria-label="拍剪历史日报">
        <thead><tr>{["业务日","人设／主页","拍摄","剪辑","发给运营","囤量快照","备注","操作"].map(label=><th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{visible.flatMap(record=>record.lines.filter(line=>!filters.persona||line.personaName===filters.persona).map(line=><tr key={record.id+":"+line.personaName}>
          <td>{record.businessDate}</td><th scope="row">{line.personaName}</th>{keys.map(key=><td key={key}>{line[key]}</td>)}<td>{line.note||"—"}</td><td><button type="button" className="text-action" onClick={()=>openRecord(record)}>修改 →</button></td>
        </tr>))}</tbody>
      </table></div>{!visible.length&&<p className="empty-state">该范围没有本人填报记录。</p>}
    </section>:<form className="editor-daily-form" onSubmit={event=>{event.preventDefault();void save();}}>
      <div className="card ed-toolbar">
        <Field label="业务日"><input required type="date" max={today} value={businessDate} onChange={event=>{setBusinessDate(event.target.value);setReviewed(false);}}/></Field>
        <p>库存快照按人设填写截至当日的总存量，不按天累加。</p>
        <div className="actions"><button type="button" className="secondary" disabled={!latest||busy} onClick={applyBaseline}>带出昨日人设与库存基准</button><button type="button" disabled={busy||lines.length>=20} onClick={()=>{setLines([...lines,blank()]);setReviewed(false);}}>＋ 添加人设行</button></div>
      </div>
      <fieldset className="ed-lines" disabled={busy}>
      {lines.map((line,index)=>{
        const name=line.personaName.trim(),missing=keys.find(key=>!integer(line[key]));
        const issue=!name?"请填写人设":names.filter(value=>value===name).length>1?"人设名称重复":missing?`请补全${editorFields[missing]}`:"";
        const baseline=latestByPersona.get(name)?.inventorySnapshot;
        return <section className="line-card" key={index} data-warning={!!issue}>
          <header><strong>人设 #{index+1}</strong><Field label="人设／主页"><input required list="ed-personas" aria-label={`第 ${index+1} 个人设`} maxLength={128} value={line.personaName} onChange={event=>update(index,{personaName:event.target.value})}/></Field><span className="ed-badge" data-warning={!!issue}>{issue||"填写完整"}</span></header>
          <div className="ed-numbers">{keys.map(key=><label className="row" key={key}>{editorFields[key]} {key==="inventorySnapshot"&&baseline!==undefined&&<span className="ed-badge">上次 {baseline}</span>}<input required aria-label={`第 ${index+1} 个${editorFields[key]}`} inputMode="numeric" pattern="[0-9]{1,7}" value={line[key]} onChange={event=>update(index,{[key]:event.target.value})}/></label>)}</div>
          <Field label="备注（可选）"><textarea maxLength={500} value={line.note} onChange={event=>update(index,{note:event.target.value})}/></Field>
          {lines.length>1&&<button type="button" className="secondary" onClick={()=>{setLines(lines.filter((_,item)=>item!==index));setReviewed(false);}}>移除此人设</button>}
        </section>;
      })}
      </fieldset>
      <datalist id="ed-personas">{personas.map(persona=><option key={persona} value={persona}/>)}</datalist>
      <div className="card submit-bar">
        <span>合计拍摄 <b>{sum("shootCount")??"—"}</b> 条 · 合计剪辑 <b>{sum("editCount")??"—"}</b> 条 · 合计交付 <b>{sum("sentToOpsCount")??"—"}</b> 条</span>
        <label><input type="checkbox" checked={reviewed} disabled={busy} onChange={event=>setReviewed(event.target.checked)}/> 已核对今日数据与库存快照无误</label>
        <button type="submit" disabled={busy||!complete||!reviewed}>{busy?"提交中…":"提交今日日报"}</button>
      </div>
    </form>}
    <dialog className="ed-drawer" ref={drawer} aria-label="修改历史日报" onClose={()=>{setEditing(null);setError("");}} onCancel={event=>{if(busy)event.preventDefault();}}>
      {editing&&<form onSubmit={event=>{event.preventDefault();void saveCorrection();}}>
        <header className="ed-toolbar"><h2>修改历史日报</h2><button type="button" className="secondary" disabled={busy} onClick={()=>drawer.current?.close()}>关闭</button></header>
        <p>{editing.businessDate} · 版本 {editing.version}</p>
        {draftEdit.map((line,index)=><fieldset className="line-card" key={line.personaName} disabled={busy}><legend>{line.personaName}</legend><div className="ed-numbers">{keys.map(key=><Field label={editorFields[key]} key={key}><input required inputMode="numeric" pattern="[0-9]{1,7}" value={line[key]} onChange={event=>setDraftEdit(current=>current.map((item,i)=>i===index?{...item,[key]:event.target.value}:item))}/></Field>)}</div></fieldset>)}
        <Field label="修改原因"><textarea required maxLength={300} value={reason} onChange={event=>setReason(event.target.value)}/></Field>
        {error&&<p className="error" role="alert">{error}</p>}
        <button disabled={busy||!reason.trim()}>{busy?"保存中…":"保存修改"}</button>
        <details><summary>修改留痕 · {editing.history.length} 条</summary>{editing.history.map((item,index)=><section key={index} className="editor-change"><p>{item.at.replace("T"," ").slice(0,19)} UTC · {item.actor}</p><p>{item.reason}</p>{item.before&&<SnapshotBlock title="修改前" snapshot={item.before}/>}<SnapshotBlock title={item.before?"修改后":"登记内容"} snapshot={item.after}/></section>)}</details>
      </form>}
    </dialog>
  </main>;
}

function SnapshotBlock({ title, snapshot }: { title: string; snapshot: Snapshot }) { return <div className="editor-snapshot"><b>{title} · {snapshot.businessDate}</b>{snapshot.lines.map(line => <p key={line.personaName}>{line.personaName}：拍摄{line.shootCount}、剪辑{line.editCount}、发给运营{line.sentToOpsCount}、囤量{line.inventorySnapshot}{line.note ? "；" + line.note : ""}</p>)}</div>; }
