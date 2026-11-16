import { useEffect, useState } from "react";
import { AnalysisPlot, ChartStyleControl, seriesColor, useChartStyle } from "./AnalysisChart";
import { buildAccountTrends, type OpsTrendMetric, type OpsTrendRow } from "./opsAccountTrendData";
import type { TrendSeries } from "./bossTrendData";
import { useReferenceQuotes } from "./useReferenceQuotes";
import "./ops-workspace.css";

const metrics: [OpsTrendMetric, string][] = [["spendCny", "广告消耗"], ["consultCount", "咨询量"], ["consultationCostCny", "咨询成本"], ["leads", "新增客资"], ["invalidRate", "无效粉占比"], ["leadCost", "客资成本"]];
export default function OpsAccountTrends({ rows, dates, accounts, today, onFeedback }: { rows: OpsTrendRow[]; dates: string[]; accounts: string[]; today: string; onFeedback?: (account: string) => void }) {
  const [selected, setSelected] = useState<string[] | null>(null), [hidden, setHidden] = useState<string[]>([]);
  const [metric, setMetric] = useState<OpsTrendMetric>("spendCny"), [series, setSeries] = useState<TrendSeries[]>([]), [loading, setLoading] = useState(false);
  const [style, setStyle] = useChartStyle(), [day, setDay] = useState(today);
  const revision = useReferenceQuotes();
  const chosen = selected === null ? accounts : selected.filter(account => accounts.includes(account));
  const key = JSON.stringify([rows, dates, chosen, metric, revision]);
  useEffect(() => { let active = true; setSeries([]); setLoading(true); buildAccountTrends(rows, dates, chosen, metric).then(result => { if (active) setSeries(result); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [key]);
  const shown = series.filter(item => !hidden.includes(item.key));
  return <section className="oa-panel ops-multi-trend" aria-label="多账号趋势对比" aria-busy={loading}><div className="analysis-toolbar"><h2>多账号趋势对比</h2><ChartStyleControl style={style} onChange={setStyle} /></div>
    <div className="ops-trend-controls"><details className="ops-account-picker"><summary>选择账号 · 已选{chosen.length}个</summary><div className="ops-account-options"><div className="ops-picker-actions"><button type="button" className="secondary" onClick={() => { setSelected(null); setHidden([]); }}>全选</button><button type="button" className="secondary" onClick={() => setSelected([])}>清空</button><button type="button" onClick={event => event.currentTarget.closest("details")?.removeAttribute("open")}>完成选择</button></div>{accounts.map(account => <label key={account}><input type="checkbox" checked={chosen.includes(account)} onChange={event => { setSelected(event.target.checked ? [...chosen, account] : chosen.filter(item => item !== account)); setHidden([]); }} /><span>{account}</span></label>)}</div></details><label>指标<select aria-label="多账号趋势指标" value={metric} onChange={event => setMetric(event.target.value as OpsTrendMetric)}>{metrics.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <p className="analysis-caption">{dates[0]} 至 {dates.at(-1)} · {metric === "consultCount" ? "咨询次数" : metric === "invalidRate" ? "%" : metric === "leads" ? "客户数" : "人民币参考金额"}</p>
    {["leads", "invalidRate", "leadCost"].includes(metric) && <p className="notice">客资与广告账户的关联资料待补，此项暂不计算。咨询量仍按运营日报计数。</p>}
    <div className="ops-series-toggles">{series.map(item => <button type="button" className="secondary" key={item.key} aria-pressed={!hidden.includes(item.key)} onClick={() => setHidden(previous => previous.includes(item.key) ? previous.filter(key => key !== item.key) : [...previous, item.key])}><i style={{ background: seriesColor(item.key) }} />{item.label}</button>)}</div>
    {loading ? <p role="status">正在计算所选账号走势…</p> : shown.length ? <AnalysisPlot series={shown} style={style} today={today} unit={metric === "consultCount" || metric === "leads" ? "count" : metric === "invalidRate" ? "rate" : "money"} selected={dates.includes(day) ? day : dates.at(-1) || today} onSelect={setDay} label="多账号趋势" /> : <p className="empty-state">请选择至少一个账号，并开启对应图例。</p>}
    {onFeedback && <div className="ops-chart-feedback">{chosen.map(account => <button type="button" className="text-action" key={account} onClick={() => onFeedback(account)}>记录反馈 · {account}</button>)}</div>}
  </section>;
}
