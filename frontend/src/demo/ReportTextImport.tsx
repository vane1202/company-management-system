import { useState, type ReactNode } from "react";
type Report = { errors: string[]; warnings: string[]; unknownLines: string[] };
export default function ReportTextImport<T extends Report>({ name, example, parse, preview, onApply, dirty }: { name: string; example: string; parse: (text: string) => T; preview: (result: T) => ReactNode; onApply: (result: T) => void; dirty: boolean }) {
  const [text, setText] = useState(""), [result, setResult] = useState<T | null>(null);
  const [overwrite, setOverwrite] = useState(false), [applied, setApplied] = useState(false);
  const reset = (next: string) => { setText(next); setResult(null); setOverwrite(false); setApplied(false); };
  return <section className="fill-text-import"><h2>粘贴{name}日报识别</h2><p className="notice">在本页识别，不上传日报原文。核对预览后再填入下方表单。</p>
    <label className="row">日报文字<textarea rows={7} maxLength={12000} value={text} onChange={e => reset(e.target.value)} placeholder="粘贴一位客户／一个接待账号的日报…" /></label>
    <div className="actions"><button type="button" disabled={!text.trim()} onClick={() => { setResult(parse(text)); setOverwrite(false); setApplied(false); }}>识别并预览</button><button type="button" className="secondary" onClick={() => reset(example)}>填入虚构示例</button></div>
    {result && <div className="fill-import-preview" aria-label={`${name}识别预览`}><h3>识别预览</h3>{preview(result)}
      {!!result.errors.length && <div role="alert" className="error"><strong>请修正原文后重新识别</strong><ul>{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
      {!!result.warnings.length && <details open><summary>需要核对的内容</summary><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
      {!!result.unknownLines.length && <details><summary>未识别的原文（{result.unknownLines.length}行）</summary><pre>{result.unknownLines.join("\n")}</pre></details>}
      {dirty && !applied && <label className="fill-check"><input type="checkbox" checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />确认覆盖本次识别涉及的已填字段和整份明细</label>}
      <button type="button" disabled={applied || !!result.errors.length || (dirty && !overwrite)} onClick={() => { onApply(result); setApplied(true); }}>确认填入{name}</button>
      {applied && <p role="status">已填入下方表单，仍可逐项修改；演示不保存。</p>}
    </div>}
  </section>;
}
