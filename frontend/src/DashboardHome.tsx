import { dashboardPresetRange } from "./dates";
import { LiveBusinessOverview } from "./LiveBusinessOverview";
import type { LiveView } from './liveBusinessNavigation';
import { LeadHomePreview } from "./LeadHomePreview";
import { lazy, Suspense, useEffect, useState } from "react";
import { api, type FanSeries } from "./api";
import type { Page } from "./access";
import { DashboardIcon } from "./DashboardIcon";
import { monthGap, MONTH_GAP_MIN_ABS, MONTH_GAP_MIN_RATIO, sparkReady, yuan } from "./dashboardDisplay";
import { InfoTip } from "./InfoTip";
import { Sparkline } from "./Sparkline";
import { toErrorMessage } from "./errors";
import { Skeleton } from "./Skeleton";

type Snapshot = Awaited<ReturnType<typeof api.dashboard>>;
// Compile-time gate: the installed/production build keeps its existing homepage.
const DemoP0Summary = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/BossP0Summary')) : null;
/*
 * BOSS 管理总览。设计偏离说明（项目约束优先于 dashboard-design 默认风格）：浅色深绿主题；
 * 手机第一屏优先显示直播间业绩、费用与广告消耗；加粉和拍剪位于经营明细之后；口径说明放在 ⓘ 里，不写在卡片下。
 */
