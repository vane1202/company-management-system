import { useEffect, useState } from "react";
import { InfoTip } from "./InfoTip";
import { Skeleton } from "./Skeleton";
import {
  differenceDirectionLabel,
  finalContributionLabel,
  formatClock,
  formatCny,
  formatDelta,
  formatMultiple,
  displayOriginalAmounts,
  formatOriginalAmounts,
  loadBossOverview,
  pendingCaliber,
  showMonthTarget,
  type BossOverviewLoad,
  type BossOverviewResponse,
  type ComparisonDelta,
  type MoneyMetric,
  type RatioMetric
} from "./bossOverviewContract";

const TURNOVER_TIP = "定义：开单营业额。分子：开单卡料价＋代购费。分母：无。归属：按开单卡日期。跑单从原开单日扣回，追加收费（设计、雕刻等）不计入。数据来源：开单卡。与下方直播间营业额明细同一口径。";
const COLLECTIONS_TIP = "定义：已收款，两个来源并列，不合并。① 客服登记收款流水，按付款日、原币种入账后再按配置汇率折成人民币。② 财务核定「已付款业绩」（按日、直播间、主播一条）。差额＝客服登记折算合计－财务核定折算合计。数据来源：客户收款流水、财务核定记录。预估净贡献和 ROI 暂按两个来源分别计算，已收款口径待定。";
const COST_TIP = "定义：可见成本＝直播间费用＋广告消耗，均折算人民币。直播间费用只展示现有「费用发生日」字段，暂不拆分主播薪酬、提成、料成本；可能与财务录入的料成本、提成有重叠，口径待定。广告消耗为全公司所选日期范围的实际投放，现为美元，按配置汇率折算。工资、公司付款、料成本、提成、代收手续费不计入可见成本。";
const NET_TIP = "定义：两层净贡献，标签不得混用。预估净贡献＝已收款－可见成本，系统自动算，未扣料成本、提成、代收手续费。因「已收款」用客服登记还是财务核定尚未确认，此处按两个来源分别展示，并标口径待定。最终净贡献＝预估净贡献－料成本－提成－代收手续费，这三项由财务录入；未录入时只显示「待财务核算」，不用预估值代替。";
const ROI_TIP = "定义：ROI＝分子÷广告消耗（折算人民币）。默认分子为已收款，可切换为开单营业额。已收款来源待确认时，按客服登记与财务核定分别给出倍数。广告消耗为 0 或缺汇率时不计算。数据来源：已收款（见已收款说明）、开单营业额、广告消耗。";

type Props = {
  preset: string;
  range?: { from: string; to: string };
  tick: number;
  onRetry: () => void;
};

