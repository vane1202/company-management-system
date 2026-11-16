import { useEffect, useRef, useState } from "react";
import { InfoTip } from "../InfoTip";
import { formatCashValue } from "./cashBoardData";
import { convertCustomerPayments, FX_REFRESH_MS, type CustomerPaymentFx, type CustomerPaymentRow } from "./adExchangeRates";
import "./customer-payment-summary.css";
import { useReferenceQuotes } from "./useReferenceQuotes";

type Totals = Record<"CNY" | "TWD" | "USD", string | null>;
type Props = { records: CustomerPaymentRow[]; totals?: Totals; loading: boolean; onOpen: () => void; detailLabel: string; compact?: boolean; interactive?:boolean; inline?:boolean };

/** The same payment-day conversion and hierarchy on both BOSS cards. Raw ledgers stay unchanged. */
export function CustomerPaymentSummary({ records, totals, loading, onOpen, detailLabel, compact=false,interactive=true,inline=false }: Props) {
  const revision = useReferenceQuotes();
  const inputKey = JSON.stringify({ records, totals, revision });
  const [result, setResult] = useState<{ key: string; value: CustomerPaymentFx } | null>(null);
  const [tick, setTick] = useState(0);
  const checked = useRef(0);
  useEffect(() => {
    let active = true;
    if (!totals || loading) return;
    checked.current = Date.now();
    void convertCustomerPayments(records, totals).then(value => { if (active) setResult({ key: inputKey, value }); });
    return () => { active = false; };
  }, [inputKey, loading, tick]);
  useEffect(() => {
    const update = () => { if (!document.hidden && Date.now() - checked.current >= FX_REFRESH_MS) setTick(n => n + 1); };
    const interval = window.setInterval(update, FX_REFRESH_MS);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", update); };
  }, []);
  const fx = result?.key === inputKey ? result.value : null;
  const pending = loading || !!totals && !fx;
  const rates = fx?.quotes.map(q => `${q.date}：1 ${q.currency} = ${Number(q.rate)} CNY；行情时间 ${new Date(q.updatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（UTC+8）${q.sourceDate !== q.date ? `；沿用 ${q.sourceDate} 已发布汇率` : ""}${q.delayed ? "；行情约延迟15分钟" : ""}${q.stale ? "；更新延迟" : ""}`).join("。") ?? "";
  const tip = `按付款日汇总所选区间有效客户付款，包含定金、尾款、售后及历史订单付款。人民币按原额计入，台币和美元按付款日参考汇率折算后合计。今日每小时检查最新行情，历史使用对应日期参考汇率。客户付给公司或第三方均计入，不扣第三方费用或汇差，不代表公司已到账，也不改动客户原币付款及欠款。${rates ? ` ${rates}。` : ""}${fx?.missingDates.length ? ` 缺少汇率：${fx.missingDates.join("、")}。` : ""}${fx?.incomplete ? " 付款明细待核对，暂不汇总折算。" : ""}`;
  const value=pending ? "…" : !fx ? "—" : fx.cny === null ? "待折算" : `${fx.hasForeign ? "约 " : ""}¥${formatCashValue(fx.cny)}`;
  if(inline) return <><button type="button" className="payment-inline-button" title={tip} aria-label="查看客户付款明细" disabled={!totals||pending} onClick={onOpen}><span>客户已付款</span><strong>{value}</strong><span aria-hidden="true">›</span></button></>;
  return <>
    <header><h2>客户已付款</h2><InfoTip scrollable label="客户已付款口径" text={tip} /></header>
    {interactive?<button type="button" className="payment-cny-value" aria-label="查看客户付款明细" disabled={!totals || pending} onClick={onOpen}>{value}</button>:<strong className="payment-cny-value">{value}</strong>}
    <small className="payment-cny-note" role="status">{pending ? "正在汇总参考折算…" : fx?.cny === null ? "汇率或付款明细待补齐" : fx?.stale ? "按付款日 · 人民币参考折算 · 更新延迟" : fx?.hasForeign ? "按付款日 · 人民币参考折算" : "按付款日 · 人民币"}</small>
    {!compact && <><details className="payment-native"><summary>查看原币金额</summary><div>{(["CNY", "TWD", "USD"] as const).map(currency => totals?.[currency] == null ? <span key={currency}>{currency}：待核对</span> : totals[currency] !== "0.00" ? <span key={currency}>{formatCashValue(totals[currency]!)} {currency}</span> : null)}{totals && Object.values(totals).every(value => value === "0.00") && <span>0.00 CNY</span>}</div></details>
    {!!fx?.quotes.length && <a className="payment-fx-source" href="https://exchangerate.dev" target="_blank" rel="noreferrer">Rates by Exchangerate.dev</a>}
    <button type="button" className="text-action payment-detail-link" onClick={onOpen}>{detailLabel}</button></>}
  </>;
}
