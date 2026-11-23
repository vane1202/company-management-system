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
import { aggregate, money, sortTeamNames, teamOf, type Source } from "./supervisorPerformanceData";
import type { AssessmentFoundation } from "./assessmentFoundation";
import { customerDesk, openingSnapshot, supervisorTeamIds, type DeskCustomer } from "./supervisorHomeModel";

type Navigate = (page: Page) => void;
type AccountRow = CsAccount & { registeredHolderId?: string };
const yuan = (value: bigint) => "¥" + Number(money(value)).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Tiers = { A: number; B: number; C: number };

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "jade" | "gold" }) {
  return <div><span>{label}</span><strong className={tone ? "is-" + tone : undefined}>{value}</strong></div>;
}

function TierPills({ tiers }: { tiers: Tiers }) {
  return <span className="supervisor-tier-pills" role="group" aria-label="客资档位分布">
    {(["A", "B", "C"] as const).map((tier) => <span key={tier}>{tier}档 <b>{tiers[tier]}</b></span>)}
  </span>;
}

function BoardHeading({ title, tipLabel, tip, action, onOpen }: {
  title: string; tipLabel: string; tip: string; action: string; onOpen: () => void;
}) {
  return <header className="supervisor-board-heading">
    <div><h2>{title}</h2><InfoTip label={tipLabel} text={tip} /></div>
    <button type="button" className="text-action supervisor-card-link" onClick={onOpen}>{action} →</button>
  </header>;
}

function MainFigure({ label, value, note, marker }: { label: string; value: ReactNode; note: string; marker?: string }) {
  return <div className="supervisor-primary-figure">
    <div><span>{label}</span>{marker && <span className="supervisor-badge">{marker}</span>}</div>
    <strong>{value}</strong>
    {note && <small>{note}</small>}
  </div>;
}

