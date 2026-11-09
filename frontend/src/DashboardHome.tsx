import { useEffect, useState } from "react";
import { api, type FanSummary } from "./api";
import type { Page } from "./access";
import { DashboardIcon } from "./DashboardIcon";
import { reportingOverview } from "./dashboardOverview";
import { effectiveOrderAmount, yuan } from "./dashboardDisplay";
import { toErrorMessage } from "./errors";

type Snapshot = Awaited<ReturnType<typeof api.dashboard>>;
export function DashboardHome({ today, onNavigate }: { today: string; onNavigate: (page: Page) => void }) {
  const [preset, setPreset] = useState("day");
  const [range, setRange] = useState<{ from: string; to: string }>();
  const [draft, setDraft] = useState({ from: today, to: today });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [teams, setTeams] = useState<FanSummary[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [updated, setUpdated] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setSnapshot(null); setTeams(null); setErrors([]);
    Promise.allSettled([api.dashboard(preset, range), api.fanSummary(today)]).then(([business, reports]) => {
      if (!active) return;
      const failures: string[] = [];
      if (business.status === "fulfilled") setSnapshot(business.value);
      else failures.push(`经营数据：${toErrorMessage(business.reason)}`);
      if (reports.status === "fulfilled") setTeams(reports.value.teams);
      else failures.push(`填报进度：${toErrorMessage(reports.reason)}`);
      setErrors(failures);
      setUpdated(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [preset, range, today, tick]);
  const m = snapshot?.metrics;
  const ops = snapshot?.opsUsd;
  const reporting = teams ? reportingOverview(teams) : null;
  const metric = (value: string | number | null | undefined) => value ?? "—";
  // 订单金额含退款源订单；首屏只给有效金额（订单金额 − 退款），退款单列，均为人民币。
  const effective = m ? effectiveOrderAmount(m.revenue, m.refunds) : null;
  const missingToday = reporting?.missing ?? 0;
  const link = (page: Page, label: string) => <button type="button" className="text-action" onClick={() => onNavigate(page)}>{label}<DashboardIcon name="arrow" /></button>;
  return <div className="management-dashboard boss-overview" aria-busy={loading}>
    <section className="overview-heading"><div><span className="dashboard-eyebrow">经营工作台</span><h1>管理总览</h1><p>素材、客户与投入，一眼掌握。</p></div><button type="button" className="overview-refresh" disabled={loading} onClick={() => setTick(t => t + 1)}><DashboardIcon name="refresh" />{loading ? "读取中" : "刷新数据"}</button></section>
    <section className="boss-period" aria-label="统计区间">
      <div className="overview-segments">{[["day", "今日"], ["week", "本周"], ["month", "本月"]].map(([key, label]) => <button key={key} type="button" className={!range && preset === key ? "selected" : ""} aria-pressed={!range && preset === key} onClick={() => { setPreset(key); setRange(undefined); setRangeOpen(false); }}>{label}</button>)}</div>
      <button className="boss-range-toggle secondary" type="button" aria-expanded={rangeOpen} aria-controls="boss-date-range" onClick={() => setRangeOpen(open => !open)}>{rangeOpen ? "收起日期" : range ? "自定义区间" : "日期筛选"}</button>
      <form id="boss-date-range" className={`boss-range ${rangeOpen ? "range-open" : ""}`} onSubmit={e => { e.preventDefault(); if (draft.from && draft.to && draft.from <= draft.to) { setRange({ ...draft }); setRangeOpen(false); } }}><label>开始日期<input required type="date" value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} /></label><span aria-hidden="true">—</span><label>结束日期<input required type="date" min={draft.from} value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} /></label><button type="submit" className="secondary">查询</button></form>
      <p className="boss-period-caption">{snapshot ? `${snapshot.period.from} 至 ${snapshot.period.to}` : loading ? "正在读取统计区间…" : "统计暂不可用"}<span>{!loading && updated ? `${updated} 更新` : ""}</span></p>
    </section>
    {!!errors.length && <div className="overview-error" role="alert"><strong>部分数据未能加载</strong>{errors.map(e => <p key={e}>{e}</p>)}<button type="button" onClick={() => setTick(t => t + 1)}>重新加载</button></div>}
    <section className="boss-mobile-summary boss-summary-strip" aria-label="核心数据速览">
      <button type="button" className="boss-brief boss-brief-video" onClick={() => onNavigate("editor")}><span className="boss-brief-label"><strong>视频素材</strong><small>区间末次库存</small></span><span className="boss-brief-number">{snapshot?.dataCounts.editor === 0 ? "—" : metric(m?.endingInventory)}<small>条</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="boss-brief" onClick={() => onNavigate("summary")}><span className="boss-brief-label"><strong>加粉数据{missingToday > 0 && <span className="brief-chip-warn" title={`今日客服微信未报 ${missingToday} 个，点击查看加粉汇总`}>今日未报 {missingToday}</span>}</strong><small>区间新增</small></span><span className="boss-brief-number">{metric(m?.fanAddedTotal)}<small>人</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="boss-brief" onClick={() => onNavigate("ops")}><span className="boss-brief-label"><strong>运营费用</strong><small>区间投放花费</small></span><span className="boss-brief-number">{metric(ops?.spendUsd)}<small>USD</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="boss-brief" onClick={() => onNavigate("orders")}><span className="boss-brief-label"><strong>订单概况</strong><small title={m ? `有效金额 ¥ ${effective ?? "—"} = 订单金额 ¥ ${m.revenue}（含退款源订单）− 退款 ¥ ${m.refunds}` : undefined}>有效 {metric(m?.orderCount)} 笔 · 退款 {yuan(m?.refunds)}</small></span><span className="boss-brief-number boss-brief-money"><small className="brief-currency">¥</small>{metric(effective)}</span><DashboardIcon name="arrow" /></button>
    </section>
    {snapshot && Object.values(snapshot.dataCounts).every(count => count === 0) && <p className="overview-empty-banner" role="status">所选区间暂无素材、加粉或运营填报，可切换日期查看。</p>}
    <div className="boss-core-grid">
      <section className="boss-panel boss-video"><div className="panel-heading"><div><span className="dashboard-eyebrow">01 / 内容供给</span><h2>视频素材</h2></div>{link("editor", "查看明细")}</div><div className="boss-feature-value"><span>区间末次库存</span><strong>{snapshot?.dataCounts.editor === 0 ? "—" : metric(m?.endingInventory)}<small>条</small></strong></div><div className="boss-mini-metrics">{[["拍摄", m?.shootCount], ["剪辑", m?.editCount], ["发给运营", m?.sentToOpsCount]].map(([label, value]) => <div key={label}><span>{label}</span><b>{metric(value)}</b></div>)}</div><p className="panel-note">拍摄、剪辑与发出按区间累计；库存按每人设在区间内最后一次快照合计。</p></section>
      <section className="boss-panel boss-fans"><div className="panel-heading"><div><span className="dashboard-eyebrow">02 / 客户增长</span><h2>加粉数据</h2></div>{link("summary", "查看明细")}</div><div className="boss-fan-headline"><div className="boss-feature-value"><span>区间新增</span><strong>{metric(m?.fanAddedTotal)}<small>人</small></strong></div><div className="boss-valid"><span>区间有效</span><b>{metric(m?.validToday)}<small>人</small></b></div></div><div className="boss-channel-list"><div><span><i className="channel-ms" />Messenger</span><b>{metric(m?.msToday)}<small>新增</small></b><span>月累计 <strong>{metric(m?.msMonth)}</strong></span></div><div><span><i className="channel-ws" />WhatsApp</span><b>{metric(m?.wsToday)}<small>新增</small></b><span>月累计 <strong>{metric(m?.wsMonth)}</strong></span></div></div><p className="panel-note">月累计取截止日所在月份的各主页末次快照。{m?.statsIncomplete ? `含未分类旧加粉 ${m.legacyUnclassifiedAdded ?? 0} 人，渠道统计不完整。` : "按客服微信号归属统计。"}</p></section>
      <section className="boss-panel boss-costs"><div className="panel-heading"><div><span className="dashboard-eyebrow">03 / 运营投入</span><h2>运营费用</h2></div>{link("ops", "查看明细")}</div><div className="boss-cost-body"><div className="boss-feature-value"><span>投放花费 <em>USD</em></span><strong>{metric(ops?.spendUsd)}</strong></div><div className="boss-cost-stats"><div><span>咨询数</span><b>{metric(ops?.consultCount)}</b></div><div><span>点击量</span><b>{metric(ops?.clickCount)}</b></div><div><span>区间末次余额 <small>USD</small></span><b>{snapshot?.dataCounts.ops === 0 ? "—" : metric(ops?.endingBalanceUsd)}</b></div></div></div><p className="panel-note">美元单独统计；余额按每人设末次快照合计，不按天累加。{m && Number(m.promoCost) !== 0 ? `另有历史推广费 ${m.promoCost}（币种未知），未并入美元花费。` : ""}</p></section>
    </div>
    <section className="boss-panel boss-orders"><div className="panel-heading"><h2>订单概况</h2>{link("orders", "查看订单")}</div><div className="boss-order-stats"><div><span>有效金额</span><b>{yuan(effective)}</b><small>订单金额 {yuan(m?.revenue)} · 含退款源订单</small></div><div><span>退款金额</span><b>{yuan(m?.refunds)}</b></div><div><span>有效订单</span><b>{metric(m?.orderCount)}<small>笔</small></b></div></div><p className="panel-note">订单金额为成交报价，客户付款及公司净到账分别登记。{link("finance", "查看收款与结算")}</p></section>
    <section className="boss-panel boss-reporting"><div className="panel-heading"><div><span className="dashboard-eyebrow">客服微信 / {today}</span><h2>今日填报进度</h2></div>{link("summary", "查看汇总")}</div><div className="reporting-headline"><strong>{metric(reporting?.reported)}<span> / {metric(reporting?.expected)} 账号</span></strong><span>{reporting?.percentage == null ? teams ? "暂无应报账号" : "进度暂不可用" : `完成 ${reporting.percentage}%`}</span></div><progress className="reporting-progress" aria-label="今日客服填报完成度" max={reporting?.expected || 1} value={reporting?.reported ?? 0} />{!!teams?.length && <div className="team-progress-list">{teams.map(team => <div className="team-progress-row" key={team.teamId}><strong>{team.teamName}</strong><progress aria-label={`${team.teamName}填报进度`} max={team.expectedCount || 1} value={team.reportedCount} /><span>{team.reportedCount}/{team.expectedCount} 账号</span></div>)}</div>}<p className="panel-note">填报保存后直接计入数据。多主页按同一账号计数，进度固定显示今日。</p></section>
  </div>;
}
