import { useEffect, useState } from "react";
import type { LiveBusinessData } from "../api";
import { AnalysisPlot, ChartStyleControl, useChartStyle } from "./AnalysisChart";
import { buildAccountTrends } from "./opsAccountTrendData";
import { useReferenceQuotes } from "./useReferenceQuotes";
import { type TrendSeries } from "./bossTrendData";
import type { BossPriorityData, BossTrendRow } from "./BossPriority";
import { bossPriorityApi } from "./BossPriority";
import { InfoTip } from "../InfoTip";

type Key = "total" | "grossProfit" | "ads" | "operatingCost";
const labels: Record<Key, string> = {
  total: "总业绩",
  grossProfit: "经营毛利",
  ads: "投流成本",
  operatingCost: "运营成本"
};

export default function BossHomeTrend({
  today,
  from,
  to,
  tick,
  live,
  priorityData
}: {
  today: string;
  from: string;
  to: string;
  tick: number;
  live: LiveBusinessData | null;
  priorityData?: BossPriorityData | null;
}) {
  const managed = priorityData !== undefined;
  const [metric, setMetric] = useState<Key>("total");
  const [style, setStyle] = useChartStyle();
  const [selected, setSelected] = useState(to);
  const [localTrend, setLocalTrend] = useState<BossTrendRow[] | null>(null);
  const [ads, setAds] = useState<TrendSeries | null>(null);
  const [error, setError] = useState("");
  const revision = useReferenceQuotes();

  useEffect(() => {
    setSelected(to);
  }, [from, to, tick]);

  useEffect(() => {
    if (managed) return;
    const controller = new AbortController();
    setLocalTrend(null);
    setError("");
    fetch(bossPriorityApi + "?" + new URLSearchParams({ from, to }), { signal: controller.signal, cache: "no-store", credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "趋势读取失败");
        if (!controller.signal.aborted) {
          setLocalTrend(data.trend || data.days);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "趋势读取失败");
      });
    return () => controller.abort();
  }, [managed, from, to, tick]);

  const rows: BossTrendRow[] | null = managed
    ? (priorityData ? (priorityData.trend ?? priorityData.days) : null)
    : localTrend;

  useEffect(() => {
    let active = true;
    setAds(null);
    if (rows && live) {
      void buildAccountTrends(
        live.ads.records.map((row) => ({ adAccountRef: "ads", businessDate: row.date, spendUsd: row.amount, consultCount: null })),
        rows.map((day) => day.date),
        ["ads"],
        "spendCny"
      ).then((series) => {
        if (active) setAds(series[0]);
      });
    }
    return () => {
      active = false;
    };
  }, [rows, live, revision]);

  const isSingleDayExpand = from === to && (rows?.length ?? 0) > 1;

  const series: TrendSeries = {
    key: metric,
    label: labels[metric],
    points: (rows || []).map((day) => {
      const adFromLive = ads?.points.find((point) => point.date === day.date);
      let value: string | null = null;
      let reason = "未填报";
      if (metric === "total") {
        value = day.total;
      } else if (metric === "grossProfit") {
        value = day.grossProfit ?? null;
        reason = "暂无当日业务记录";
      } else if (metric === "ads") {
        value = day.adSpendCny ?? (live?.ads.unknownCount ? null : adFromLive?.value ?? null);
        reason = adFromLive?.reason || "未报";
      } else {
        value = day.operatingCost;
        reason = "当日暂无已登记费用";
      }
      return {
        date: day.date,
        value,
        reason,
        count: 0,
        native: day.adSpendUsd ? `${day.adSpendUsd} USD` : "",
        estimated: metric === "ads" || metric === "grossProfit"
      };
    })
  };

  return (
    <section className="bh-trend" aria-label="首页经营趋势">
      <header>
        <h2>
          经营趋势{isSingleDayExpand && <small className="bh-trend-sub">近 7 日</small>}
          <InfoTip
            label="首页趋势口径"
            text="选中「今日」自动展示近 7 日走势并高亮今日。总业绩包含直播间与私推；经营毛利按口径 A 含投流日维度汇总；运营成本按已登记日常运营 + 已核报销绘制（不含待核工资）。"
          />
        </h2>
        <ChartStyleControl style={style} onChange={setStyle} />
      </header>
      <nav aria-label="首页趋势指标">
        {(Object.entries(labels) as [Key, string][]).map(([key, label]) => (
          <button type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
            {label}
          </button>
        ))}
      </nav>
      {error ? (
        <p className="error" role="alert">{error}</p>
      ) : !rows ? (
        <p role="status">正在读取趋势…</p>
      ) : (
        <AnalysisPlot series={[series]} style={style} today={today} selected={selected} onSelect={setSelected} label={labels[metric]} />
      )}
    </section>
  );
}
