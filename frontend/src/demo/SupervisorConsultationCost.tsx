import { useEffect, useState } from "react";
import { InfoTip } from "../InfoTip";
import { buildAccountTrends } from "./opsAccountTrendData";
import { useReferenceQuotes } from "./useReferenceQuotes";

type Daily = { date: string; status: "unlinked" | "ambiguous" | "empty" | "incomplete" | "zero_consultations" | "ready"; spendUsd: string | null; consultCount: number | null; recordCount: number };
type CostData = { version: string; scope: "team"; team: { id: string; name: string }; current: Daily; previous: Daily; definition: string };
const amount = (value: string) => "约 ¥" + Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const label = (daily: Daily) => ({ unlinked: "待关联", ambiguous: "归属待核对", empty: "未报", incomplete: "数据待补", zero_consultations: "暂无咨询", ready: "汇率待补" })[daily.status];

export default function SupervisorConsultationCost({ today, refresh }: { today: string; refresh: number }) {
  const [data, setData] = useState<CostData | null>(null), [values, setValues] = useState<(string | null)[] | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const revision = useReferenceQuotes();
  useEffect(() => {
    if (import.meta.env.MODE !== "demo") {
      const unlinked: Daily = { date: today, status: "unlinked", spendUsd: null, consultCount: null, recordCount: 0 };
      setData({ version: "supervisor-consultation-cost/v1", scope: "team", team: { id: "", name: "本组" }, current: unlinked, previous: unlinked, definition: "仅统计本组已确认关联的广告户；关联待补时不使用公司平均值。" });
      setValues([null, null]);
      setError("");
      setLoading(false);
      return;
    }
    const controller = new AbortController(); setData(null); setValues(null); setError(""); setLoading(true);
    fetch("/api/demo/supervisor-consultation-cost?date=" + encodeURIComponent(today), { signal: controller.signal, cache: "no-store" }).then(async response => {
      const payload = await response.json();
      if (!response.ok) throw Error(payload.error || "咨询成本读取失败");
      if (payload.version !== "supervisor-consultation-cost/v1" || payload.scope !== "team") throw Error("咨询成本接口口径不匹配");
      const result = payload as CostData;
      const days = [result.previous, result.current];
      const series = await buildAccountTrends(days.filter(day => day.status === "ready").map(day => ({ adAccountRef: "team", businessDate: day.date, spendUsd: day.spendUsd, consultCount: day.consultCount })), days.map(day => day.date), ["team"], "consultationCostCny");
      if (!controller.signal.aborted) { setData(result); setValues(series[0].points.map(point => point.value)); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "咨询成本读取失败"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [today, refresh, revision]);
  return <div className="supervisor-consultation-cost" aria-label="本组咨询成本"><div><span>咨询成本<InfoTip label="本组咨询成本口径" text={(data?.definition || "仅统计本组已确认关联的广告户；关联待补时不使用公司平均值。") + " 与运营端使用同一发生日参考汇率，金额为参考值；零咨询不计算。"} /></span><strong>{loading ? "读取中…" : error ? "暂不可用" : data ? values?.[1] !== null && values?.[1] !== undefined ? amount(values[1]) : label(data.current) : "—"}</strong></div><small>{error ? error : data?.current.status === "unlinked" ? "本组广告户对应关系待补" : data ? "昨日 " + (values?.[0] !== null && values?.[0] !== undefined ? amount(values[0]) : label(data.previous)) : ""}</small></div>;
}