export function SupervisorWorkbench({ today, onNavigate }: { today: string; onNavigate: Navigate }) {
  const crm = useCustomerCrm(today);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [preset, setPreset] = useState<StandardPreset>("day");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const period = customRange ?? dashboardPresetRange(today, preset);
  const [fanPeriod, setFanPeriod] = useState<Awaited<ReturnType<typeof api.fanPeriodSummary>> | null>(null);
  const [fanError, setFanError] = useState("");
  const [view, setView] = useState<"home" | "customers">("home");
  const [personId, setPersonId] = useState("");
  const [selectedTeam, setSelectedTeam] = useState("");
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
  useEffect(() => {
    let live = true;
    setFanPeriod(null);
    setFanError("");
    api.fanPeriodSummary(period.from, period.to).then(result => {
      if (live) setFanPeriod(result);
    }).catch(error => {
      if (live) setFanError(toErrorMessage(error));
    });
    return () => { live = false; };
  }, [period.from, period.to, tick]);

  const teams = loaded(home?.fans)?.teams;
  const noScope = teams?.length === 0;
  const currentFanPeriod = fanPeriod?.from === period.from && fanPeriod?.to === period.to ? fanPeriod : null;
  const added = currentFanPeriod?.totalAdded;
  const missing = new Set(teams?.flatMap(team => team.missing.map(row => row.userId))).size;
  const fanLabel = customRange ? "区间进粉" : preset === "month" ? "本月进粉" : preset === "week" ? "本周进粉" : "今日进粉";
  const teamIds = import.meta.env.MODE === "demo" ? supervisorTeamIds : [...new Set((foundation?.employees ?? []).map((employee) => employee.teamId))];
  const opening = foundation ? openingSnapshot(foundation.leads ?? [], foundation.employees ?? [], period, import.meta.env.MODE === "demo" ? teamIds : undefined) : null;
  const perfTeams = sortTeamNames([
    ...(teams ?? []).map((t) => t.teamName),
    ...(accounts ?? []).map((a) => a.teamName || ""),
    ...(sources ?? []).map((s) => teamOf(s, accounts ?? []))
  ]);
  const activeTeam = selectedTeam && perfTeams.includes(selectedTeam) ? selectedTeam : "";
  const stats = sources && accounts ? aggregate(sources, { from: period.from, to: period.to, operator: "", account: "", persona: "", room: "", team: activeTeam }, accounts) : null;
  const employeeNames = new Map((foundation?.employees ?? []).map((employee) => [employee.id, employee.name]));
  const customers: DeskCustomer[] = import.meta.env.MODE === "demo"
    ? crm.state.customers.filter((customer) => teamIds.includes(customer.teamId)).map((customer) => ({
        id: customer.id, name: customer.name, employeeId: customer.employeeId, employeeName: customer.employeeName, spendTier: customer.spendTier,
        status: customerStatus(crm.state, customer), pending: crm.state.reviews.some((review) => review.customerId === customer.id && review.status === "pending"),
        sample: customer.sample, createdOn: customer.createdOn, need: customer.need
      }))
    : (foundation?.leads ?? []).map((lead) => ({
        id: lead.id,
        name: lead.customerLabel || "未命名客户",
        employeeId: lead.employeeId,
        employeeName: lead.operatorName || employeeNames.get(lead.employeeId) || "未分配客服",
        spendTier: "",
        status: lead.contact === "invalid" ? "invalid" : lead.dealt ? "dealt" : "valid",
        pending: Boolean(lead.pendingReview),
        sample: false,
        createdOn: lead.businessDate,
        need: lead.needSummary || "",
        attemptContact: Boolean(lead.attemptContact)
      }));
  const holders = (accounts ?? []).filter((account) => account.isActive && account.teamId && teamIds.includes(account.teamId) && account.holderName?.trim()).map((account) => ({ id: account.registeredHolderId || account.holderName!.trim(), name: account.holderName!.trim() }));
  const desk = customerDesk(customers, holders);
  const person = desk.people.find((item) => item.id === personId);
  const personCustomers = customers.filter((customer) => customer.employeeId === personId && customer.status !== "invalid");
  function openCustomers(id = "") { setPersonId(id); setView("customers"); window.scrollTo({ top: 0, behavior: "instant" }); }
  const missingCount = missing ?? 0;
  const hasPending = missingCount > 0 || desk.pending > 0;
  const reportsKnown = Boolean(teams) && !loading;
  const customerSummary = person ?? desk;
  const pendingTone = desk.pending > 0 ? "gold" : undefined;

  return <div className="role-desk supervisor-desk" aria-busy={loading}>
    <header className="desk-heading">
      <div>
        <p className="eyebrow">翠管家 · 岗位工作台</p>
        <div className="supervisor-title-row">
          <h1>{view === "home" ? "客服主管工作台" : person ? person.name + "的客资" : "本组客资情况"}</h1>
          {view === "home" && import.meta.env.MODE === "demo" && <span className="supervisor-demo-pill">
            演示数据 · 非真实业绩
            <InfoTip label="演示与客资归属说明" text="报粉、业绩和客资中的演练数字不代表真实业绩。客资跟登记时的客服，人调走后旧客资不自动改归属。" />
          </span>}
        </div>
        {view === "customers" && <span className="desk-caption">当前仍在客服名下的客户，不按今日清零</span>}
      </div>
      {view !== "home" && <div className="supervisor-heading-actions"><button type="button" className="secondary" onClick={() => person ? setPersonId("") : setView("home")}>{person ? "← 返回客资" : "← 返回工作台"}</button><button type="button" className="secondary" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button></div>}
    </header>
    {view === "home" && <PeriodToolbar
      today={today}
      preset={preset}
      custom={customRange}
      onPreset={(next) => { setPreset(next); setCustomRange(null); }}
      onCustom={(next) => setCustomRange(next)}
      maxDays={367}
      caption={`${period.from} 至 ${period.to} · 本组`}
      actions={<button type="button" className="secondary" disabled={loading} onClick={() => setTick((value) => value + 1)}>刷新</button>}
      ariaLabel="客服主管日期筛选"
    />}
    {view === "home" && !noScope && (hasPending || (reportsKnown && errors.length === 0)) && <div className={"supervisor-todo-bar" + (hasPending ? " is-pending" : "")}>
      <strong>{hasPending ? "今日待处理事项" : "今日报粉与客资复核均已处理完毕"}</strong>
      {hasPending && <div className="supervisor-todo-actions">
        {missingCount > 0 && <button type="button" className="secondary supervisor-attention" onClick={() => onNavigate("summary")}>{today.slice(5)} 未报粉 {missingCount} 人 →</button>}
        {desk.pending > 0 && <button type="button" className="secondary supervisor-attention" onClick={() => onNavigate("customerReview")}>待复核无效客资 {desk.pending} 条 →</button>}
      </div>}
    </div>}
    {errors.map((error) => <p className="error" role="alert" key={error}>{error}</p>)}
    {noScope ? <section className="desk-panel"><h2>暂未分配管理小组</h2><p>请联系管理员设置负责的小组。</p></section> : view === "customers" ? <section className="supervisor-customer-view" aria-label={person ? "客服客资明细" : "本组客资"}>
      <section className="supervisor-receipts-card" aria-label={person ? "客服客资汇总" : "本组客资汇总"}>
        <div className="supervisor-figures">
          <Figure label="在跟客户" value={customerSummary.following} />
          <Figure label="已成交" value={customerSummary.dealt} tone="jade" />
          <Figure label="待复核" value={customerSummary.pending} tone={customerSummary.pending ? "gold" : undefined} />
        </div>
        <TierPills tiers={customerSummary.tiers} />
      </section>
      {person ? <>
        <p className="supervisor-note">换人后，旧客资留在原客服名下。</p>
        <div className="supervisor-customer-list">
          {personCustomers.length ? personCustomers.map((customer) => {
            const source = import.meta.env.MODE === "demo" ? crm.state.customers.find((item) => item.id === customer.id) : undefined;
            const tags = source
              ? customerTags(crm.state, source)
              : [customer.status === "dealt" ? "已成交" : "有效", ...(customer.pending ? ["待复核"] : []), ...(customer.attemptContact ? ["尝试沟通"] : [])];
            return <article key={customer.id} className={"supervisor-customer" + (customer.pending ? " is-pending" : "")}>
              <div className="supervisor-customer-header">
                <div>
                  <strong>{customer.name}</strong>
                  <small>{customer.createdOn} · {customer.need || "未填写需求"}{customer.sample ? " · 演练样本" : ""}</small>
                </div>
                <div className="supervisor-customer-tags">
                  {tags.map((tag) => <span key={tag} className={"supervisor-badge" + (tag === "已成交" ? " is-jade" : tag === "待复核" ? " is-gold" : "")}>{tag}</span>)}
                </div>
              </div>
              {source && <details className="supervisor-order-history">
                <summary>查看开单与换料记录</summary>
                <CrmOrderHistory state={crm.state} customerId={customer.id} today={today} />
              </details>}
            </article>;
          }) : <p className="empty-state">这位客服名下没有仍在跟进的客户。</p>}
        </div>
        {person.pending > 0 && <button type="button" className="secondary supervisor-attention" onClick={() => onNavigate("customerReview")}>去复核无效客资 →</button>}
      </> : <>
        <p className="supervisor-note">在跟客户包含已成交客户，正式无效客资不计入。</p>
        <div className="supervisor-people">
          {desk.people.map((item) => <button type="button" className={"secondary supervisor-person" + (item.pending > 0 ? " is-pending" : "")} key={item.id} onClick={() => openCustomers(item.id)}>
            <span><strong>{item.name}</strong><small>在跟 {item.following} · 已成交 {item.dealt}</small></span>
            <TierPills tiers={item.tiers} />
            {item.pending > 0 && <span className="supervisor-badge is-gold">待复核 {item.pending}</span>}
            <span className="supervisor-person-link">查看 →</span>
          </button>)}
          {desk.people.length === 0 && <p className="empty-state">本组暂无可查看的客服客资。</p>}
        </div>
      </>}
    </section> : <div className="supervisor-boards">
      <section className="supervisor-board" aria-label="本组加粉情况">
        <BoardHeading title="本组加粉情况" tipLabel="加粉统计口径"
          tip="进粉按加粉日报汇总。正常沟通与开口转化按已登记的客资明细统计，开口转化率＝已明确需求 ÷ 正常沟通。"
          action="加粉明细" onOpen={() => onNavigate("summary")} />
        <MainFigure label={fanLabel} value={added?.toLocaleString("zh-CN") ?? (fanError ? "—" : currentFanPeriod ? "未报" : "…")} note={opening ? "沟通与转化仅按 " + opening.leadCount + " 条客资明细统计" : ""} />
        <div className="supervisor-figures">
          <Figure label="正常沟通" value={opening?.leadCount ? opening.replied + " 人" : loading ? "…" : "—"} />
          <Figure label="开口转化率" value={opening?.replied ? opening.rate : loading ? "…" : "—"} tone="jade" />
        </div>
        {fanError && <p className="error" role="alert">{fanError}</p>}
        <div className="supervisor-inset">
          <SupervisorConsultationCost from={period.from} to={period.to} refresh={tick} />
        </div>
        <footer className="supervisor-card-actions">
          <button type="button" onClick={() => onNavigate("reportHistory")}>填报历史</button>
          {missingCount > 0
            ? <button type="button" className="secondary supervisor-attention" onClick={() => onNavigate("summary")}>未报粉 {missingCount} 人</button>
            : reportsKnown && <span className="supervisor-reported">今日已全员报粉</span>}
        </footer>
      </section>
      <section className="supervisor-board is-hero" aria-label="本组业绩数据">
        <BoardHeading title="本组业绩数据" tipLabel="首页业绩口径"
          tip="直播间开单按料价加代购费统计，私推只计料价。贡献按开单时经办客服归属。"
          action="业绩明细" onOpen={() => onNavigate("orders")} />
        {perfTeams.length > 1 && <div className="supervisor-hero-pills" role="group" aria-label="按小组筛选业绩">
          <button type="button" className="secondary" aria-pressed={activeTeam === ""} onClick={() => setSelectedTeam("")}>全部小组</button>
          {perfTeams.map((name) => <button type="button" key={name} className="secondary" aria-pressed={activeTeam === name} onClick={() => setSelectedTeam(name)}>{name}</button>)}
        </div>}
        <MainFigure label="直播间开单" value={stats ? (stats.unknownLive ? "待核对" : yuan(stats.liveTurnover)) : loading ? "…" : "—"} note="料价+代购费 · 不含私推" />
        <div className="supervisor-figures">
          <Figure label="客服私推" value={stats ? yuan(stats.privateTurnover) : loading ? "…" : "—"} />
          <Figure label="有效开单" value={stats ? stats.valid.length + " 笔" : loading ? "…" : "—"} />
        </div>
        <div className="supervisor-inset">
          <p><strong>涵盖有效客户 {stats?.customers ?? (loading ? "…" : "—")} 位</strong></p>
          <small>贡献按开单时经办客服归属，换账号不改旧单</small>
        </div>
        <footer className="supervisor-card-actions">
          <button type="button" className="secondary supervisor-hero-link" onClick={() => onNavigate("orders")}>进入本组业绩 →</button>
        </footer>
      </section>
      <section className="supervisor-board" aria-label="本组客资情况">
        <BoardHeading title="本组客资情况" tipLabel="客资统计口径"
          tip="已成交包含在在跟客户里，正式无效客资不计入。"
          action="客资明细" onOpen={() => openCustomers()} />
        <MainFigure label="在跟客户" value={desk.following} marker="当前存量" note="不按今日清零 · 正式无效客资不计入" />
        <div className="supervisor-figures">
          <Figure label="已成交" value={desk.dealt} tone="jade" />
          <Figure label="待复核" value={desk.pending} tone={pendingTone} />
        </div>
        <div className="supervisor-inset">
          <p><strong>在跟客户档位分布</strong></p>
          <TierPills tiers={desk.tiers} />
        </div>
        <footer className="supervisor-card-actions">
          <button type="button" onClick={() => openCustomers()}>按客服查看</button>
          {desk.pending > 0 && <button type="button" className="secondary supervisor-attention" onClick={() => onNavigate("customerReview")}>去复核 ({desk.pending}) →</button>}
        </footer>
      </section>
    </div>}
  </div>;
}