export function DashboardHome({ today, onNavigate, onOpenBusiness }: { today: string; onNavigate: (page: Page) => void; onOpenBusiness:(view:LiveView)=>void }) {
  const [preset, setPreset] = useState("day");
  const [range, setRange] = useState<{ from: string; to: string }>();
  const [draft, setDraft] = useState({ from: today, to: today });
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeError,setRangeError]=useState("");
  const [tick, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [series, setSeries] = useState<FanSeries | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [updated, setUpdated] = useState("");
  useEffect(() => {
    let active = true;
    setLoading(true); setSnapshot(null); setSeries(null); setErrors([]);
    // 趋势线窗口：截至区间结束日（不晚于今天）的 7 个业务日。
    const seriesTo = range && range.to < today ? range.to : today;
    Promise.allSettled([api.dashboard(preset, range), api.dashboardSeries(seriesTo, 7)]).then(([business, trend]) => {
      if (!active) return;
      const failures: string[] = [];
      if (business.status === "fulfilled") setSnapshot(business.value);
      else failures.push(`加粉与拍剪数据：${toErrorMessage(business.reason)}`);
      // 趋势线只是辅助：失败时不显示线，不额外报错。
      if (trend.status === "fulfilled") setSeries(trend.value);
      setErrors(failures);
      setUpdated(new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }));
      setLoading(false);
    });
    return () => { active = false; };
  }, [preset, range, today, tick]);
  const m = snapshot?.metrics;

  const metric = (value: string | number | null | undefined) => loading ? <Skeleton width="3em" height=".85em"/> : value ?? "—";
  const monthView = !range && preset === "month";
  const sparkValues = series?.days.map(d => d.fanAdded) ?? [];
  const sparkDates = series?.days.map(d => d.date) ?? [];
  const sparkPartial = !!series?.days.at(-1)?.partial;
  const spark = (width: number, height: number) => series && sparkReady(sparkValues) ? <Sparkline values={sparkValues} dates={sparkDates} partialLast={sparkPartial} width={width} height={height} label={`近 7 天加粉（截至 ${series.to}）`} /> : null;
  const link = (page: Page, label: string) => <button type="button" className="text-action" onClick={() => onNavigate(page)}>{label}<DashboardIcon name="arrow" /></button>;
  const channel = (name: string, cls: string, added: number | undefined, month: number | undefined) => {
    const gap = monthView ? monthGap(month, added) : null;
    return <div><span><i className={cls} />{name}</span><b>{metric(added)}<small>{monthView ? "区间新增" : "新增"}</small></b><span>{monthView ? "月累计（上报）" : "月累计"} <strong>{metric(month)}</strong>{gap?.flagged && <span className="gap-flag"><span className="gap-flag-mark" aria-hidden="true">≠</span><InfoTip label={`${name}月累计与区间新增差异说明`} text={`${name}：上报的月累计 ${month}，系统按日合计的区间新增 ${added}，相差 ${Math.abs(gap.diff)}。可能是月初未在系统填报，或上报口径不同，请核对。提示阈值：相差至少 ${MONTH_GAP_MIN_ABS} 人且至少为较大值的 ${MONTH_GAP_MIN_RATIO * 100}%。`} /></span>}</span></div>;
  };
  return <div className="management-dashboard boss-overview" aria-busy={loading}>
    <section className="overview-heading boss-heading">
      <div className="boss-title"><span className="dashboard-eyebrow">经营工作台</span><h1>经营总览</h1></div>
      <div className="boss-period-controls">
        <div className="overview-segments">{[["day", "今日"], ["week", "本周"], ["month", "本月"]].map(([key, label]) => <button key={key} type="button" className={!range && preset === key ? "selected" : ""} aria-pressed={!range && preset === key} onClick={() => { setPreset(key); setDraft(dashboardPresetRange(today,key)); setRange(undefined); setRangeOpen(false);setRangeError(""); }}>{label}</button>)}</div>
        <button className="boss-range-toggle secondary" type="button" aria-expanded={rangeOpen} aria-controls="boss-date-range" aria-label={rangeOpen ? "收起日期筛选" : "日期筛选"} onClick={() => setRangeOpen(open => !open)}>{rangeOpen ? "收起" : range ? "自定义" : "日期"}</button>
      </div>
    </section>
    <section className="boss-period" aria-label="统计区间">
      <form id="boss-date-range" className={`boss-range ${rangeOpen ? "range-open" : ""}`} onSubmit={e => { e.preventDefault(); if(!draft.from||!draft.to){setRangeError("请选择开始和结束日期");return;}if(draft.from>draft.to){setRangeError("开始日期不能晚于结束日期");return;}setRangeError("");setRange({ ...draft });setRangeOpen(false); }}><label>开始日期<input required type="date" value={draft.from} onChange={e => setDraft(d=>({ ...d, from: e.target.value }))} /></label><span aria-hidden="true">—</span><label>结束日期<input required type="date" min={draft.from} value={draft.to} onChange={e => setDraft(d=>({ ...d, to: e.target.value }))} /></label><button type="submit" className="secondary">查询</button></form>
      {rangeError&&<p className="action-error" role="alert">{rangeError}</p>}
      <p className="boss-period-caption">{snapshot ? `${snapshot.period.from} 至 ${snapshot.period.to}` : loading ? "正在读取统计区间…" : "统计暂不可用"}<span className="boss-updated">{!loading && updated ? `${updated} 更新` : ""}<button type="button" className="overview-refresh boss-refresh-icon" disabled={loading} aria-label={loading ? "读取中" : "刷新数据"} title="刷新数据" onClick={() => setTick(t => t + 1)}><DashboardIcon name="refresh" /></button></span></p>
    </section>
    {!!errors.length && <div className="overview-error" role="alert"><strong>部分数据未能加载</strong>{errors.map(e => <p key={e}>{e}</p>)}<button type="button" onClick={() => setTick(t => t + 1)}>重新加载</button></div>}
    {DemoP0Summary?<Suspense fallback={<p role="status">正在读取演示指标…</p>}><DemoP0Summary preset={preset} range={range} tick={tick} onOpenBusiness={onOpenBusiness}/></Suspense>:<LiveBusinessOverview preset={preset} range={range} tick={tick} onOpenBusiness={onOpenBusiness}/>}
    {snapshot&&snapshot.dataCounts.fans===0&&snapshot.dataCounts.editor===0&&<p className="overview-empty-banner">该区间暂无加粉或拍剪填报。</p>}
    <div className="boss-core-grid boss-secondary-grid">
      <section className="boss-panel boss-fans"><div className="panel-heading"><div><span className="dashboard-eyebrow">全公司 / 客户增长</span><h2>加粉数据<InfoTip label="加粉数据口径" text={`加粉按全公司统计，区间新增和区间有效按日相加；月累计取截止日所在月份各主页最后一次上报快照，不把每天的月累计相加。按客服接待账号归属统计。趋势线为截至 ${series?.to ?? today} 的近 7 天，虚线为今天（未结束），断开处为当天无填报。`} /></h2></div>{link("summary", "查看明细")}</div><LeadHomePreview from={snapshot?.period.from??today} to={snapshot?.period.to??today} today={today} tick={tick}/><div className="boss-fan-headline"><div className="boss-feature-value boss-repeat"><span>日报新增</span><strong>{metric(m?.fanAddedTotal)}<small>人</small></strong></div><div className="boss-valid"><span>区间有效</span><b>{metric(m?.validToday)}<small>人</small></b></div></div>{spark(320, 40) && <div className="boss-fan-trend"><span>近 7 天</span>{spark(320, 40)}</div>}<div className={`boss-channel-list ${monthView ? "is-month" : ""}`}>{channel("Messenger", "channel-ms", m?.msToday, m?.msMonth)}{channel("WhatsApp", "channel-ws", m?.wsToday, m?.wsMonth)}</div>{m?.statsIncomplete && <p className="data-flag">含未分类旧加粉 {m.legacyUnclassifiedAdded ?? 0} 人 · 渠道不完整</p>}</section>
    </div>
    <details className="boss-panel boss-video boss-video-fold">
      <summary className="boss-video-summary">
        <div><span className="dashboard-eyebrow">全公司 / 内容供给</span><h2>视频拍剪数据<InfoTip label="视频素材口径" text="拍剪按全公司统计，拍摄、剪辑与发给运营按区间累计；“发给运营”不等于已发布。库存按拍剪师和人设分别取区间内最后一次快照再合计，不按天累加。" /></h2></div>
        <span onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{link("editor", "查看明细")}</span>
      </summary>
      <div className="boss-feature-value boss-repeat"><span>区间末次库存</span><strong>{snapshot?.dataCounts.editor === 0 ? "—" : metric(m?.endingInventory)}<small>条</small></strong></div>
      <div className="boss-mini-metrics">{[["拍摄", m?.shootCount], ["剪辑", m?.editCount], ["发给运营", m?.sentToOpsCount]].map(([label, value]) => <div key={label}><span>{label}</span><b>{metric(value)}</b></div>)}</div>
    </details>
  </div>;
}
