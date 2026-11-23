import { useEffect, useState } from "react";
import { api } from "../api";
import { dashboardPresetRange } from "../dates";
import { InfoTip } from "../InfoTip";
import { PeriodToolbar, type StandardPreset } from "../PeriodToolbar";
import { Skeleton } from "../Skeleton";
import { toErrorMessage } from "../errors";
import { AnalysisPlot, ChartStyleControl, Ranking, useChartStyle } from "./AnalysisChart";
import { shiftDate, type AssessmentFoundation, type EmployeeRecord } from "./assessmentFoundation";
import { assessmentComparison, openingDays, orderDays, peopleRates, periodRate, type DayRate } from "./assessmentView";
import { daysIn } from "./bossTrendData";
import type { TrendSeries } from "./bossTrendData";
import "./ops-analysis.css";
import "./analysis-chart.css";
import "./staff-assessment.css";

type Kind = "opening" | "order";

function bounds(today: string, preset: StandardPreset) {
  return dashboardPresetRange(today, preset);
}

function seriesOf(days: DayRate[], label: string): TrendSeries {
  return { key: label, label, points: days.map((day) => ({ date: day.date, value: day.value, reason: day.reason, count: day.whole, native: day.whole > 0 ? day.part + "/" + day.whole + "人" : "", estimated: false })) };
}

function prior(from: string, to: string) {
  const count = daysIn(from, to).length;
  return daysIn(shiftDate(from, -count), shiftDate(from, -1));
}