export function BossConclusionStrip({ preset, range, tick, onRetry }: Props) {
  const [load, setLoad] = useState<BossOverviewLoad | { status: "loading" }>({ status: "loading" });
  const [roiBasis, setRoiBasis] = useState<"collections" | "turnover">("collections");

  useEffect(() => {
    let active = true;
    setLoad({ status: "loading" });
    loadBossOverview(preset, range).then(result => {
      if (!active) return;
      setLoad(result);
      if (result.status === "ready") setRoiBasis(result.data.roi.default_basis ?? "collections");
    });
    return () => { active = false; };
  }, [preset, range?.from, range?.to, tick]);

  if (load.status === "not_implemented") {
    return <section className="boss-conclusion-strip is-pending" aria-label="经营结论">
      <h2>今日结论</h2>
      <p className="boss-conclusion-pending">数据待接入</p>
      <p className="live-scope">经营结论条接口尚未提供。现有直播间明细仍可查看；指标计算由后续后端按已确认口径提供。</p>
    </section>;
  }

  if (load.status === "error") {
    return <div className="overview-error" role="alert">
      <strong>经营结论暂不可用</strong>
      <p>{load.message}</p>
      <button type="button" onClick={onRetry}>重试经营结论</button>
    </div>;
  }

  const loading = load.status === "loading";
  const data = load.status === "ready" ? load.data : null;
  const periodName = data?.period.label ?? (range ? "自定义区间" : preset === "week" ? "本周" : preset === "month" ? "本月" : "今日");
  const title = `${periodName}结论`;

  return <section className="boss-conclusion-strip" aria-label="经营结论" aria-busy={loading}>
    <header className="boss-conclusion-head">
      <div>
        <h2>{title}</h2>
        {data?.flags.caliber_pending.length ? <span className="data-flag">部分口径待定</span> : null}
      </div>
    </header>
    {data?.fx.prompt && <p className="data-flag" role="status">{data.fx.prompt}</p>}
    <div className="boss-conclusion-grid">
      <article className="boss-conclusion-card">
        <header><h3>营业额<InfoTip label="营业额口径" text={TURNOVER_TIP} /></h3></header>
        <p className="boss-conclusion-value">{loading ? <Skeleton width="5em" height="1.1em" /> : formatCny(data?.turnover.cny_total, data?.turnover.status)}</p>
        <p className="boss-conclusion-original">{loading ? "" : displayOriginalAmounts(data?.turnover)}</p>
        <Comparisons metric={data?.turnover} preset={preset} rangeSelected={!!range} missingTarget={!!data?.flags.missing_month_target} loading={loading} />
      </article>
      <article className="boss-conclusion-card">
        <header><h3>可见成本<InfoTip label="可见成本口径" text={COST_TIP} /></h3></header>
        <p className="boss-conclusion-value">{loading ? <Skeleton width="5em" height="1.1em" /> : formatCny(data?.visible_cost.total.cny_total, data?.visible_cost.total.status)}</p>
        <p className="boss-conclusion-original">{loading ? "" : costBreakdown(data)}</p>
        <Comparisons metric={data?.visible_cost.total} preset={preset} rangeSelected={!!range} missingTarget={!!data?.flags.missing_month_target} loading={loading} />
      </article>
      <article className="boss-conclusion-card boss-conclusion-span">
        <header><h3>已收款<InfoTip label="已收款口径" text={COLLECTIONS_TIP} /></h3>{pendingCaliber(data?.flags, "net_contribution_collection_source") && <span className="data-flag">口径待定</span>}</header>
        <div className="boss-conclusion-dual">
          <div>
            <span>客服登记收款</span>
            <strong>{loading ? <Skeleton width="4.5em" height="1em" /> : formatCny(data?.collections.customer_payments.cny_total, data?.collections.customer_payments.status)}</strong>
            <small>{loading ? "" : displayOriginalAmounts(data?.collections.customer_payments)}</small>
          </div>
          <div>
            <span>财务核定业绩</span>
            <strong>{loading ? <Skeleton width="4.5em" height="1em" /> : formatCny(data?.collections.finance_paid_performance.cny_total, data?.collections.finance_paid_performance.status)}</strong>
            <small>{loading ? "" : displayOriginalAmounts(data?.collections.finance_paid_performance)}</small>
          </div>
        </div>
        <p className="boss-conclusion-diff">
          差额 <b>{loading ? <Skeleton width="4em" height="0.9em" /> : formatCny(data?.collections.difference.cny_total, data?.collections.difference.status)}</b>
          {data && differenceDirectionLabel(data.collections.difference.direction) && <small> · {differenceDirectionLabel(data.collections.difference.direction)}</small>}
        </p>
        <Comparisons metric={data?.collections.customer_payments} preset={preset} rangeSelected={!!range} missingTarget={!!data?.flags.missing_month_target} loading={loading} />
      </article>
      <article className="boss-conclusion-card boss-conclusion-span">
        <header><h3>净贡献<InfoTip label="净贡献口径" text={NET_TIP} /></h3>{pendingCaliber(data?.flags, "net_contribution_collection_source") && <span className="data-flag">口径待定</span>}</header>
        <p className="boss-conclusion-layer">预估净贡献</p>
        {loading ? <Skeleton width="8em" height="1em" /> : <EstimatedNet data={data} />}
        <p className="boss-conclusion-note">{data?.net_contribution.estimated_note ?? "未扣料成本、提成、代收手续费"}</p>
        <p className="boss-conclusion-layer">最终净贡献</p>
        <p className={`boss-conclusion-final${finalContributionLabel(data?.net_contribution.final).pending ? " is-pending" : ""}`}>
          {loading ? <Skeleton width="6em" height="1em" /> : finalContributionLabel(data?.net_contribution.final).text}
        </p>
      </article>
      <article className="boss-conclusion-card boss-conclusion-span">
        <header>
          <h3>ROI<InfoTip label="ROI 口径" text={ROI_TIP} /></h3>
          <div className="boss-roi-toggle" role="group" aria-label="ROI 分子切换">
            <button type="button" className={roiBasis === "collections" ? "selected" : "secondary"} aria-pressed={roiBasis === "collections"} disabled={loading || !data} onClick={() => setRoiBasis("collections")}>已收款</button>
            <button type="button" className={roiBasis === "turnover" ? "selected" : "secondary"} aria-pressed={roiBasis === "turnover"} disabled={loading || !data} onClick={() => setRoiBasis("turnover")}>营业额</button>
          </div>
        </header>
        {loading ? <Skeleton width="7em" height="1.1em" /> : <RoiBlock data={data} basis={roiBasis} />}
      </article>
    </div>
    <p className="boss-conclusion-updated">{loading ? <Skeleton width="18em" height="0.8em" /> : updateLine(data)}</p>
  </section>;
}

