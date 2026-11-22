import { useEffect, useState } from "react";
import { api } from "../api";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import { customerStatus, invalidReasons, useCustomerCrm, type CrmActor } from "./customerCrm";
import { ProductionInvalidReview } from "./ProductionInvalidReview";
import { loadServiceDirectory } from "./serviceDirectory";
import "./customer-invalid-review.css";

const actor: CrmActor = { role: "cs_supervisor", employeeId: "demo-supervisor", employeeName: "演示客服主管", teamIds: ["demo-team-a", "registered-team-qiuju"] };
const tabs = { pending: "待复核", approved: "无效客资池", history: "处理记录" } as const;
const outcomes = { pending: "待复核", approved: "已确认无效", rejected: "已驳回 · 尝试沟通", restored: "已恢复 · 尝试沟通" } as const;
const stamp = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "—";

/** Project jade tokens and compact, actionable rows; instructions stay beside irreversible decisions. */
function DemoCustomerInvalidReview({ today }: { today: string }) {
  const { state, dispatch, error: storeError } = useCustomerCrm(today);
  const [tab, setTab] = useState<keyof typeof tabs>("pending");
  const [employee, setEmployee] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | "restore">("approve");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accountLabels, setAccountLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    void Promise.allSettled([api.csAccounts(), loadServiceDirectory()]).then(results => {
      if (!active) return;
      const accounts = results[0].status === "fulfilled" ? results[0].value.accounts : [];
      const directory = results[1].status === "fulfilled" ? results[1].value : null;
      const rows = [...accounts, ...(directory?.enabled ? directory.accounts : [])];
      setAccountLabels(Object.fromEntries(rows.filter(row => row.teamId && actor.teamIds.includes(row.teamId)).map(row => [row.id, row.wechatId])));
    });
    return () => { active = false; };
  }, []);
  const customers = state.customers.filter(customer => actor.teamIds.includes(customer.teamId));
  const ids = new Set(customers.map(customer => customer.id));
  const all = state.reviews.filter(review => actor.teamIds.includes(review.teamId) && ids.has(review.customerId));
  const matching = all.filter(review => tab === "history" ? review.status === "rejected" || review.status === "restored" : review.status === tab);
  const people = [...new Map(customers.map(customer => [customer.employeeId, customer.employeeName])).entries()];
  const rows = matching.filter(review => {
    const customer = customers.find(item => item.id === review.customerId)!;
    return (!employee || customer.employeeId === employee) && `${customer.name} ${customer.customerRef} ${customer.employeeName} ${review.note}`.toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const selected = rows.find(row => row.id === selectedId);
  const customer = customers.find(row => row.id === selected?.customerId);
  function open(id: string) {
    setSelectedId(id); setNote(""); setError(""); setMessage("");
    setDecision(all.find(row => row.id === id)?.status === "approved" ? "restore" : "approve");
  }
  function commit() {
    if (!selected) return;
    try {
      dispatch({ type: "reviewInvalid", actor, reviewId: selected.id, decision, note });
      setMessage(decision === "approve" ? "已在本次演练中确认无效，并移入无效客资池。" : decision === "reject" ? "已退回客服继续跟进，退回原因已保留。" : "已恢复跟进，原复核记录保留。予以恢复不会删除已有订单。".replace("予以恢复", "恢复"));
      setSelectedId(""); setNote(""); setError("");
    } catch (cause) { setError(toErrorMessage(cause)); }
  }
  return <section className="customer-invalid-review" aria-label="无效客资复核">
    <header className="cir-heading"><div><p className="eyebrow">客服主管 · 本组客资</p><h1>无效客资复核</h1></div><InfoTip label="无效客资复核规则" text="客服提交无效申请后仍为待复核，只有主管确认才计入正式无效客资。退回或恢复必须填写原因。已有客户资料和订单保留；无效数量用于运营分析，不作为客服处罚指标。" /></header>
    <p className="cir-demo">本标签页流程演练，未写入正式后台</p>
    <nav className="cir-tabs" aria-label="客资复核视图">{Object.entries(tabs).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => { setTab(key as keyof typeof tabs); setSelectedId(""); setError(""); }}><span>{label}</span><b>{all.filter(row => key === "history" ? row.status === "rejected" || row.status === "restored" : row.status === key).length}</b></button>)}</nav>
    {storeError && <p className="error" role="alert">{storeError}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="cir-filters"><label>经办客服<select aria-label="复核客服筛选" value={employee} onChange={event => { setEmployee(event.target.value); setSelectedId(""); }}><option value="">全部本组客服</option>{people.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>搜索客户<input aria-label="复核客户搜索" type="search" placeholder="客户名或客户编号" value={query} onChange={event => { setQuery(event.target.value); setSelectedId(""); }} /></label></div>
    {selected && customer ? <article className="cir-detail">
      <button type="button" className="secondary" onClick={() => setSelectedId("")}>← 返回{tabs[tab]}</button>
      <header><div><h2>{customer.name}</h2><small>{customer.customerRef || customer.id}</small></div><span className={`cir-status ${selected.status === "pending" ? "pending" : ""}`}>{outcomes[selected.status]}</span></header>
      <dl className="cir-facts"><div><dt>经办客服</dt><dd>{customer.employeeName} · {customer.teamName}</dd></div><div><dt>接待账号</dt><dd>{accountLabels[customer.accountId] || customer.accountId}</dd></div><div><dt>来源主页</dt><dd>{customer.source || "未填写"}</dd></div><div><dt>登记日期</dt><dd>{customer.createdOn}</dd></div><div><dt>申请原因</dt><dd>{invalidReasons[selected.reason]}</dd></div><div><dt>申请时间</dt><dd>{stamp(selected.requestedAt)}</dd></div><div className="cir-wide"><dt>申请备注</dt><dd>{selected.note || "未填写"}</dd></div><div className="cir-wide"><dt>沟通与需求</dt><dd>{customer.need || "未填写具体需求"}</dd></div></dl>
      {customerStatus(state, customer) === "dealt" && <p className="notice">该客户已有有效订单，确认无效仍会保留原订单和业绩。</p>}
      {selected.status === "pending" || selected.status === "approved" ? <form onSubmit={event => { event.preventDefault(); commit(); }}>
        <h3>{selected.status === "pending" ? "复核处理" : "恢复客户跟进"}</h3>
        {selected.status === "pending" && <div className="cir-decision" role="group" aria-label="复核决定"><button type="button" aria-pressed={decision === "approve"} onClick={() => setDecision("approve")}>确认无效</button><button type="button" aria-pressed={decision === "reject"} onClick={() => setDecision("reject")}>退回跟进</button></div>}
        <label>{decision === "approve" ? "复核备注（可选）" : "处理原因（必填）"}<textarea aria-label="复核处理原因" rows={3} required={decision !== "approve"} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder={decision === "restore" ? "说明为何恢复客户跟进" : decision === "reject" ? "填写退回原因，供客服继续跟进" : "补充复核意见"} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">{decision === "approve" ? "确认并移入无效池" : decision === "reject" ? "退回客服跟进" : "恢复客户跟进"}</button>
      </form> : <section className="cir-outcome"><h3>处理结果</h3><p>{outcomes[selected.status]} · {selected.reviewer || "主管"} · {stamp(selected.reviewedAt)}</p><p>{selected.reviewNote || "未补充备注"}</p></section>}
      <details className="cir-audit"><summary>该客户的复核历史 · {all.filter(row => row.customerId === customer.id).length} 次</summary>{all.filter(row => row.customerId === customer.id).map(row => <article key={row.id}><strong>{outcomes[row.status]} · {invalidReasons[row.reason]}</strong><small>申请 {stamp(row.requestedAt)}{row.reviewedAt ? ` · 处理 ${stamp(row.reviewedAt)}` : ""}</small><p>{row.note || "无申请备注"}</p>{row.reviewNote && <p>处理意见：{row.reviewNote}</p>}</article>)}</details>
    </article> : <div className="cir-list">{rows.length ? rows.map(review => {
      const item = customers.find(row => row.id === review.customerId)!;
      return <button type="button" className="cir-row" key={review.id} onClick={() => open(review.id)}><span className="cir-customer"><strong>{item.name}</strong><small>{item.employeeName} · {item.teamName}</small><small>{item.createdOn} 新增</small></span><span className="cir-reason"><span className={`cir-status ${review.status === "pending" ? "pending" : ""}`}>{invalidReasons[review.reason]}</span><small>{tab === "history" ? outcomes[review.status] : stamp(review.requestedAt)}</small></span><span className="cir-open">{tab === "pending" ? "去复核" : "查看详情"} ›</span></button>;
    }) : <section className="empty-state"><strong>{query || employee ? "没有匹配的客资" : tab === "pending" ? "本组暂无待复核申请" : tab === "approved" ? "无效客资池暂无客户" : "暂无退回或恢复记录"}</strong><p>{tab === "pending" ? "客服提交无效申请后，将出现在这里。" : "可调整筛选，或切换查看其他复核状态。"}</p></section>}</div>}
  </section>;
}

export default function CustomerInvalidReview({ today }: { today: string }) {
  if (import.meta.env.MODE === "production") return <ProductionInvalidReview />;
  return <DemoCustomerInvalidReview today={today} />;
}
