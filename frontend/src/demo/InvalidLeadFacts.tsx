import { useEffect, useState } from "react";
import { invalidReasonLabels, shareLabel, sourceAdLabel, type InvalidFact, type SourceAdSummary } from "./assessmentFoundation";
import { invalidReasons, officialInvalidCustomers, useCustomerCrm } from "./customerCrm";

function matchesAd(selected: string, id?: string) {
  if (!selected) return true;
  const value = (id || "").trim();
  return selected === "__missing__" ? !value : value === selected;
}

export default function InvalidLeadFacts({ today }: { today: string }) {
  const [rows, setRows] = useState<InvalidFact[] | null>(null);
  const [sourceAds, setSourceAds] = useState<SourceAdSummary[]>([]);
  const [adAccount, setAdAccount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const crm = useCustomerCrm(today);
  const confirmed = officialInvalidCustomers(crm.state).filter(customer => !customer.sample && sourceAds.some(ad => ad.adAccountId === customer.adAccountId) && matchesAd(adAccount, customer.adAccountId));
  const pending = crm.state.reviews.filter(review => review.status === "pending" && crm.state.customers.some(customer => customer.id === review.customerId && !customer.sample && sourceAds.some(ad => ad.adAccountId === customer.adAccountId))).length;
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/assessment/foundation", { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error || "无效粉原因暂不可用");
      if (body.view !== "invalid") throw Error("当前身份不能查看无效粉原因");
      setRows(body.invalid ?? []); setSourceAds(body.sourceAds ?? []); setNote(body.note || "");
    }).catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "无效粉原因暂不可用"); });
    return () => controller.abort();
  }, []);
  const options = [...new Set(sourceAds.map(row => row.adAccountId))];
  const visibleAds = sourceAds.filter(row => matchesAd(adAccount, row.adAccountId));
  const visibleRows = (rows ?? []).filter(row => matchesAd(adAccount, row.sourceAdAccountId));
  return <section className="oa-panel" aria-label="无效粉原因"><div className="oa-panel-heading"><h2>下粉广告户</h2><span>承接与需求转化 · 不看消耗</span></div>
    <p className="oa-muted">按客户登记当时的下粉广告户汇总。未记录显示来源待补，不按客服或主页回填。需求转化是明确需求人数除以正常沟通人数。主管尚未确认的无效粉不计入。这里不对应广告消耗。</p>
    <label className="row">下粉广告户<select aria-label="下粉广告户筛选" value={adAccount} onChange={event => setAdAccount(event.target.value)}><option value="">全部广告户</option>{options.map(id => <option key={id || "__missing__"} value={id || "__missing__"}>{sourceAdLabel(id)}</option>)}</select></label>
    {visibleAds.map(row => <article className="oa-group-row" key={row.adAccountId || "missing"}><div className="oa-group-name"><strong>{sourceAdLabel(row.adAccountId)}</strong><small>承接 {row.received} 人 · 正常沟通 {row.replied} 人</small></div><div><span>需求转化</span><b>{row.replied ? shareLabel(row.qualified, row.replied) : "正常沟通为0"}</b></div><div><span>{invalidReasonLabels.no_chinese}</span><b>{row.no_chinese}</b></div><div><span>{invalidReasonLabels.misclick}</span><b>{row.misclick}</b></div><div><span>{invalidReasonLabels.obscene}</span><b>{row.obscene}</b></div><div><span>待补原因</span><b>{row.unspecified}</b></div></article>)}
    {!visibleAds.length && <p className="oa-muted">这一范围还没有可按广告户汇总的承接记录。</p>}
    {note && <p className="oa-muted">{note}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="oa-panel-heading"><h2>无效粉原因</h2><span>投放质量 · 不评价客服</span></div>
    {visibleRows.map((row) => <article className="oa-group-row" key={row.businessDate + row.pageName + (row.sourceAdAccountId || "")}><div className="oa-group-name"><strong>{row.pageName}</strong><small>{row.businessDate} · 下粉广告户 {sourceAdLabel(row.sourceAdAccountId)} · 承接 {row.received} 人</small></div><div><span>{invalidReasonLabels.no_chinese}</span><b>{row.no_chinese}</b></div><div><span>{invalidReasonLabels.misclick}</span><b>{row.misclick}</b></div><div><span>{invalidReasonLabels.obscene}</span><b>{row.obscene}</b></div><div><span>待补原因</span><b>{row.unspecified}</b></div></article>)}
    {rows && visibleRows.length === 0 && <p className="oa-muted">这一范围还没有已区分原因的无效粉。</p>}
    <div className="oa-panel-heading"><h2>主管已确认</h2><span>待复核 {pending} 条不计入</span></div>
    <p className="oa-muted">只有客服主管确认后的客户进入无效客资池。待复核申请不改变这里的数量，也不作为客服考核。</p>
    {confirmed.map(customer => <article className="oa-group-row" key={customer.id}><div className="oa-group-name"><strong>{customer.name}</strong><small>{customer.employeeName} · {customer.createdOn} · 下粉广告户 {sourceAdLabel(customer.adAccountId)}</small></div><div><span>原因</span><b>{invalidReasons[crm.state.reviews.filter(review => review.customerId === customer.id).at(-1)?.reason || "no_chinese"]}</b></div></article>)}
    {!confirmed.length && <p className="oa-muted">还没有新的已确认无效客资。</p>}
  </section>;
}