function EstimatedNet({ data }: { data: BossOverviewResponse | null }) {
  if (!data) return <p className="boss-conclusion-value">—</p>;
  const by = data.net_contribution.estimated_by_source;
  if (data.net_contribution.collection_source_used === "pending" && by) {
    return <div className="boss-conclusion-dual">
      <div><span>按客服登记</span><strong>{formatCny(by.customer_payments.cny_total, by.customer_payments.status)}</strong></div>
      <div><span>按财务核定</span><strong>{formatCny(by.finance_paid_performance.cny_total, by.finance_paid_performance.status)}</strong></div>
    </div>;
  }
  return <p className="boss-conclusion-value">{formatCny(data.net_contribution.estimated?.cny_total, data.net_contribution.estimated?.status)}</p>;
}

function RoiBlock({ data, basis }: { data: BossOverviewResponse | null; basis: "collections" | "turnover" }) {
  if (!data) return <p className="boss-conclusion-value">—</p>;
  const metric = basis === "turnover" ? data.roi.values.turnover : data.roi.values.collections_by_source?.customer_payments ?? data.roi.values.collections;
  const body = basis === "turnover"
    ? <RatioLine metric={data.roi.values.turnover} caption="按开单营业额" />
    : (data.roi.collection_source_used === "pending" && data.roi.values.collections_by_source
      ? <div className="boss-conclusion-dual">
          <RatioLine metric={data.roi.values.collections_by_source.customer_payments} caption="按客服登记" />
          <RatioLine metric={data.roi.values.collections_by_source.finance_paid_performance} caption="按财务核定" />
        </div>
      : <RatioLine metric={data.roi.values.collections} caption="按已收款" />);
  return <>
    {body}
    {metric?.denominator_cny && <p className="boss-conclusion-original">广告消耗 ¥ {metric.denominator_cny}</p>}
  </>;
}

function RatioLine({ metric, caption }: { metric?: RatioMetric; caption: string }) {
  return <div>
    <span>{caption}</span>
    <strong>{formatMultiple(metric?.value ?? null)}</strong>
  </div>;
}

function Comparisons({ metric, preset, rangeSelected, missingTarget, loading }: { metric?: MoneyMetric; preset: string; rangeSelected: boolean; missingTarget: boolean; loading: boolean }) {
  if (loading) return <p className="boss-conclusion-comp"><Skeleton width="8em" height="0.75em" /></p>;
  const items = [
    formatDelta(metric?.comparison?.vs_yesterday, "昨"),
    formatDelta(metric?.comparison?.vs_same_weekday_last_week, "周")
  ];
  if (showMonthTarget(preset, rangeSelected, missingTarget, metric?.comparison?.vs_month_target)) {
    items.push(formatDelta(metric?.comparison?.vs_month_target as ComparisonDelta, "目标"));
  }
  const visible = items.filter(item => item.visible);
  if (!visible.length) return null;
  const onlyDashes = visible.every(item => item.text.endsWith(" —"));
  return <p className={`boss-conclusion-comp${onlyDashes ? " is-empty" : ""}`}>{visible.map(item => <span key={item.text}>{item.text}</span>)}</p>;
}

function costBreakdown(data: BossOverviewResponse | null): string {
  if (!data) return "";
  const live = data.visible_cost.live_expenses;
  const ads = data.visible_cost.ads;
  const adsOriginal = formatOriginalAmounts(ads.original);
  return `直播间费用 ${formatCny(live.cny_total, live.status)} ＋ 广告 ${formatCny(ads.cny_total, ads.status)}${adsOriginal ? `（${adsOriginal}）` : ""}`;
}

function fxLine(data: BossOverviewResponse | null): string {
  if (!data) return "";
  const rows = (data.fx.rates_used ?? []).filter(rate => rate.currency !== "CNY");
  if (!rows.length) return "本期金额均为人民币，无需折算";
  const dates = [...new Set(rows.map(rate => rate.effective_on))];
  const rates = rows.map(rate => `1 ${rate.currency}=${rate.rate}`).join("、");
  return `汇率 ${rates} CNY${dates.length === 1 ? `（${dates[0]} 起）` : "（" + rows.map(rate => `${rate.currency} ${rate.effective_on} 起`).join("；") + "）"}`;
}

function updateLine(data: BossOverviewResponse | null): string {
  if (!data) return "";
  const labels: [string, string | null][] = [
    ["客服收款", data.updated_at.customer_payments],
    ["财务核定", data.updated_at.paid_performance],
    ["费用", data.updated_at.live_expenses],
    ["广告", data.updated_at.ads],
    ["财务核算", data.updated_at.finance_costing]
  ];
  const updates = "更新：" + labels.map(([name, value]) => `${name} ${formatClock(value) ?? "待接入"}`).join(" · ");
  const fx = fxLine(data);
  return fx ? `${fx} · ${updates}` : updates;
}
