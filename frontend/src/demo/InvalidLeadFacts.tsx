import { useEffect, useState } from "react";
import { invalidReasonLabels, type InvalidFact } from "./assessmentFoundation";

export default function InvalidLeadFacts() {
  const [rows, setRows] = useState<InvalidFact[] | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/assessment/foundation", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "无效粉原因暂不可用");
      if (body.view !== "invalid") throw Error("当前身份不能查看无效粉原因");
      setRows(body.invalid ?? []); setNote(body.note || "");
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无效粉原因暂不可用"); });
    return () => controller.abort();
  }, []);
  return <section className="oa-panel" aria-label="无效粉原因"><div className="oa-panel-heading"><h2>无效粉原因</h2><span>投放质量 · 不评价客服</span></div>
    {note && <p className="oa-muted">{note}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {(rows ?? []).map((row) => <article className="oa-group-row" key={row.businessDate + row.pageName}><div className="oa-group-name"><strong>{row.pageName}</strong><small>{row.businessDate} · 承接 {row.received} 人</small></div><div><span>{invalidReasonLabels.no_chinese}</span><b>{row.no_chinese}</b></div><div><span>{invalidReasonLabels.misclick}</span><b>{row.misclick}</b></div><div><span>{invalidReasonLabels.obscene}</span><b>{row.obscene}</b></div><div><span>待补原因</span><b>{row.unspecified}</b></div></article>)}
    {rows && rows.length === 0 && <p className="oa-muted">这一范围还没有已区分原因的无效粉。</p>}
  </section>;
}
