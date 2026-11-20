import BossPriority from "./BossPriority";
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
const spendTip = "广告消耗按消耗日统计。美元金额按消耗日参考汇率折算为人民币，原美元金额保留。今日每小时检查最新行情（免费行情约延迟15分钟），历史日期使用当日参考汇率，跨日逐日折算后汇总。不代表实际扣款或结汇金额。";
const presetKey = "cms-demo-boss-estimate-period";

function InlinePaymentAmount({ value }: { value: string }) {
  return <strong>{value.startsWith("约 ") ? <><span className="payment-inline-approximation">约{" "}</span>{value.slice(2)}</> : value}</strong>;
}

export default function BossEstimateBoard({ today, onError, onOpen, onDrill }: { today: string; onError: (value: string) => void; onOpen?: (page: Page, cash?: CashView) => void; onDrill?: (route: WorkspaceRoute) => void }) {
  const [preset, setPreset] = useState<(typeof presets)[number][0]>(() => {
    try { const saved = sessionStorage.getItem(presetKey); return saved === "week" || saved === "month" ? saved : "day"; } catch { return "day"; }
  });
  const [custom,setCustom]=useState<{from:string;to:string}>();
  const [dateDraft,setDateDraft]=useState({from:today,to:today});
  const [dateError,setDateError]=useState("");
  const [live, setLive] = useState<LiveBusinessData | null>(null);
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [cashOrders, setCashOrders] = useState<CashOrderBalances>();
  const [cashLoading, setCashLoading] = useState(true);
  const [legacy, setLegacy] = useState<EstimateSources | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveFailed, setLiveFailed] = useState(false);
  const [legacyFailed, setLegacyFailed] = useState(false);
  const [gate] = useState(() => createRequestGate());
  const [fxClient] = useState(() => referenceFxClient("USD"));
  const checked = useRef(0);
  const [adFx, setAdFx] = useState<AdFxView | null>(null);
  const [fxLoading, setFxLoading] = useState(false);
  const [trendTick, setTrendTick] = useState(0);
  const [baseline, setBaseline] = useState<Partial<Record<TrendKey, string | null>>>({});
  const [baselineLoading, setBaselineLoading] = useState(true);
  const revision=useReferenceQuotes();
  const view = buildEstimateView(live, legacy);
  const period = custom || dashboardPresetRange(today, preset);
  const cash = useMemo(() => finance ? buildCashBoard(finance, period) : null, [finance, period.from, period.to]);
  const pendingCash = useBossCashPending(period.to, cashOrders, cash?.pending);
  const receivedAmount = cashLoading ? "…" : !cash ? "—" : cash.totalCny === null ? "待核对" : `¥${formatCashValue(cash.totalCny)}`;
  const outstandingAmount = loading || cashLoading || pendingCash.loading ? "…" : formatPendingCash(pendingCash.value?.total);
  function drill(kind: "income" | "expenses" | "ads") {
    if (kind === "ads") onDrill?.({ page: "ops", ops: { ...period } });
    else onDrill?.({ page: "orders", live: { ...defaultLiveView(), preset, range: { ...period }, view: kind } });
  }
  const benchmark = (key: TrendKey) => <span className="be-baseline"><span>{preset === "day" ? "昨日已登记" : "上期已登记"}</span><b>{baselineLoading ? "…" : baseline[key] == null ? "—" : `${key === "receipts" || key === "ads" ? "约 " : ""}${yuan(baseline[key]!)}`}</b></span>;
  function pickPreset(next: (typeof presets)[number][0]) {
    setPreset(next);setCustom(undefined);
    try { sessionStorage.setItem(presetKey, next); } catch { /* The in-memory selection still works when storage is disabled. */ }
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
    setAdFx(null);
    setFxLoading(true);
    setBaseline({}); setBaselineLoading(true);
    const range = custom || dashboardPresetRange(today, next), previous = previousRange(range.from, range.to);
    void api.liveBusiness("custom", { from: previous.from, to: range.to }, filters)
      .then(source => buildTrend(source, range))
      .then(result => { if (ticket.isCurrent()) setBaseline(result.previous); })
      .catch(() => { if (ticket.isCurrent()) setBaseline({}); })
      .finally(() => { if (ticket.isCurrent()) setBaselineLoading(false); });
    void Promise.allSettled([api.finance(),loadCashOrderBalances(range.to)]).then(([financeResult,ordersResult])=>{
      if (!ticket.isCurrent()) return;
      setFinance(financeResult.status==="fulfilled"?financeResult.value:null);
      setCashOrders(ordersResult.status==="fulfilled"?ordersResult.value:undefined);
      setCashLoading(false);
    });
    const [liveResult, legacyResult] = await Promise.allSettled([
      api.liveBusiness(custom?"custom":next, custom, filters),
      api.dashboard(custom?"custom":next,custom)
    ]);
    if (!ticket.isCurrent()) return;
    setLive(liveResult.status === "fulfilled" ? liveResult.value : null);
    setLegacy(legacyResult.status === "fulfilled" ? legacyResult.value : null);
    setLiveFailed(liveResult.status === "rejected");
    setLegacyFailed(legacyResult.status === "rejected");
    onError(liveResult.status === "rejected" && legacyResult.status === "rejected" ? toErrorMessage(liveResult.reason, "加载经营估算失败") : "");
    setLoading(false);
    setTrendTick(n => n + 1);
  }
  useEffect(()=>{let active=true;setAdFx(null);setFxLoading(true);
    const usd=live?.ads.spendUsd??legacy?.opsUsd.spendUsd;
    if(usd==null){setFxLoading(false);return;}
    void convertAdSpend(live?.ads.records??[],usd,fxClient.get,live?.ads.unknownCount??0).then(result=>{if(active)setAdFx(result);}).finally(()=>{if(active)setFxLoading(false);});
    return()=>{active=false;};
  },[live,legacy,revision,fxClient]);

  useEffect(() => {
    void load(preset);
    const timer = window.setInterval(() => { if (!document.hidden) void load(preset); }, FX_REFRESH_MS);
    const resume = () => { if (!document.hidden && Date.now() - checked.current >= FX_REFRESH_MS) void load(preset); };
    document.addEventListener("visibilitychange", resume);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); gate.next(); };
  }, [preset,custom?.from,custom?.to]);
  const money = (value: string | null) => loading ? "…" : yuan(value);
  const fxInfo = adFx?.quotes.map(q => `${q.date}：1 USD = ${Number(q.rate)} CNY；行情时间 ${new Date(q.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）；${q.delayed ? "行情约延迟15分钟" : "当日参考汇率"}${q.sourceDate !== q.date ? `；沿用 ${q.sourceDate} 已发布汇率` : ""}${q.stale ? "；更新延迟，使用最近成功数据" : ""}`).join("。") ?? "";

  const pendingOrders = live?.operations?.orders.filter(order => order.status === "unpaid" || order.status === "partial").length ?? 0;
  const uncertainOrders = live?.operations?.orders.filter(order => order.status === "unknown").length ?? 0;
  return <section className="be-board" aria-label="经营总览" aria-busy={loading}>
    <header className="be-heading">
      <div>
        <h1>经营总览 <InfoTip label="首页统计口径" text="开单按开单日、公司已到账按到账日、售后费用按发生日、广告按消耗日统计。待收金额含截至所选结束日的客户未付余额和第三方代收未转回，外币按截止日参考汇率折算。上期为紧邻的同等天数，今日未结束时只并列已登记金额。"/></h1>
      </div>
    </header>
    <PeriodToolbar
      today={today}
      preset={preset}
      custom={custom}
      onPreset={pickPreset}
      onCustom={next => setCustom(next)}
      caption={view ? `全公司 · ${view.period.from} 至 ${view.period.to} · 今日未结束` : undefined}
      actions={<button type="button" className="secondary" onClick={() => load()}>刷新</button>}
      ariaLabel="经营总览日期筛选"
    />
    <BossPriority from={period.from} to={period.to} tick={trendTick} onSalary={()=>onOpen?.("salaries")} receipts={
      <button type="button" className="payment-inline-button"
        aria-label={`实收金额 ${receivedAmount}，待收金额 ${outstandingAmount}，查看收款与到账`}
        onClick={()=>onOpen?.("finance",{...period,metric:"receipts",scope:"company"})}>
        <span className="payment-inline-metrics">
          <span><span>实收金额</span><InlinePaymentAmount value={receivedAmount}/></span>
          <span><span>待收金额</span><InlinePaymentAmount value={outstandingAmount}/></span>
        </span>
        <span aria-hidden="true">›</span>
      </button>
    }/>
    <div className="be-kpis">
      <article aria-label="广告消耗">
        <header><h2>投流数据</h2><InfoTip scrollable label="广告消耗口径" text={`${spendTip}${fxInfo ? ` ${fxInfo}。` : ""}${adFx?.missingDates.length ? ` 缺少汇率：${adFx.missingDates.join("、")}。` : ""}${adFx?.incomplete ? " 消耗明细不完整，暂不折算。" : ""}`} /></header>
        <button type="button" className="be-main-value" aria-label="查看广告消耗明细" disabled={loading || !view} onClick={() => drill("ads")}>{loading?'…':fxLoading?<span className="fx-pending">折算中…</span>:adFx?.cny!=null?`约 ${yuan(adFx.cny)}`:'待折算'}</button>
        <small>原币 {loading?'…':view?.adUsd??'—'} USD{adFx?.stale?' · 行情延迟':''}</small>
        {benchmark("ads")}
      </article>
    </div>
    {liveFailed && <p className="notice">开单、收款和售后费用暂不可用。</p>}
    <BossHomeTrend today={today} from={period.from} to={period.to} tick={trendTick} live={live}/>
    {live&&(pendingOrders>0||uncertainOrders>0||live.legacyCost.count>0)&&<section className="bh-attention" aria-label="经营待关注"><span>待关注</span>{pendingOrders>0&&<button type="button" onClick={()=>onDrill?.({page:"orders",live:{...defaultLiveView(),preset,range:{...period}}})}>待收款 <b>{pendingOrders}</b>笔 ›</button>}{uncertainOrders>0&&<button type="button" onClick={()=>onDrill?.({page:"orders",live:{...defaultLiveView(),preset,range:{...period}}})}>付款待核对 <b>{uncertainOrders}</b>笔 ›</button>}{live.legacyCost.count>0&&<button type="button" onClick={()=>drill("expenses")}>费用待核对 <b>{live.legacyCost.count}</b>笔 ›</button>}</section>}
  </section>;
}
