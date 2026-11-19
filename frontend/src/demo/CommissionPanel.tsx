import { useEffect, useState } from "react";
import { api } from "../api";
import { toErrorMessage } from "../errors";
import { commissionLine, commissionPeople, commissionSummary, yuan, type CommissionLine } from "./commissionCalc";

const statusLabel = { ready: "可计提", pending: "待核算", reversed: "已回冲" };

export default function CommissionPanel({ today, readOnly = false }: { today: string; readOnly?: boolean }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  if (readOnly) return <details className="commission-panel commission-collapsed" aria-label="本组提成"><summary className="commission-toggle"><strong>本组提成</strong><span>{month.replace("-", "年")}月</span><span className="commission-chevron" aria-hidden="true">▸</span></summary><CommissionContent today={today} readOnly month={month} setMonth={setMonth} /></details>;
  return <CommissionContent today={today} readOnly={false} month={month} setMonth={setMonth} />;
}

function CommissionContent({ today, readOnly, month, setMonth }: { today: string; readOnly: boolean; month: string; setMonth: (value: string) => void }) {
  const [lines, setLines] = useState<CommissionLine[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api.orders().then(async (data) => {
      const rows = await Promise.all(data.orders.map(async (order) => {
        const record = await api.orderRecord(order.id);
        return commissionLine(record, order.dealChannel === "private" ? "private" : "live");
      }));
      if (live) setLines(rows);
    }).catch((cause) => { if (live) setError(toErrorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, []);
  if (error) return <section className="commission-panel"><h2>{readOnly ? "本组提成" : "业绩提成"}</h2><p className="error" role="alert">{error}</p></section>;
  const visible = (lines ?? []).filter((line) => line.businessDate.startsWith(month));
  const summary = commissionSummary(visible);
  const people = commissionPeople(visible);
  return <section className="commission-panel" aria-label={readOnly ? "本组提成" : "业绩提成"}>
    <header className="desk-section-heading">{!readOnly && <h2>业绩提成</h2>}<label>月份<input aria-label="提成月份" type="month" max={today.slice(0, 7)} value={month} onChange={(event) => setMonth(event.target.value)} /></label></header>
    <details className="commission-rules"><summary>计提规则与演示说明</summary><p className="notice">提成按净利润计算。{readOnly ? "直播间开单客服 5%，私推开单客服 10%。" : "直播间净利润：主播 10%、开单客服 5%。私推净利润：主播 5%、开单客服 10%。"}主管拿本组可计提净利润的 5%。料子本钱或发货成本未登记时待核算。广告消耗、工资和本次提成不计入。{readOnly ? "主管只能查看，不能修改。" : "演示金额不写入工资单，财务可按此结果在工资核算中登记提成。"}</p></details>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="supervisor-figures" aria-label="提成汇总">
      <div><span>可计提净利润</span><strong>{loading ? "…" : yuan(summary.net)}</strong></div>
      {!readOnly && <div><span>主播提成</span><strong>{loading ? "…" : yuan(summary.host)}</strong></div>}
      <div><span>客服提成</span><strong>{loading ? "…" : yuan(summary.cs)}</strong></div>
      <div><span>主管提成</span><strong>{loading ? "…" : yuan(summary.supervisor)}</strong></div>
    </div>
    <p className="supervisor-note">可计提 {summary.ready} 笔 · 待核算 {summary.pending} 笔{!readOnly && summary.unassigned ? " · 私推待归属主播 " + summary.unassigned + " 笔" : ""}</p>
    <div className="commission-people"><div><h3>按客服</h3>{people.staff.length ? people.staff.map((person) => <p key={person.name}><span>{person.name}</span><b>{yuan(person.cents)}</b></p>) : <p className="supervisor-note">本月还没有可计提的客服提成。</p>}</div>{!readOnly && <div><h3>按主播</h3>{people.hosts.length ? people.hosts.map((person) => <p key={person.name}><span>{person.name}</span><b>{yuan(person.cents)}</b></p>) : <p className="supervisor-note">本月还没有可计提的主播提成。</p>}<p><span>客服主管</span><b>{yuan(summary.supervisor)}</b></p></div>}</div>
    <details className="commission-detail"><summary>订单核算明细 · {visible.length} 笔</summary><div className="commission-lines">{visible.map((line) => <article key={line.id}><div><strong>{line.customer}</strong><small>{line.businessDate} · {line.orderRef} · {line.channel === "private" ? "私推" : "直播间"} · {!readOnly && <>{line.host || "主播待归属"} · </>}{line.operator || "客服待归属"}</small></div><div><span>{statusLabel[line.status]}{line.pendingReason ? " · " + line.pendingReason : ""}</span><b>{line.status === "ready" ? "净利润 " + yuan(line.netCents) : line.status === "reversed" ? "已回冲" : "待核算"}</b></div></article>)}</div></details>
    {!loading && !visible.length && <p className="empty-state">这个月没有开单记录。</p>}
  </section>;
}
