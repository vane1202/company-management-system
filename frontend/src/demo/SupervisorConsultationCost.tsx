import { useEffect, useState } from "react";
import { InfoTip } from "../InfoTip";
import { cents, money } from "../commerceUi";
import { yuan } from "../dashboardDisplay";
import { convertAdSpend, getReferenceQuote } from "./adExchangeRates";
import { useReferenceQuotes } from "./useReferenceQuotes";

type Status = "unlinked" | "ambiguous" | "empty" | "incomplete" | "zero_consultations" | "ready";
type Daily = { date: string; status: Status; spendUsd: string | null; consultCount: number | null };
const labels: Record<Status, string> = {
  unlinked: "待关联", ambiguous: "归属待核对", empty: "未报", incomplete: "数据待补",
  zero_consultations: "暂无咨询", ready: "汇率待补"
};
const definition = "按消耗日参考汇率折算广告消耗，合计后除以广告咨询次数。仅纳入本组已确认且数据齐全的日报。";

export default function SupervisorConsultationCost({ from, to, refresh }: { from: string; to: string; refresh: number }) {
  const [days, setDays] = useState<Daily[]>([]);
  const [cost, setCost] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const revision = useReferenceQuotes();

  useEffect(() => {
    const controller = new AbortController();
    setDays([]); setError(""); setLoading(true);
    const path = import.meta.env.MODE === "demo" ? "/api/demo/supervisor-consultation-cost" : "/api/supervisor/consultation-cost";
    fetch(path + "?" + new URLSearchParams({ from, to }), { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error || "咨询成本读取失败");
      if (!Array.isArray(payload.days)) throw Error("咨询成本数据不完整");
      if (!controller.signal.aborted) setDays(payload.days);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "咨询成本读取失败"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [from, to, refresh]);

  useEffect(() => {
    let live = true;
    const eligible = days.filter(day => day.status === "ready" || day.status === "zero_consultations");
    const count = eligible.reduce((sum, day) => sum + (day.consultCount ?? 0), 0);
    setCost(null);
    setConverting(count > 0);
    if (count > 0) {
      const spend = eligible.flatMap(day => day.spendUsd === null ? [] : [{ date: day.date, amount: day.spendUsd }]);
      const total = money(spend.reduce((sum, row) => sum + (cents(row.amount) ?? 0n), 0n));
      void convertAdSpend(spend, total, date => getReferenceQuote(date, "USD"), eligible.length - spend.length).then(result => {
        if (!live) return;
        const totalCents = result.cny === null ? null : cents(result.cny);
        if (totalCents !== null) setCost(money((totalCents + BigInt(Math.floor(count / 2))) / BigInt(count)));
        setConverting(false);
      });
    }
    return () => { live = false; };
  }, [days, revision]);

  const included = days.filter(day => day.status === "ready" || day.status === "zero_consultations");
  const first = included[0]?.date.slice(5);
  const last = included.at(-1)?.date.slice(5);
  const status = (["ready", "zero_consultations", "ambiguous", "incomplete", "empty", "unlinked"] as const).find(value => days.some(day => day.status === value));
  const excluded = days.length - included.length;
  const coverage = included.length
    ? `${first === last ? first : first + " 至 " + last} · 已纳入 ${included.length} 天${excluded ? `，其余 ${excluded} 天待关联、缺报或待补` : ""}`
    : status === "unlinked" ? "所选日期的投放归属待补" : "";
  return <div className="supervisor-consultation-cost" aria-label="本组咨询成本">
    <div><span>咨询成本<InfoTip label="本组咨询成本口径" text={definition} /></span>
      <strong>{loading || converting ? "读取中…" : error ? "暂不可用" : cost !== null ? "约 " + yuan(cost) : status ? labels[status] : "—"}</strong>
    </div>
    {(error || coverage) && <small>{error || coverage}</small>}
  </div>;
}
