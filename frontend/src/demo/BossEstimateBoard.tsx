import { useEffect, useRef, useState } from "react";
import { api, type LiveBusinessData } from "../api";
import { InfoTip } from "../InfoTip";
import type { Page } from "../access";
import { yuan } from "../dashboardDisplay";
import { createRequestGate } from "../requestGate";
import { toErrorMessage } from "../errors";
import { buildEstimateView, type EstimateSources } from "./estimateBoardData";
import { convertAdSpend, referenceFxClient, FX_REFRESH_MS, type AdFxView } from "./adExchangeRates";
import { CustomerPaymentSummary } from "./CustomerPaymentSummary";
import BossTrends from "./BossTrends";
import "./boss-estimate-board.css";
import { useReferenceQuotes } from "./useReferenceQuotes";

const filters = { room: "", host: "", persona: "", operator: "" };
const presets = [["day", "今日"], ["week", "本周"], ["month", "本月"]] as const;
const turnoverTip = "料价加代购费，按开单日统计。未付款也计入。跑单从原开单日扣回。追加收费、客户收款和公司支出都不从这里扣减。";
const spendTip = "业务费用是已登记的供货、加工、配货和发货等人民币支出，按发生日统计。广告消耗按消耗日汇率参考折算为人民币，原美元金额保留。今日每小时检查最新行情（免费行情约延迟15分钟），历史日期使用当日参考汇率，跨日逐日折算后汇总。不代表实际扣款或结汇金额。";

export default function BossEstimateBoard({ today, onError, onOpen }: { today: string; onError: (value: string) => void; onOpen?: (page: Page) => void }) {
  const [preset, setPreset] = useState<(typeof presets)[number][0]>("day");
  const [live, setLive] = useState<LiveBusinessData | null>(null);
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
  const revision=useReferenceQuotes();
  const view = buildEstimateView(live, legacy);

  async function load(next = preset) {
    const ticket = gate.next();
    checked.current = Date.now();
    setLoading(true);
    setLive(null);
    setLegacy(null);
    setAdFx(null);
    setFxLoading(true);
    const [liveResult, legacyResult] = await Promise.allSettled([
      api.liveBusiness(next, undefined, filters),
      api.dashboard(next)
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
  }, [preset]);
  const money = (value: string | null) => loading ? "…" : yuan(value);
  const fxInfo = adFx?.quotes.map(q => `${q.date}：1 USD = ${Number(q.rate)} CNY；行情时间 ${new Date(q.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）；${q.delayed ? "行情约延迟15分钟" : "当日参考汇率"}${q.sourceDate !== q.date ? `；沿用 ${q.sourceDate} 已发布汇率` : ""}${q.stale ? "；更新延迟，使用最近成功数据" : ""}`).join("。") ?? "";

  return <section className="be-board" aria-label="经营估算" aria-busy={loading}>
    <header className="be-heading">
      <div>
        <h1>经营估算 <InfoTip label="首页统计口径" text="开单按开单日、客户付款按付款日、业务费用按发生日、广告按消耗日统计。外币使用共享参考汇率，不代表实际结汇。四项不合成公司利润；工资、提成、代收手续费和汇差另行核算。"/></h1>
      </div>
      <button type="button" className="secondary" onClick={() => load()}>刷新</button>
    </header>
    <div className="be-toolbar">
      <div className="overview-segments" role="group" aria-label="估算区间">{presets.map(([key, label]) => <button key={key} type="button" className={preset === key ? "selected" : ""} aria-pressed={preset === key} onClick={() => setPreset(key)}>{label}</button>)}</div>
      {view && <span>关键数据 · {view.period.from} 至 {view.period.to}</span>}
    </div>
    <div className="be-kpis">
      <article aria-label="开单营业额">
        <header><h2>开单营业额</h2><InfoTip label="开单营业额口径" text={turnoverTip} /></header>
        <strong>{money(view?.turnover ?? null)}</strong>
      </article>
      <article aria-label="客户已付款"><CustomerPaymentSummary compact loading={loading} records={live?.events.filter(event => event.kind === "receipt") ?? []} totals={live?.totals.customerReceipts} onOpen={() => onOpen?.("finance")} detailLabel="收款与到账 →" /></article>
      <article aria-label="业务费用">
        <header><h2>业务费用</h2><InfoTip label="业务费用口径" text="已登记供货、加工、配货和发货等业务费用，按费用发生日统计。不是财务实际付款，不包含全部公司成本，不从这里直接推算净利润。"/></header>
        <strong>{money(view?.expenseCny??null)}</strong><small>按费用发生日 · 人民币</small>
      </article>
      <article aria-label="广告消耗">
        <header><h2>广告消耗</h2><InfoTip scrollable label="广告消耗口径" text={`${spendTip}${fxInfo ? ` ${fxInfo}。` : ""}${adFx?.missingDates.length ? ` 缺少汇率：${adFx.missingDates.join("、")}。` : ""}${adFx?.incomplete ? " 消耗明细不完整，暂不折算。" : ""}`} /></header>
        <strong>{loading||fxLoading?'…':adFx?.cny!=null?`约 ${yuan(adFx.cny)}`:'待折算'}</strong>
        <small>原币 {loading?'…':view?.adUsd??'—'} USD{adFx?.stale?' · 行情延迟':''}</small>
      </article>
    </div>
    {liveFailed && <p className="notice">开单、收款和业务费用暂不可用。</p>}
    <BossTrends today={today} tick={trendTick} onOpen={onOpen} />
    <details className="be-reference"><summary>参考汇率与统计说明</summary><p>{spendTip} {fxInfo}</p><a href="https://exchangerate.dev" target="_blank" rel="noreferrer">Rates by Exchangerate.dev</a></details>
    <section className="be-links" aria-label="继续查看">
      <article><div><h2>业务费用</h2><p>供货、加工、配货和发货，按发生日看明细。</p></div>{onOpen && <button type="button" className="text-action" onClick={() => onOpen("orders")}>直播间经营 →</button>}</article>
      <article><div><h2>广告消耗</h2><p>全公司消耗按日参考折算，保留美元原额。</p></div>{onOpen && <button type="button" className="text-action" onClick={() => onOpen("ops")}>推广汇总 →</button>}</article>
      <article><div><h2>人员成本</h2><p>{loading ? "读取中…" : view?.salary ? `期间底薪分摊 ${yuan(view.salary)}。` : "期间底薪分摊待读取。"}不从开单营业额里扣除。</p></div>{onOpen && <button type="button" className="text-action" onClick={() => onOpen("salaries")}>工资汇总 →</button>}</article>
    </section>
    <details className="be-legacy">
      <summary>原估算明细</summary>
      {legacyFailed && <p className="notice">原口径暂不可用。</p>}
      {!!view?.legacy.length && <div className="be-legacy-grid">{view.legacy.map((line) => <div key={line.key}><b>{line.value}</b><span>{line.label}</span></div>)}</div>}
      {view?.formula && <p>{view.formula}</p>}
      {view?.salaryNote && <p>{view.salaryNote}</p>}
      <p>旧口径余额保留核对，不是公司利润。加粉和拍剪分别在各自汇总页查看。</p>
      {view?.disclaimer && <p>{view.disclaimer}</p>}
    </details>
  </section>;
}
