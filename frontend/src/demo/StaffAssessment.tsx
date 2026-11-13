import { useEffect, useState } from "react";
import { api } from "../api";
import { dashboardPresetRange } from "../dates";
import { InfoTip } from "../InfoTip";
import { Skeleton } from "../Skeleton";
import { toErrorMessage } from "../errors";
import { AnalysisPlot, ChartStyleControl, Ranking, useChartStyle } from "./AnalysisChart";
import { shiftDate, type AssessmentFoundation, type EmployeeRecord } from "./assessmentFoundation";
import { openingDays, orderDays, peopleRates, periodRate, type DayRate } from "./assessmentView";
import { daysIn } from "./bossTrendData";
import type { TrendSeries } from "./bossTrendData";
import "./ops-analysis.css";
import "./analysis-chart.css";
import "./staff-assessment.css";

type Preset = "day" | "week7" | "month";
type Kind = "opening" | "order";
const presets: [Preset, string][] = [["day", "今日"], ["week7", "近7日"], ["month", "本月"]];

function bounds(today: string, preset: Preset) {
  if (preset === "week7") return { from: shiftDate(today, -6), to: today };
  if (preset === "month") return dashboardPresetRange(today, "month");
  return { from: today, to: today };
}

function seriesOf(days: DayRate[], label: string): TrendSeries {
  return { key: label, label, points: days.map((day) => ({ date: day.date, value: day.value, reason: day.reason, count: day.whole, native: day.whole > 0 ? day.part + "/" + day.whole + "人" : "", estimated: false })) };
}

function prior(from: string, to: string) {
  const count = daysIn(from, to).length;
  return daysIn(shiftDate(from, -count), shiftDate(from, -1));
}