export default function StaffAssessment({ today, scope }: { today: string; scope: string }) {
  const [preset, setPreset] = useState<StandardPreset>("week");
  const kind: Kind = "opening";
  const [person, setPerson] = useState("");
  const [team, setTeam] = useState("");
  const [customRange, setCustomRange] = useState<{from:string;to:string}|null>(null);
  const [employment, setEmployment] = useState<"active" | "left">("active");
  const [minimumSample, setMinimumSample] = useState(5);
  const [sampleDraft, setSampleDraft] = useState("5");
  const [sampleError, setSampleError] = useState("");
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
  const range = customRange ?? bounds(today, preset);
  let days: string[] = [];
  let rangeError = "";
  try { days = daysIn(range.from, range.to); } catch (cause) { rangeError = toErrorMessage(cause); }
  const teams = data?.teams ?? [...new Set(data?.employees?.map(employee=>employee.teamId)??[])].map(id=>({id,name:id}));
  const employees = (data?.employees ?? []).filter(employee => employee.status === employment && (!team || employee.teamId === team));
  const employeeIds = new Set(employees.map(employee => employee.id));
  const leads = (data?.leads ?? []).filter(lead => employeeIds.has(lead.employeeId));
  const attendance = (data?.attendance ?? []).filter(row => employeeIds.has(row.employeeId));
  const nameOf = (id: string) => employees.find((item) => item.id === id);
  const labelOf = (employee: EmployeeRecord | undefined, id: string) => employee ? employee.name + (employee.status === "left" ? " · 已离任" : "") : id;
  const opening = days.length ? openingDays(leads, days, person) : [];
  const ordering = days.length ? orderDays(attendance, days, person) : [];
  const hasAttendance = attendance.some(row => days.includes(row.businessDate) && (!person || row.employeeId === person));
  const openingTotal = periodRate(opening, "正常沟通为0");
  const orderTotal = periodRate(ordering, "未报");
  const active = kind === "opening" ? opening : ordering;
  const people = peopleRates(employees.map((item) => item.id), leads, attendance, days, kind);
  const comparison = assessmentComparison(people, minimumSample);
  let openingBaseline = "—";
  let orderBaseline = "—";
  const privateSales = (data?.privateSales ?? []).filter(row => !row.cancelled && days.includes(row.businessDate) && (!person || nameOf(person)?.name === row.operatorName));
  const privateCents = privateSales.reduce((sum, row) => sum + Math.round(Number(row.amount) * 100), 0);
  const privateAmount = (privateCents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const privatePeople = [...privateSales.reduce((map, row) => { const current = map.get(row.operatorName) ?? { count: 0, cents: 0 }; current.count += 1; current.cents += Math.round(Number(row.amount) * 100); map.set(row.operatorName, current); return map; }, new Map<string, { count: number; cents: number }>())];
  try {
    const previousDays = prior(range.from, range.to);
    openingBaseline = periodRate(openingDays(leads, previousDays, person), "未报").percent;
    orderBaseline = periodRate(orderDays(attendance, previousDays, person), "未报").percent;
  } catch { openingBaseline = "—"; orderBaseline = "—"; }
  const chart: TrendSeries[] = days.length ? [seriesOf(active, person ? labelOf(nameOf(person), person) : "全部")] : [];
  const selectedDay = active.find((day) => day.date === selected) ?? active.at(-1);
  const dayPeople = selectedDay ? peopleRates(employees.map((item) => item.id), leads, attendance, [selectedDay.date], kind) : [];
  function applyMinimum() {
    const value = Number(sampleDraft);
    if (!/^\d+$/.test(sampleDraft) || !Number.isInteger(value) || value < 1 || value > 1000) { setSampleError("请填写 1 至 1000 的整数"); return; }
    setMinimumSample(value); setSampleError("");
  }
  if (!loading && data && data.view !== "review") return <section className="ops-analysis staff-assessment" aria-label="客服考核"><h1>客服考核</h1><p className="notice">{data.note}</p></section>;
  return <section className="ops-analysis staff-assessment" aria-label="客服考核" aria-busy={loading}>
    <header className="oa-heading"><div><span className="oa-eyebrow">{scope} · 按使用人</span><div className="sa-title"><h1>客服考核</h1><span className="sa-status-pill">开单率暂停统计（入场登记已取消）</span></div></div></header>
    <PeriodToolbar
      today={today}
      preset={preset}
      custom={customRange}
      maxDays={31}
      onPreset={(key) => { setPreset(key); setCustomRange(null); setSelected(today); }}
      onCustom={(next) => { setCustomRange(next); setSelected(next.to); }}
      filters={<>
        {teams.length > 1 && <select aria-label="考核小组筛选" value={team} onChange={event => { setTeam(event.target.value); setPerson(""); }}><option value="">全部小组</option>{teams.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <select aria-label="考核人员范围" value={employment} onChange={event => { setEmployment(event.target.value as typeof employment); setPerson(""); }}><option value="active">在职客服</option><option value="left">历史人员（已离任）</option></select>
        <select aria-label="考核客服筛选" value={person} onChange={(event) => setPerson(event.target.value)}><option value="">{employment === "active" ? "全部在职客服" : "全部离任人员"}</option>{employees.map((item) => <option key={item.id} value={item.id}>{labelOf(item, item.id)}</option>)}</select>
      </>}
      caption={`${range.from} 至 ${range.to}${range.to === today ? " · 今日未结束" : ""}`}
      actions={<button className="secondary" type="button" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button>}
      ariaLabel="客服考核日期与筛选"
    />
    {error && <div className="overview-error" role="alert"><strong>{error}</strong><button type="button" onClick={() => setTick((value) => value + 1)}>重试</button></div>}
    {rangeError && <p className="error" role="alert">{rangeError}</p>}
    <div className="oa-kpis">
      <article className="sa-kpi-hero" aria-label="开口转化率"><h2>开口转化率 <InfoTip label="开口转化率口径" text="已明确具体需求的人数 ÷ 已正常沟通的人数。按所选范围的人数合计，不平均每天或每个客服的百分比。已读不回、未读、无效粉不进分母。正常沟通为 0 时不计算。与加粉概况按全部承接人数计算的承接需求转化率不同。"/></h2><strong>{loading ? <Skeleton width="3em" height=".8em" /> : openingTotal.percent}<small>{loading ? "—" : openingTotal.fraction}</small></strong><span className="sa-rate-basis">明确需求 ÷ 正常沟通</span><span className="oa-benchmark"><span>上期</span><b>{openingBaseline}</b></span></article>
      <article><h2>客服私推（不计入开单率）</h2><strong>{loading ? "…" : "¥" + privateAmount}<small>{loading ? "—" : privateSales.length + " 笔"}</small></strong><span className="sa-rate-basis">只计料价，不收代购费</span></article>
      <article><h2>入榜样本情况</h2><strong>{loading ? "…" : comparison.ranked.length + " 位达标"}</strong><span className="sa-rate-basis">{loading ? "—" : comparison.observing.length} 位观察中 · 门槛 ≥ {minimumSample} 人</span></article>
    </div>
    <div className="sa-main-grid">
    <section className="oa-panel oa-trend"><div className="analysis-toolbar"><h2>开口转化率趋势 <InfoTip label="考核趋势口径" text="每个点是当天的人数合计。没有记录的日期断开，不补 0。今日未结束。"/></h2><ChartStyleControl style={style} onChange={setStyle} /></div>
      {chart.length > 0 && <AnalysisPlot series={chart} style={style} today={today} selected={selected} onSelect={setSelected} label={kind === "opening" ? "开口转化率" : "开单率"} unit="rate" />}
    </section>
    <section className="oa-panel sa-comparison" aria-label="客服排名"><div className="oa-panel-heading"><h2>{employment === "active" ? "在职客服排名" : "历史人员排名"}</h2>{person && <button type="button" className="secondary" onClick={() => setPerson("")}>查看全部</button>}
        <form className="sa-ranking-settings" noValidate onSubmit={event => { event.preventDefault(); applyMinimum(); }}>
          <label>门槛 ≥ <input aria-label="入榜最小样本人数" type="number" min="1" max="1000" step="1" value={sampleDraft} onChange={event => setSampleDraft(event.target.value)} /> 人</label>
          <button className="secondary" type="button" onClick={applyMinimum}>应用</button>
        </form>
      </div>
      {sampleError && <p className="error" role="alert">{sampleError}</p>}
      {comparison.ranked.length > 0 && <Ranking label="客服考核排名" rows={comparison.ranked.map((row) => ({ key: row.employeeId, label: labelOf(nameOf(row.employeeId), row.employeeId), value: Number(row.value), display: row.percent, note: row.fraction }))} onOpen={setPerson} />}
      {!comparison.ranked.length && <p className="oa-muted">尚无达到入榜条件的客服。</p>}
      {comparison.observing.length > 0 && <section className="sa-observing" aria-label="考核观察中"><h3>观察中 · 不参与排名</h3>{comparison.observing.map(row => <button type="button" className="sa-observation-row" key={row.employeeId} onClick={() => setPerson(row.employeeId)}><span><strong>{labelOf(nameOf(row.employeeId), row.employeeId)}</strong><small>{row.fraction} · {row.unlinked > 0 ? `另有 ${row.unlinked} 人待关联` : row.whole < minimumSample ? `样本未满 ${minimumSample} 人` : "数据待补"}</small></span><b>{row.percent}</b></button>)}</section>}
    </section>
    </div>
    <div className="sa-bottom-grid">
    {selectedDay ? <section className="oa-panel" aria-label="所选日期"><div className="oa-panel-heading"><h2>{selectedDay.date}</h2><span>{selectedDay.value === null ? selectedDay.reason : selectedDay.part + "/" + selectedDay.whole + "人"}</span></div>
      {dayPeople.map((row) => <article className="oa-group-row" key={row.employeeId}><div className="oa-group-name"><strong>{labelOf(nameOf(row.employeeId), row.employeeId)}</strong></div><div><span>{kind === "opening" ? "开口转化率" : "开单率"}</span><b>{row.percent}</b></div><div><span>人数</span><b>{row.fraction}</b></div></article>)}
      {!dayPeople.length && <p className="oa-muted">{selectedDay.reason || "这一天没有可考核的记录。"}</p>}
    </section> : <section className="oa-panel" aria-label="所选日期"><h2>单日明细</h2><p className="oa-muted">暂无可查看的日期。</p></section>}
    <section className="oa-panel" aria-label="客服私推明细">
      <div className="oa-panel-heading"><h2>客服私推明细</h2><span>{loading ? "正在读取…" : "共 " + privateSales.length + " 笔 · ¥" + privateAmount}</span></div>
      {!loading && !privatePeople.length && <p className="oa-muted">当前范围暂无私推订单。</p>}
      {!loading && privatePeople.map(([name, row]) => <article className="oa-group-row" key={name}><div className="oa-group-name"><strong>{name || "待确认归属"}</strong></div><div><span>私推营业额</span><b>¥{(row.cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</b></div><div><span>笔数</span><b>{row.count}</b></div></article>)}
    </section>
    </div>
  </section>;
}
