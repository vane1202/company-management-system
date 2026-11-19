import { InfoTip } from "../InfoTip";
import "./ops-balance-strip.css";

export type OpsBalance = { account: string; amountUsd: string | null; date: string | null; status: string; shared: boolean };
const amount = (row: OpsBalance) => row.status === "conflict" ? "待核对" : row.status !== "ready" || row.amountUsd === null ? "待补" : Number(row.amountUsd).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const snapshot = (row: OpsBalance) => row.date ? <time dateTime={row.date} title={row.date}>快照：{row.date}</time> : <span>暂无快照</span>;

export default function OpsBalanceStrip({ account, rows, loading, error, endDate }: { account: string; rows: OpsBalance[]; loading: boolean; error: string; endDate: string }) {
  const explanation = <InfoTip label="账户余额口径" text={`余额为截至${endDate}最近一次已登记快照，并非实时余额。切换人设不拆分同一广告户余额。缺失显示待补，快照冲突显示待核对。`} />;
  if (loading || error) return <section className="ops-balance-strip" aria-label="账户余额"><span>账户余额 {explanation}</span><span role={error ? undefined : "status"}>{error ? "暂不可用" : "读取中…"}</span></section>;
  if (account) {
    const row = rows.find(item => item.account === account);
    return <section className="ops-balance-strip ops-balance-single" aria-label={`账户余额 · ${account}`}><div className="ops-balance-value"><span>账户余额</span><strong className={row?.status === "conflict" ? "ops-balance-warning" : ""}>{row ? amount(row) : "待补"}{row?.status === "ready" && row.amountUsd !== null && <small> USD</small>}</strong>{explanation}</div><div className="ops-balance-date">{row ? snapshot(row) : "暂无快照"}</div></section>;
  }
  return <details className="ops-balance-strip ops-balance-list" aria-label="账户余额"><summary><span>账户余额</span><span>{rows.length}个广告户</span><span className="ops-balance-expand">查看余额 <span aria-hidden="true">▸</span></span></summary><div className="ops-balance-list-note">完整广告户快照 {explanation}</div>{rows.length ? rows.map(row => <article key={row.account}><div><strong>{row.account}</strong><small>{snapshot(row)}</small></div><b className={row.status === "conflict" ? "ops-balance-warning" : ""}>{amount(row)}{row.status === "ready" && row.amountUsd !== null && <small> USD</small>}</b></article>) : <p className="empty-state">当前范围暂无广告账户快照。</p>}</details>;
}
