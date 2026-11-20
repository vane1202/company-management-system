import { useEffect, useState } from "react";
import { requestInner } from "../api";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import "./customer-invalid-review.css";

const tabs = { pending: "待复核", approved: "无效客资池", history: "处理记录" } as const;
const outcomes = { pending: "待复核", approved: "已确认无效", rejected: "已退回跟进", restored: "已恢复跟进" } as const;
const stamp = (value?: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }) : "—";

type ProductionReview = {
  id: string;
  version: number;
  status: keyof typeof outcomes;
  name: string;
  customerRef: string;
  employeeName: string;
  teamName: string;
  accountLabel: string;
  source: string;
  createdOn: string;
  reason: string;
  note: string;
  need: string;
  reviewNote: string;
  requestedAt: string;
  dealt: boolean;
};

export function ProductionInvalidReview() {
  const [rows, setRows] = useState<ProductionReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [tab, setTab] = useState<keyof typeof tabs>("pending");
  const [employee, setEmployee] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [decision, setDecision] = useState<"approve" | "reject" | "restore">("approve");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError("");
    requestInner<{ rows: ProductionReview[] }>("/api/customer-reviews", { signal: controller.signal }).then((body) => {
      if (!controller.signal.aborted) setRows((body.rows ?? []).filter((row) => row.status in outcomes));
    }).catch((cause) => {
      if (!controller.signal.aborted) setLoadError(toErrorMessage(cause));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [tick]);
  const people = [...new Set(rows.map((row) => row.employeeName).filter(Boolean))];
  const inTab = (row: ProductionReview) => tab === "history" ? row.status === "rejected" || row.status === "restored" : row.status === tab;
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(inTab).filter((row) => (!employee || row.employeeName === employee) && (row.name + " " + row.customerRef + " " + row.employeeName + " " + row.reason + " " + row.note).toLowerCase().includes(needle)).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const selected = rows.find((row) => row.id === selectedId);
  function open(id: string) {
    setSelectedId(id);
    setNote("");
    setError("");
    setMessage("");
    setDecision(rows.find((row) => row.id === id)?.status === "approved" ? "restore" : "approve");
  }
  async function commit() {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    try {
      await requestInner("/api/customer-reviews/" + encodeURIComponent(selected.id), { method: "POST", body: JSON.stringify({ decision, note, version: selected.version }) });
      setMessage(decision === "approve" ? "已确认无效，并移入无效客资池。" : decision === "reject" ? "已退回客服继续跟进。" : "已恢复跟进。原订单仍保留。");
      setSelectedId("");
      setNote("");
      setTick((value) => value + 1);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }
  const count = (key: keyof typeof tabs) => rows.filter((row) => key === "history" ? row.status === "rejected" || row.status === "restored" : row.status === key).length;
  return <section className="customer-invalid-review" aria-label="无效客资复核" aria-busy={loading}>
    <header className="cir-heading"><div><p className="eyebrow">客服主管 · 本组客资</p><h1>无效客资复核</h1></div><InfoTip label="无效客资复核规则" text="客服把客户标为无效后，先进入待复核。主管确认后才计入无效客资。退回或恢复必须填写原因。已有订单会保留。" /></header>
    <nav className="cir-tabs" aria-label="客资复核视图">{(Object.entries(tabs) as [keyof typeof tabs, string][]).map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setSelectedId(""); setError(""); }}><span>{label}</span><b>{count(key)}</b></button>)}</nav>
    {loadError && <p className="error" role="alert">{loadError}<button type="button" onClick={() => setTick((value) => value + 1)}>重新读取</button></p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="cir-filters"><label>经办客服<select aria-label="复核客服筛选" value={employee} onChange={(event) => { setEmployee(event.target.value); setSelectedId(""); }}><option value="">全部本组客服</option>{people.map((name) => <option key={name} value={name}>{name}</option>)}</select></label><label>搜索客户<input aria-label="复核客户搜索" type="search" placeholder="客户名或客户编号" value={query} onChange={(event) => { setQuery(event.target.value); setSelectedId(""); }} /></label></div>
    {loading ? <p role="status">正在读取无效客资…</p> : selected ? <article className="cir-detail">
      <button type="button" className="secondary" onClick={() => setSelectedId("")}>← 返回{tabs[tab]}</button>
      <header><div><h2>{selected.name}</h2><small>{selected.customerRef || selected.id}</small></div><span className={selected.status === "pending" ? "cir-status pending" : "cir-status"}>{outcomes[selected.status]}</span></header>
      <dl className="cir-facts"><div><dt>经办客服</dt><dd>{selected.employeeName} · {selected.teamName}</dd></div><div><dt>接待账号</dt><dd>{selected.accountLabel || "未填写"}</dd></div><div><dt>来源主页</dt><dd>{selected.source || "未填写"}</dd></div><div><dt>登记日期</dt><dd>{selected.createdOn || "未填写"}</dd></div><div><dt>申请原因</dt><dd>{selected.reason || "未填写"}</dd></div><div><dt>申请时间</dt><dd>{stamp(selected.requestedAt)}</dd></div><div className="cir-wide"><dt>申请备注</dt><dd>{selected.note || "未填写"}</dd></div><div className="cir-wide"><dt>沟通与需求</dt><dd>{selected.need || "未填写具体需求"}</dd></div></dl>
      {selected.dealt && <p className="notice">该客户已有有效订单，确认无效仍会保留原订单和业绩。</p>}
      {selected.status === "pending" || selected.status === "approved" ? <form onSubmit={(event) => { event.preventDefault(); void commit(); }}>
        <h3>{selected.status === "pending" ? "复核处理" : "恢复客户跟进"}</h3>
        {selected.status === "pending" && <div className="cir-decision" role="group" aria-label="复核决定"><button type="button" aria-pressed={decision === "approve"} onClick={() => setDecision("approve")}>确认无效</button><button type="button" aria-pressed={decision === "reject"} onClick={() => setDecision("reject")}>退回跟进</button></div>}
        <label>{decision === "approve" ? "复核备注（可选）" : "处理原因（必填）"}<textarea aria-label="复核处理原因" rows={3} required={decision !== "approve"} maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder={decision === "restore" ? "说明为何恢复客户跟进" : decision === "reject" ? "填写退回原因，供客服继续跟进" : "补充复核意见"} /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit" disabled={saving}>{saving ? "正在保存…" : decision === "approve" ? "确认并移入无效池" : decision === "reject" ? "退回客服跟进" : "恢复客户跟进"}</button>
      </form> : <section className="cir-outcome"><h3>处理结果</h3><p>{outcomes[selected.status]}</p><p>{selected.reviewNote || "未补充备注"}</p></section>}
    </article> : <div className="cir-list">{visible.length ? visible.map((row) => <button type="button" className="cir-row" key={row.id} onClick={() => open(row.id)}><span className="cir-customer"><strong>{row.name}</strong><small>{row.employeeName} · {row.teamName}</small><small>{row.createdOn} 新增</small></span><span className="cir-reason"><span className={row.status === "pending" ? "cir-status pending" : "cir-status"}>{row.reason || "未填写原因"}</span><small>{tab === "history" ? outcomes[row.status] : stamp(row.requestedAt)}</small></span><span className="cir-open">{tab === "pending" ? "去复核" : "查看详情"} ›</span></button>) : <section className="empty-state"><strong>{query || employee ? "没有匹配的客资" : tab === "pending" ? "本组暂无待复核申请" : tab === "approved" ? "无效客资池暂无客户" : "暂无退回或恢复记录"}</strong><p>{tab === "pending" ? "客服把客户标为无效后，会出现在这里。" : "可调整筛选，或切换查看其他复核状态。"}</p></section>}</div>}
  </section>;
}
