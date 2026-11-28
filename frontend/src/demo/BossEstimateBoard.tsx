import BossPriority, { bossPriorityApi, type BossPriorityData } from "./BossPriority";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FinanceData, type LiveBusinessData } from "../api";
import { InfoTip } from "../InfoTip";
import type { Page } from "../access";
import type { CashView } from "../cashNavigation";
import { yuan } from "../dashboardDisplay";
import { createRequestGate } from "../requestGate";
import { toErrorMessage } from "../errors";
import { buildEstimateView, type EstimateSources } from "./estimateBoardData";
import { convertAdSpend, referenceFxClient, FX_REFRESH_MS, type AdFxView } from "./adExchangeRates";
import { buildCashBoard, formatCashValue, formatPendingCash } from "./cashBoardData";
import { loadCashOrderBalances, useBossCashPending, type CashOrderBalances } from "./useBossCashPending";
import BossHomeTrend from "./BossHomeTrend";
import "./boss-estimate-board.css";
import "./customer-payment-summary.css";
import { useReferenceQuotes } from "./useReferenceQuotes";
import { dashboardPresetRange } from "../dates";
import { PeriodToolbar } from "../PeriodToolbar";
import { buildTrend, previousRange, type TrendKey } from "./bossTrendData";
import { defaultLiveView } from "../liveBusinessNavigation";
import type { WorkspaceRoute } from "../workspaceHistory";

const filters = { room: "", host: "", persona: "", operator: "" };
const presets = [["day", "今日"], ["week", "本周"], ["month", "本月"]] as const;
const spendTip = "广告消耗按消耗日统计。美元金额按消耗日参考汇率折算为人民币，原美元金额保留。";
const presetKey = "cms-demo-boss-estimate-period";

const structureColors: Record<string, string> = {
  material: "#4e7c6f",
  afterSaleAndFee: "#8f6b32",
  ads: "#c58a2e",
  operating: "#59738c",
  netProfit: "#144e41"
};

function InlinePaymentAmount({ value }: { value: string }) {
  return <strong>{value.startsWith("约 ") ? <><span className="payment-inline-approximation">约{" "}</span>{value.slice(2)}</> : value}</strong>;
}

function moneyText(v: string | null | undefined) {
  if (v == null) return "—";
  const num = Number(v);
  if (!Number.isFinite(num)) return "—";
  const abs = Math.abs(num).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return num < 0 ? `-¥${abs}` : `¥${abs}`;
}

