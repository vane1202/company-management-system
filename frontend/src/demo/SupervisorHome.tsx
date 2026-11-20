import SupervisorConsultationCost from "./SupervisorConsultationCost";
import CrmOrderHistory from "./CrmOrderHistory";
import { useEffect, useState, type ReactNode } from "react";
import type { Page } from "../access";
import { api, type CsAccount } from "../api";
import { loadSupervisorHome, loaded } from "../roleHomeData";
import { toErrorMessage } from "../errors";
import { InfoTip } from "../InfoTip";
import { dashboardPresetRange } from "../dates";
import { PeriodToolbar, type StandardPreset } from "../PeriodToolbar";
import { customerStatus, customerTags, useCustomerCrm } from "./customerCrm";
import { aggregate, money, type Source } from "./supervisorPerformanceData";
import type { AssessmentFoundation } from "./assessmentFoundation";
import { customerDesk, openingSnapshot, supervisorTeamIds, type DeskCustomer } from "./supervisorHomeModel";

type Navigate = (page: Page) => void;
type AccountRow = CsAccount & { registeredHolderId?: string };
const yuan = (value: bigint) => "¥" + Number(money(value)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function Figure({ label, value }: { label: string; value: ReactNode }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

export function SupervisorWorkbench({ today, onNavigate }: { today: string; onNavigate: Navigate }) {
  const crm = useCustomerCrm(today);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [preset, setPreset] = useState<StandardPreset>("day");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const period = customRange ?? dashboardPresetRange(today, preset);
  const [view, setView] = useState<"home" | "customers">("home");
  const [personId, setPersonId] = useState("");
  const [home, setHome] = useState<Awaited<ReturnType<typeof loadSupervisorHome>> | null>(null);
  const [foundation, setFoundation] = useState<AssessmentFoundation | null>(null);
  const [sources, setSources] = useState<Source[] | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.allSettled([loadSupervisorHome(today), api.assessmentFoundation(), api.orders(), api.csAccounts()]).then(async (results) => {
      if (!live) return;
      const nextErrors: string[] = [];
      const homeResult = results[0];
      if (homeResult.status === "fulfilled") setHome(homeResult.value);
      else nextErrors.push("首页数据：" + toErrorMessage(homeResult.reason));
      const foundationResult = results[1];
      setFoundation(foundationResult.status === "fulfilled" ? foundationResult.value : null);
      if (foundationResult.status === "rejected") nextErrors.push("开口转化：" + toErrorMessage(foundationResult.reason));
      const orderResult = results[2];
      const accountResult = results[3];
      if (accountResult.status === "fulfilled") setAccounts(accountResult.value.accounts);
      else nextErrors.push("接待账号：" + toErrorMessage(accountResult.reason));
      if (orderResult.status === "fulfilled") {
        try {
          const rows = await Promise.all(orderResult.value.orders.map(async (identity) => ({ identity, record: await api.orderRecord(identity.id) })));
          if (live) setSources(rows);
        } catch (cause) { if (live) nextErrors.push("本组业绩：" + toErrorMessage(cause)); }
      } else nextErrors.push("本组业绩：" + toErrorMessage(orderResult.reason));
      if (live) { setErrors(nextErrors); setLoading(false); }
    });
    return () => { live = false; };
  }, [today, tick]);
  const teams = loaded(home?.fans)?.teams;
  const noScope = teams?.length === 0;
  const added = teams?.reduce((sum, team) => sum + team.totalAdded, 0);
  const missing = teams?.reduce((sum, team) => sum + team.missingCount, 0);
  const teamIds = import.meta.env.MODE === "demo" ? supervisorTeamIds : [...new Set((foundation?.employees ?? []).map((employee) => employee.teamId))];
  const opening = foundation ? openingSnapshot(foundation.leads ?? [], foundation.employees ?? [], period, teamIds) : null;
  const stats = sources && accounts ? aggregate(sources, { from: period.from, to: period.to, operator: "", account: "", persona: "", room: "" }, accounts) : null;
  const customers: DeskCustomer[] = crm.state.customers.filter((customer) => teamIds.includes(customer.teamId)).map((customer) => ({
    id: customer.id, name: customer.name, employeeId: customer.employeeId, employeeName: customer.employeeName, spendTier: customer.spendTier,
    status: customerStatus(crm.state, customer), pending: crm.state.reviews.some((review) => review.customerId === customer.id && review.status === "pending"),
    sample: customer.sample, createdOn: customer.createdOn, need: customer.need
  }));
  const holders = (accounts ?? []).filter((account) => account.isActive && account.teamId && teamIds.includes(account.teamId) && account.holderName?.trim()).map((account) => ({ id: account.registeredHolderId || account.holderName!.trim(), name: account.holderName!.trim() }));
  const desk = customerDesk(customers, holders);
  const person = desk.people.find((item) => item.id === personId);
  const personCustomers = customers.filter((customer) => customer.employeeId === personId && customer.status !== "invalid");
  function openCustomers(id = "") { setPersonId(id); setView("customers"); window.scrollTo({ top: 0, behavior: "instant" }); }
  return <div className="role-desk supervisor-desk" aria-busy={loading}>
    <header className="desk-heading"><div><p className="eyebrow">翠管家 · 岗位工作台</p><h1>{view === "home" ? "客服主管工作台" : person ? person.name + "的客资" : "本组客资情况"}</h1>{view === "customers" && <span className="desk-caption">当前仍在客服名下的客户，不按今日清零</span>}</div>{view !== "home" && <div className="supervisor-heading-actions"><button type="button" className="secondary" onClick={() => person ? setPersonId("") : setView("home")}>{person ? "← 返回客资" : "← 返回工作台"}</button><button type="button" className="secondary" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button></div>}</header>
    {view === "home" && import.meta.env.MODE === "demo" && <p className="supervisor-demo-note">演示数据 · 非真实业绩<InfoTip label="演示与客资归属说明" text="报粉、业绩和客资中的演练数字不代表真实业绩。客资跟登记时的客服，人调走后旧客资不自动改归属。" /></p>}
    {view === "home" && <PeriodToolbar
      today={today}
      preset={preset}
      custom={customRange}
      onPreset={(next) => { setPreset(next); setCustomRange(null); }}
      onCustom={(next) => setCustomRange(next)}
      caption={`${period.from} 至 ${period.to} · 本组`}
      actions={<button type="button" className="secondary" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button>}
      ariaLabel="客服主管日期筛选"
    />}
    {errors.map((error) => <p className="error" role="alert" key={error}>{error}</p>)}
    {noScope ? <section className="desk-panel"><h2>暂未分配管理小组</h2><p>请联系管理员设置负责的小组。</p></section> : view === "customers" ? <section className="desk-panel" aria-label={person ? "客服客资明细" : "本组客资"}>
      {person ? <>
        <p className="notice">在跟 {person.following} 人，其中已成交 {person.dealt} 人。待复核 {person.pending} 人。换人后旧客资留在原客服名下。</p>
        {personCustomers.length ? personCustomers.map((customer) => {
          const source = crm.state.customers.find((item) => item.id === customer.id)!;
          return <div key={customer.id}><article className="supervisor-customer"><div><strong>{customer.name}</strong><small>{customer.createdOn} · {customer.need || "未填写需求"}{customer.sample ? " · 演练样本" : ""}</small></div><span>{customerTags(crm.state, source).join(" · ")}</span></article><details><summary>查看开单与换料记录</summary><CrmOrderHistory state={crm.state} customerId={customer.id} today={today}/></details></div>;
        }) : <p className="empty-state">这位客服名下没有仍在跟进的客户。</p>}
        {person.pending > 0 && <button type="button" onClick={() => onNavigate("customerReview")}>去复核无效客资</button>}
      </> : <>
        <div className="supervisor-figures" aria-label="本组客资汇总"><Figure label="在跟客户" value={desk.following} /><Figure label="已成交" value={desk.dealt} /><Figure label="待复核" value={desk.pending} /></div>
        <p className="notice">A档 {desk.tiers.A} · B档 {desk.tiers.B} · C档 {desk.tiers.C}。已成交包含在在跟客户里。正式无效的客户不在这里。</p>
        <div className="supervisor-people">{desk.people.map((item) => <button type="button" key={item.id} onClick={() => openCustomers(item.id)}><span><strong>{item.name}</strong><small>在跟 {item.following} · 已成交 {item.dealt} · A/B/C {item.tiers.A}/{item.tiers.B}/{item.tiers.C}</small></span><b>{item.pending ? item.pending + " 待复核" : "查看"}</b></button>)}</div>
      </>}
    </section> : <>
      <div className="supervisor-boards">
        <section className="supervisor-board" aria-label="本组加粉情况">
          <header><button type="button" className="supervisor-card-link" onClick={() => onNavigate("summary")}><h2>本组加粉情况</h2><span aria-hidden="true">›</span></button><InfoTip label="加粉统计口径" text="开口转化率＝已明确需求 ÷ 正常沟通，按今日客户明细和客服本人统计。" /></header>
          <div className="supervisor-figures"><Figure label="今日进粉" value={added ?? (loading ? "…" : "—")} /><Figure label="正常沟通" value={opening ? opening.replied + " 人" : loading ? "…" : "—"} /><Figure label="开口转化率" value={opening?.replied ? opening.rate : loading ? "…" : "—"} /></div>
          {opening?.replied === 0 && <p className="supervisor-note">暂无正常沟通</p>}
          <SupervisorConsultationCost today={today} refresh={tick}/>
          <footer className="supervisor-card-actions"><button type="button" onClick={() => onNavigate("summary")}>加粉明细</button><button type="button" onClick={() => onNavigate("reportHistory")}>填报历史</button>{!!missing && <button type="button" className="supervisor-attention" onClick={() => onNavigate("summary")}>未报粉 {missing}</button>}</footer>
        </section>
        <section className="supervisor-board" aria-label="本组业绩数据">
          <header><button type="button" className="supervisor-card-link" onClick={() => onNavigate("orders")}><h2>本组业绩数据</h2><span aria-hidden="true">›</span></button><InfoTip label="首页业绩口径" text="只统计今日开单。直播间是料价加代购费，私推只计料价。贡献按开单时的经办客服，换账号不改旧单。" /></header>
          <div className="supervisor-figures"><Figure label="直播间开单" value={stats ? (stats.unknownLive ? "待核对" : yuan(stats.liveTurnover)) : loading ? "…" : "—"} /><Figure label="客服私推" value={stats ? yuan(stats.privateTurnover) : loading ? "…" : "—"} /><Figure label="有效开单" value={stats ? stats.valid.length + " 笔" : loading ? "…" : "—"} /></div>
          <footer className="supervisor-card-actions"><button type="button" onClick={() => onNavigate("orders")}>业绩明细</button></footer>
        </section>
        <section className="supervisor-board" aria-label="本组客资情况">
          <header><button type="button" className="supervisor-card-link" onClick={() => openCustomers()}><h2>本组客资情况</h2><span aria-hidden="true">›</span></button><InfoTip label="客资统计口径" text="这是当前存量，不按今日清零。已成交包含在在跟客户里，正式无效客资不计入。" /></header>
          <div className="supervisor-figures"><Figure label="在跟客户" value={desk.following} /><Figure label="已成交" value={desk.dealt} /><Figure label="待复核" value={desk.pending} /></div>
          <footer className="supervisor-card-actions"><button type="button" onClick={() => openCustomers()}>客资明细</button>{desk.pending > 0 && <button type="button" className="supervisor-attention" onClick={() => onNavigate("customerReview")}>待复核 {desk.pending} · 去复核</button>}</footer>
        </section>
      </div>
    </>}
  </div>;
}