export default function StaffAssessment({ today, scope }: { today: string; scope: string }) {
  const [preset, setPreset] = useState<Preset>("week7");
  const [kind, setKind] = useState<Kind>("opening");
  const [person, setPerson] = useState("");
  const [selected, setSelected] = useState(today);
  const [style, setStyle] = useChartStyle();
  const [data, setData] = useState<AssessmentFoundation | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api.assessmentFoundation().then((value) => { if (!controller.signal.aborted) setData(value); }).catch((cause) => { if (!controller.signal.aborted) setError(toErrorMessage(cause)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [tick]);
  const range = bounds(today, preset);
  let days: string[] = [];
  let rangeError = "";
  try { days = daysIn(range.from, range.to); } catch (cause) { rangeError = toErrorMessage(cause); }
  const leads = data?.leads ?? [];
  const attendance = data?.attendance ?? [];
  const employees = data?.employees ?? [];
  const nameOf = (id: string) => employees.find((item) => item.id === id);
  const labelOf = (employee: EmployeeRecord | undefined, id: string) => employee ? employee.name + (employee.status === "left" ? " · 已离任" : "") : id;
  const opening = days.length ? openingDays(leads, days, person) : [];
  const ordering = days.length ? orderDays(attendance, days, person) : [];
  const openingTotal = periodRate(opening, "正常沟通为0");
  const orderTotal = periodRate(ordering, "未报");
  const active = kind === "opening" ? opening : ordering;
  const people = peopleRates(employees.map((item) => item.id), leads, attendance, days, kind).sort((a, b) => (b.value === null ? -1 : Number(b.value)) - (a.value === null ? -1 : Number(a.value)) || b.whole - a.whole);
  let openingBaseline = "—";
  let orderBaseline = "—";
  try {
    const previousDays = prior(range.from, range.to);
    openingBaseline = periodRate(openingDays(leads, previousDays, person), "未报").percent;
    orderBaseline = periodRate(orderDays(attendance, previousDays, person), "未报").percent;
  } catch { openingBaseline = "—"; orderBaseline = "—"; }
  const chart: TrendSeries[] = days.length ? [seriesOf(active, person ? labelOf(nameOf(person), person) : "全部")] : [];
  const selectedDay = active.find((day) => day.date === selected) ?? active.at(-1);
  const dayPeople = selectedDay ? peopleRates(employees.map((item) => item.id), leads, attendance, [selectedDay.date], kind) : [];
  if (!loading && data && data.view !== "review") return <section className="ops-analysis staff-assessment" aria-label="客服考核"><h1>客服考核</h1><p className="notice">{data.note}</p></section>;
  return <section className="ops-analysis staff-assessment" aria-label="客服考核" aria-busy={loading}>
    <header className="oa-heading"><div><span className="oa-eyebrow">{scope} · 按使用人</span><h1>客服考核</h1></div><button className="secondary" type="button" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button></header>
    <div className="oa-toolbar"><div className="overview-segments">{presets.map(([key, label]) => <button type="button" key={key} className={preset === key ? "selected" : ""} aria-pressed={preset === key} onClick={() => { setPreset(key); setSelected(today); }}>{label}</button>)}</div>
      <label className="oa-sort">客服<select aria-label="考核客服筛选" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">全部</option>{employees.map((item) => <option key={item.id} value={item.id}>{labelOf(item, item.id)}</option>)}</select></label></div>
    <p className="oa-period"><span>{range.from} 至 {range.to}{range.to === today ? " · 今日未结束" : ""}</span><span>按人数合计</span></p>
    {error && <div className="overview-error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setTick((value) => value + 1)}>重试</button></div>}
    {rangeError && <p className="error" role="alert">{rangeError}</p>}
    <div className="oa-kpis">
      <article aria-label="开口转化率"><h2>开口转化率 <InfoTip label="开口转化率口径" text="已明确具体需求的人数 ÷ 已正常沟通的人数。按所选范围的人数合计，不平均每天或每个客服的百分比。已读不回、未读、无效粉不进分母。正常沟通为 0 时不计算。"/></h2><strong>{loading ? <Skeleton width="3em" height=".8em" /> : openingTotal.percent}<small>{openingTotal.fraction}</small></strong><span className="oa-benchmark"><span>上期</span><b>{openingBaseline}</b></span></article>
      <article aria-label="开单率"><h2>开单率 <InfoTip label="开单率口径" text="已关联的开单客户人数 ÷ 已关联的入场人数。同一客户同一天只算 1 人。尚未关联显示 —，不作 0%。跑单不计入开单人数。"/></h2><strong>{loading ? <Skeleton width="3em" height=".8em" /> : orderTotal.percent}<small>{orderTotal.fraction}</small></strong><span className="oa-benchmark"><span>上期</span><b>{orderBaseline}</b></span></article>
      <article className={orderTotal.unlinked ? "is-attention" : ""} aria-label="待关联入场"><h2>待关联入场 <InfoTip label="待关联入场口径" text="入场人数已经登记，但还没有和开单客户关联。这部分不能计算开单率。"/></h2><strong>{loading ? <Skeleton width="2em" height=".8em" /> : orderTotal.unlinked}<small>人</small></strong><span className="oa-secondary-value">{orderTotal.unlinked ? "开单率暂不计算" : "没有待关联"}</span></article>
    </div>
    <section className="oa-panel oa-trend"><div className="analysis-toolbar"><h2>{kind === "opening" ? "开口转化率" : "开单率"} <InfoTip label="考核趋势口径" text="每个点是当天的人数合计。没有记录的日期断开，不补 0。今日未结束。"/></h2><ChartStyleControl style={style} onChange={setStyle} /></div>
      <nav className="analysis-tabs oa-trend-tabs" aria-label="考核指标">{([["opening", "开口转化率"], ["order", "开单率"]] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={kind === key} onClick={() => setKind(key)}>{label}</button>)}</nav>
      {chart.length > 0 && <AnalysisPlot series={chart} style={style} today={today} selected={selected} onSelect={setSelected} label={kind === "opening" ? "开口转化率" : "开单率"} unit="rate" />}
    </section>
    <section className="oa-panel" aria-label="客服排名"><div className="oa-panel-heading"><h2>客服</h2>{person && <button type="button" className="secondary" onClick={() => setPerson("")}>查看全部</button>}</div>
      <Ranking label="客服考核排名" rows={people.map((row) => { const employee = nameOf(row.employeeId); return { key: row.employeeId, label: labelOf(employee, row.employeeId), value: row.value === null ? null : Number(row.value), display: row.percent, note: row.unlinked > 0 && row.whole === 0 ? "待关联" : row.whole > 0 && row.whole < 5 ? row.fraction + " · 样本少" : row.fraction }; })} onOpen={setPerson} />
    </section>
    {selectedDay && <section className="oa-panel" aria-label="所选日期"><div className="oa-panel-heading"><h2>{selectedDay.date}</h2><span>{selectedDay.value === null ? selectedDay.reason : selectedDay.part + "/" + selectedDay.whole + "人"}</span></div>
      {dayPeople.map((row) => <article className="oa-group-row" key={row.employeeId}><div className="oa-group-name"><strong>{labelOf(nameOf(row.employeeId), row.employeeId)}</strong></div><div><span>{kind === "opening" ? "开口转化率" : "开单率"}</span><b>{row.percent}</b></div><div><span>人数</span><b>{row.fraction}</b></div></article>)}
      {!dayPeople.length && <p className="oa-muted">{selectedDay.reason || "这一天没有可考核的记录。"}</p>}
    </section>}
  </section>;
}