export default function BossEstimateBoard({
  today,
  onError,
  onOpen,
  onDrill
}: {
  today: string;
  onError: (value: string) => void;
  onOpen?: (page: Page, cash?: CashView) => void;
  onDrill?: (route: WorkspaceRoute) => void;
}) {
  const [preset, setPreset] = useState<(typeof presets)[number][0]>(() => {
    try {
      const saved = sessionStorage.getItem(presetKey);
      return saved === "week" || saved === "month" ? saved : "day";
    } catch {
      return "day";
    }
  });
  const [custom, setCustom] = useState<{ from: string; to: string }>();
  const [live, setLive] = useState<LiveBusinessData | null>(null);
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [cashOrders, setCashOrders] = useState<CashOrderBalances>();
  const [cashLoading, setCashLoading] = useState(true);
  const [legacy, setLegacy] = useState<EstimateSources | null>(null);
  const [priorityData, setPriorityData] = useState<BossPriorityData | null>(null);
  const [priorityError, setPriorityError] = useState("");
  const [loading, setLoading] = useState(true);
  const [liveFailed, setLiveFailed] = useState(false);
  const [gate] = useState(() => createRequestGate());
  const [fxClient] = useState(() => referenceFxClient("USD"));
  const checked = useRef(0);
  const [adFx, setAdFx] = useState<AdFxView | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [trendTick, setTrendTick] = useState(0);
  const [baseline, setBaseline] = useState<Partial<Record<TrendKey, string | null>>>({});
  const [baselineLoading, setBaselineLoading] = useState(true);
  const revision = useReferenceQuotes();
  const view = buildEstimateView(live, legacy);
  const period = custom || dashboardPresetRange(today, preset);
  const cash = useMemo(() => (finance ? buildCashBoard(finance, period) : null), [finance, period.from, period.to]);
  const pendingCash = useBossCashPending(period.to, cashOrders, cash?.pending);
  const receivedAmount = cashLoading ? "…" : !cash ? "—" : cash.totalCny === null ? "待核对" : `¥${formatCashValue(cash.totalCny)}`;
  const unconfirmedAmount = cashLoading ? "…" : !cash ? "—" : `¥${formatCashValue(cash.unconfirmedThirdPartyCny)}`;
  const outstandingAmount = loading || cashLoading || pendingCash.loading ? "…" : formatPendingCash(pendingCash.value?.total);

  function drill(kind: "income" | "expenses" | "ads", room?: string) {
    if (kind === "ads") onDrill?.({ page: "ops", ops: { ...period } });
    else onDrill?.({ page: "orders", live: { ...defaultLiveView(), preset, range: { ...period }, view: kind, ...(room ? { room } : {}) } });
  }

  const benchmark = (key: TrendKey) => (
    <span className="be-baseline">
      <span>{preset === "day" ? "昨日已登记" : "上期已登记"}</span>
      <b>{baselineLoading ? "…" : baseline[key] == null ? "—" : `${key === "receipts" || key === "ads" ? "约 " : ""}${yuan(baseline[key]!)}`}</b>
    </span>
  );

  function pickPreset(next: (typeof presets)[number][0]) {
    setPreset(next);
    setCustom(undefined);
    try {
      sessionStorage.setItem(presetKey, next);
    } catch {
      /* The in-memory selection still works when storage is disabled. */
    }
  }

  async function load(next = preset) {
    const ticket = gate.next();
    checked.current = Date.now();
    setLoading(true);
    setLive(null);
    setFinance(null);
    setCashOrders(undefined);
    setCashLoading(true);
    setLegacy(null);
    setPriorityData(null);
    setPriorityError("");
    setAdFx(null);
    setFxLoading(true);
    setBaseline({});
    setBaselineLoading(true);
    const range = custom || dashboardPresetRange(today, next);
    const previous = previousRange(range.from, range.to);

    void api.liveBusiness("custom", { from: previous.from, to: range.to }, filters)
      .then((source) => buildTrend(source, range))
      .then((result) => {
        if (ticket.isCurrent()) setBaseline(result.previous);
      })
      .catch(() => {
        if (ticket.isCurrent()) setBaseline({});
      })
      .finally(() => {
        if (ticket.isCurrent()) setBaselineLoading(false);
      });

    void Promise.allSettled([api.finance(), loadCashOrderBalances(range.to)]).then(([financeResult, ordersResult]) => {
      if (!ticket.isCurrent()) return;
      setFinance(financeResult.status === "fulfilled" ? financeResult.value : null);
      setCashOrders(ordersResult.status === "fulfilled" ? ordersResult.value : undefined);
      setCashLoading(false);
    });

    const priorityFetch = fetch(bossPriorityApi + "?" + new URLSearchParams({ from: range.from, to: range.to }), {
      cache: "no-store",
      credentials: "include"
    }).then(async (r) => {
      const payload = await r.json();
      if (!r.ok || payload.version !== "boss-priority/v1") throw Error(payload.error || "首页数据读取失败");
      return payload as BossPriorityData;
    });

    const [liveResult, legacyResult, priorityResult] = await Promise.allSettled([
      api.liveBusiness(custom ? "custom" : next, custom, filters),
      api.dashboard(custom ? "custom" : next, custom),
      priorityFetch
    ]);
    if (!ticket.isCurrent()) return;
    setLive(liveResult.status === "fulfilled" ? liveResult.value : null);
    setLegacy(legacyResult.status === "fulfilled" ? legacyResult.value : null);
    if (priorityResult.status === "fulfilled") {
      setPriorityData(priorityResult.value);
      setPriorityError("");
    } else {
      setPriorityData(null);
      setPriorityError(priorityResult.reason instanceof Error ? priorityResult.reason.message : "首页数据读取失败");
    }
    setLiveFailed(liveResult.status === "rejected");
    onError(liveResult.status === "rejected" && legacyResult.status === "rejected" ? toErrorMessage(liveResult.reason, "加载经营估算失败") : "");
    setLoading(false);
    setTrendTick((n) => n + 1);
  }

  useEffect(() => {
    let active = true;
    setAdFx(null);
    setFxLoading(true);
    const usd = live?.ads.spendUsd ?? legacy?.opsUsd.spendUsd ?? priorityData?.grossProfit?.adSpendUsd;
    if (usd == null) {
      setFxLoading(false);
      return;
    }
    void convertAdSpend(live?.ads.records ?? [], usd, fxClient.get, live?.ads.unknownCount ?? 0)
      .then((result) => {
        if (active) setAdFx(result);
      })
      .finally(() => {
        if (active) setFxLoading(false);
      });
    return () => {
      active = false;
    };
  }, [live, legacy, priorityData, revision, fxClient]);

  useEffect(() => {
    void load(preset);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(preset);
    }, FX_REFRESH_MS);
    const resume = () => {
      if (!document.hidden && Date.now() - checked.current >= FX_REFRESH_MS) void load(preset);
    };
    document.addEventListener("visibilitychange", resume);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      gate.next();
    };
  }, [preset, custom?.from, custom?.to]);

  const pendingVerificationCount =
    priorityData?.attention?.pendingPaymentVerifications ??
    (live?.operations?.orders.filter((order) => order.status === "unknown").length ?? 0);
  const missingCostCount = priorityData?.attention?.missingMaterialCostOrders ?? priorityData?.grossProfit?.missingMaterialCostCount ?? 0;
  const pendingExpAndWhCount = priorityData?.attention?.pendingExpensesAndWarehouse ?? live?.legacyCost.count ?? 0;
  const hasAttention = pendingVerificationCount > 0 || missingCostCount > 0 || pendingExpAndWhCount > 0;

  const structure = priorityData?.structure;
  const positiveItems = structure?.items.filter((item) => Number(item.amount) > 0) ?? [];
  const barTotal = positiveItems.reduce((sum, item) => sum + Math.max(0, Number(item.amount)), 0);
  const channelProfits = priorityData?.channelProfits ?? [];

  return (
    <section className="be-board" aria-label="经营总览" aria-busy={loading}>
      <header className="be-heading">
        <div>
          <h1>
            经营总览{" "}
            <InfoTip
              label="首页统计口径"
              text="开单按开单日、公司已到账按到账日、售后费用按发生日、广告按消耗日统计。经营毛利按口径 A 扣减料本、售后、第三方扣点与投流成本；工资未核算时不隐藏已登记日常运营和已核报销。"
            />
          </h1>
        </div>
      </header>

      <PeriodToolbar
        today={today}
        preset={preset}
        custom={custom}
        onPreset={pickPreset}
        onCustom={(next) => setCustom(next)}
        caption={view ? `全公司 · ${view.period.from} 至 ${view.period.to} · 今日未结束` : `全公司 · ${period.from} 至 ${period.to}`}
        actions={<button type="button" className="secondary" onClick={() => load()}>刷新</button>}
        ariaLabel="经营总览日期筛选"
      />

      {hasAttention && (
        <section className="bh-attention" aria-label="经营待关注">
          <strong>经营待关注</strong>
          {pendingVerificationCount > 0 && (
            <button type="button" onClick={() => onOpen?.("finance", { ...period, metric: "receipts", scope: "company" })}>
              待财务确认收款 <b>{pendingVerificationCount}</b> 笔 ›
            </button>
          )}
          {missingCostCount > 0 && (
            <button type="button" onClick={() => drill("expenses")}>
              待补本价订单 <b>{missingCostCount}</b> 单 ›
            </button>
          )}
          {pendingExpAndWhCount > 0 && (
            <button type="button" onClick={() => onOpen?.("finance", { ...period, metric: "receipts", scope: "company" })}>
              费用 / 库房待核 <b>{pendingExpAndWhCount}</b> 笔 ›
            </button>
          )}
        </section>
      )}

      <BossPriority
        from={period.from}
        to={period.to}
        tick={trendTick}
        priorityData={priorityData}
        priorityError={priorityError}
        onRetry={() => void load(preset)}
        onSalary={() => onOpen?.("salaries")}
        onProfitDetail={() => drill("expenses")}
        ads={({ total, data }) => {
          const adCnyStr = adFx?.cny != null && !adFx.missingDates.length ? adFx.cny : (data?.grossProfit?.adSpendCny ?? null);
          const adCnyNum = adCnyStr != null ? Number(adCnyStr) : null;
          const totalNum = total != null ? Number(total) : 0;
          const feeRateText = adCnyNum != null && totalNum > 0 ? `${((adCnyNum / totalNum) * 100).toFixed(1)}%` : "0.0%";
          const roiText = adCnyNum != null && adCnyNum > 0 ? (totalNum / adCnyNum).toFixed(2) : "—";
          const acq = data?.acquisition;
          const usdStr = view?.adUsd ?? data?.grossProfit?.adSpendUsd ?? "—";
          return (
            <article className="bp-ads" aria-label="投流成本">
              <header>
                <h2>投流成本</h2>
                <InfoTip scrollable label="广告消耗口径" text={spendTip} />
                <span className="bp-chip bp-gold">费比 {feeRateText} · ROI {roiText}</span>
              </header>
              <strong className="bp-main-number">
                {loading ? "…" : fxLoading && adCnyStr == null ? <span className="fx-pending">折算中…</span> : adCnyStr != null ? `约 ${moneyText(adCnyStr)}` : "待折算"}
              </strong>
              <small className="bp-subline">
                原币 {loading ? "…" : usdStr} USD{adFx?.stale ? " · 行情延迟" : ""} · {benchmark("ads")}
              </small>
              <div className="bp-efficiency">
                <div>
                  <span>总进粉</span>
                  <b>{acq ? `${acq.totalFans}` : "—"}</b>
                </div>
                <div>
                  <span>有效粉</span>
                  <b>{acq?.effectiveFans != null ? `${acq.effectiveFans}` : "—"}</b>
                </div>
                <div>
                  <span>单有效粉成本</span>
                  <b>{acq?.costPerEffectiveFanCny != null ? moneyText(acq.costPerEffectiveFanCny) : "—"}</b>
                </div>
              </div>
              <button type="button" className="bp-link" onClick={() => drill("ads")}>
                进入投流数据分析 →
              </button>
            </article>
          );
        }}
        receipts={
          <div className="bp-cash">
            {[
              ["实收已到账", receivedAmount],
              ["待财务确认", unconfirmedAmount],
              ["待收尾款", outstandingAmount]
            ].map(([label, value]) => (
              <button key={label} type="button" onClick={() => onOpen?.("finance", { ...period, metric: "receipts", scope: "company" })}>
                <span>{label}</span>
                <InlinePaymentAmount value={value} />
              </button>
            ))}
          </div>
        }
      />

      {structure && (
        <section className="bp-structure-card" aria-label="本期收支结构与预估净利">
          <header className="bp-structure-head">
            <h2>本期收支结构与预估净利</h2>
            <span className={"bp-net-summary " + (Number(structure.estimatedNetProfit) < 0 ? "is-negative" : "")}>
              预估净利 <strong>{moneyText(structure.estimatedNetProfit)}</strong>
              <small>
                （净利率 {structure.netMargin.toFixed(1)}%{structure.includesPayroll ? "" : "，不含待核工资"}）
              </small>
            </span>
          </header>
          <div className="bp-stacked-bar" role="img" aria-label="收支结构占比条">
            {barTotal > 0 ? (
              positiveItems.map((item) => {
                const widthPct = (Math.max(0, Number(item.amount)) / barTotal) * 100;
                return (
                  <span
                    key={item.key}
                    className="bp-bar-seg"
                    style={{ width: `${Math.max(widthPct, 1.5)}%`, background: structureColors[item.key] || "#7d8b85" }}
                    title={`${item.label}：${moneyText(item.amount)} (${item.ratio.toFixed(1)}%)`}
                  />
                );
              })
            ) : (
              <span className="bp-bar-empty">暂无可占比收支数据</span>
            )}
          </div>
          <ul className="bp-structure-legend">
            {structure.items.map((item) => (
              <li key={item.key}>
                <i style={{ background: Number(item.amount) < 0 && item.key === "netProfit" ? "#b54738" : structureColors[item.key] || "#7d8b85" }} />
                <span>{item.label}</span>
                <b>{moneyText(item.amount)}</b>
                <small>{item.ratio.toFixed(1)}%</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {liveFailed && <p className="notice">开单、收款和售后费用暂不可用。</p>}

      <div className="bp-bottom-grid">
        <BossHomeTrend today={today} from={period.from} to={period.to} tick={trendTick} live={live} priorityData={priorityData} />

        <section className="bp-channel-card" aria-label="直播间与渠道毛利速览">
          <header>
            <h2>
              直播间与渠道毛利速览
              <InfoTip label="渠道毛利口径" text="各直播间及私推渠道均按口径 A 核算：有效业绩减料本、售后、第三方扣点与按业绩占比分摊的投流成本；点击任意行下钻直播间经营。" />
            </h2>
            <button type="button" className="text-action" onClick={() => drill("income")}>
              全部明细 →
            </button>
          </header>
          {!priorityData ? (
            <p role="status">正在汇总渠道毛利…</p>
          ) : !channelProfits.length ? (
            <p className="empty-state">当前日期范围暂无有效成交渠道记录。</p>
          ) : (
            <div className="bp-channel-table-wrap">
              <table className="bp-channel-table">
                <thead>
                  <tr>
                    <th>渠道 / 直播间</th>
                    <th>单数</th>
                    <th>有效业绩</th>
                    <th>料本+售后</th>
                    <th>投流</th>
                    <th>经营毛利</th>
                    <th>毛利率</th>
                  </tr>
                </thead>
                <tbody>
                  {channelProfits.map((row) => (
                    <tr
                      key={row.id}
                      className="bp-channel-row"
                      tabIndex={0}
                      onClick={() => drill("income", row.isPrivate ? undefined : row.roomCode === "unassigned" ? "__unassigned__" : row.roomCode)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          drill("income", row.isPrivate ? undefined : row.roomCode === "unassigned" ? "__unassigned__" : row.roomCode);
                        }
                      }}
                    >
                      <td>
                        <strong>{row.name}</strong>
                      </td>
                      <td>{row.count}</td>
                      <td>{moneyText(row.turnover)}</td>
                      <td>{moneyText(row.materialAndAfterSale)}</td>
                      <td>{moneyText(row.adSpendCny)}</td>
                      <td className={Number(row.grossProfit) < 0 ? "is-neg" : "is-pos"}>{moneyText(row.grossProfit)}</td>
                      <td>
                        <span className={"bp-margin-pill " + (row.grossMargin < 0 ? "is-neg" : "")}>{row.grossMargin.toFixed(1)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
