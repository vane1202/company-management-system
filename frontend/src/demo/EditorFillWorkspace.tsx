import { useState } from "react";
import { Field } from "../OrderWorkspace";
import { editorFields, editorNote } from "../dailyDetail";
import { editorNames } from "../productionGroups";
import "./customer-fill.css";

type Counts = Record<keyof typeof editorFields, string>;
type Line = Counts & { personaName: string; note: string };
const blank = (): Line => ({ personaName: "", shootCount: "", editCount: "", sentToOpsCount: "", inventorySnapshot: "", note: "" });
const countKeys = Object.keys(editorFields) as (keyof typeof editorFields)[];
const integer = (value: string) => /^\d{1,7}$/.test(value);

export default function EditorFillWorkspace({ today }: { today: string }) {
  const [editor, setEditor] = useState("");
  const [pendingEditor, setPendingEditor] = useState<string | null>(null);
  const [businessDate, setBusinessDate] = useState(today);
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [reviewed, setReviewed] = useState(false);
  const dirty = lines.some(line => line.personaName.trim() || line.note.trim() || countKeys.some(key => line[key] !== ""));
  const names = lines.map(line => line.personaName.trim()).filter(Boolean);
  const duplicate = names.length !== new Set(names).size;
  const complete = Boolean(editor && businessDate) && lines.length > 0 && lines.every(line => line.personaName.trim() && countKeys.every(key => integer(line[key]))) && !duplicate;
  const sum = (key: keyof typeof editorFields) => lines.every(line => integer(line[key])) ? lines.reduce((total, line) => total + Number(line[key]), 0) : null;
  function choose(next: string) {
    if (!editor || next === editor) { setEditor(next); return; }
    if (dirty) setPendingEditor(next); else setEditor(next);
  }
  function update(index: number, patch: Partial<Line>) {
    setLines(lines.map((line, item) => item === index ? { ...line, ...patch } : line));
    setReviewed(false);
  }
  return <main className="customer-fill"><header><p className="eyebrow">拍剪组 · 日常填报</p><h1>拍剪填报</h1><p className="notice">选择已录入的拍剪师，按人设填写当日拍摄、剪辑、发给运营和视频囤量。演示仅供试填，刷新后内容清空。</p></header>
    <section className="card fill-account"><Field label="本次填报的拍剪师"><select aria-label="拍剪师" value={editor} onChange={event => choose(event.target.value)}><option value="">请选择拍剪师</option>{editorNames.map(name => <option key={name} value={name}>{name}</option>)}</select></Field>
      {editor && <p className="notice">当前归属：{editor}。同一位老师可以填写多个人设；换人会清空当前试填。</p>}
      {pendingEditor !== null && <div role="alert"><p>切换拍剪师会清空当前试填内容。确认切换吗？</p><div className="actions"><button type="button" onClick={() => { setEditor(pendingEditor); setPendingEditor(null); setLines([blank()]); setReviewed(false); }}>确认切换并清空</button><button type="button" className="secondary" onClick={() => setPendingEditor(null)}>保留当前拍剪师</button></div></div>}
    </section>
    {!editor ? <section className="card"><h2>拍剪日报</h2><p>请先选择拍剪师，再填写各人设的当日数据。</p></section> : <form className="card" onSubmit={event => { event.preventDefault(); if (event.currentTarget.reportValidity() && complete) setReviewed(true); }}>
      <h2>拍剪日报</h2><p className="notice">{editorNote}发给运营不等于已发布。演示不保存。</p>
      <Field label="业务日"><input required aria-label="业务日" type="date" max={today} value={businessDate} onChange={event => { setBusinessDate(event.target.value); setReviewed(false); }} /></Field>
      {lines.map((line, index) => <fieldset className="fill-line" key={index}><legend>人设 {index + 1}</legend><div className="grid two">
        <Field label="人设 / 主页"><input required aria-label={"第 " + (index + 1) + " 个人设"} maxLength={128} value={line.personaName} onChange={event => update(index, { personaName: event.target.value })} /></Field>
        {countKeys.map(key => <Field key={key} label={editorFields[key]}><input required aria-label={"第 " + (index + 1) + " 个" + editorFields[key]} inputMode="numeric" pattern="[0-9]{1,7}" value={line[key]} onChange={event => update(index, { [key]: event.target.value })} /></Field>)}
      </div><Field label="备注（可选）"><textarea aria-label={"第 " + (index + 1) + " 个备注"} maxLength={500} value={line.note} onChange={event => update(index, { note: event.target.value })} /></Field>{lines.length > 1 && <button type="button" className="secondary" onClick={() => { setLines(lines.filter((_, item) => item !== index)); setReviewed(false); }}>移除此人设</button>}</fieldset>)}
      <button type="button" className="secondary" disabled={lines.length >= 20} onClick={() => { setLines([...lines, blank()]); setReviewed(false); }}>＋ 再填一个人设</button>
      {duplicate && <p className="error" role="alert">同一位拍剪师在同一天的同一个人设只需一行，请合并重复人设。</p>}
      <div className="fill-totals"><span>拍摄 <strong>{sum("shootCount") ?? "—"}</strong></span><span>剪辑 <strong>{sum("editCount") ?? "—"}</strong></span><span>发给运营 <strong>{sum("sentToOpsCount") ?? "—"}</strong></span><span>各人设囤量合计 <strong>{sum("inventorySnapshot") ?? "—"}</strong></span></div>
      <p className="notice">拍摄、剪辑和发给运营按本次填写相加。囤量是每个人设自己的快照，这里的合计只把本次各人设快照相加，不会把过去几天再累加。</p>
      <button type="button" onClick={event=>{if(event.currentTarget.form?.reportValidity() && complete)setReviewed(true);}}>检查试填内容（不保存）</button>{reviewed && <p role="status">基础必填项已填写。当前为 {editor} 在 {businessDate} 的 {lines.length} 个人设试填，演示未保存。</p>}
    </form>}
  </main>;
}
