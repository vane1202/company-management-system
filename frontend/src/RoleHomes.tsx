import { useEffect, useState, type ReactNode } from "react";
import type { Page } from "./access";
import { DashboardIcon } from "./DashboardIcon";
import { reportingOverview } from "./dashboardOverview";
import { effectiveOrderAmount, fanStateSegments, missingReporters, yuan } from "./dashboardDisplay";
import { InfoTip } from "./InfoTip";
import { toErrorMessage } from "./errors";
import { loadAdminHome, loadSupervisorHome, loaded } from "./roleHomeData";
import { Skeleton } from "./Skeleton";

type Navigate = (page: Page) => void;
function HomeHeading({ title, subtitle, loading, refresh }: { title: string; subtitle: string; loading: boolean; refresh: () => void }) {
  return <header className="role-home-heading"><div><h1>{title}</h1><p>{subtitle}</p></div><button type="button" className="overview-refresh" disabled={loading} onClick={refresh}><DashboardIcon name="refresh" />{loading ? "读取中" : "刷新"}</button></header>;
}
/** 紧凑标题：标题、日期与刷新图标同一行（主管首页手机首屏用）。 */
function CompactHeading({ title, caption, loading, refresh }: { title: string; caption: string; loading: boolean; refresh: () => void }) {
  return <header className="role-home-heading role-home-heading-compact"><h1>{title}</h1><span className="role-heading-caption">{caption}</span><button type="button" className="overview-refresh boss-refresh-icon" disabled={loading} aria-label={loading ? "读取中" : "刷新数据"} title="刷新数据" onClick={refresh}><DashboardIcon name="refresh" /></button></header>;
}
/** 今日新增客户的四种沟通状态占比；段之和不足加粉总数时用灰色“未分类”如实补齐。 */
function FanStateBar({ total, replied, readNoReply, unread, invalid }: { total: number | null; replied: number | null; readNoReply: number | null; unread: number | null; invalid: number | null }) {
  const data = fanStateSegments(total, { replied, readNoReply, unread, invalid });
  if (!data) return null;
  if (data.base === 0) return <section className="fan-state" aria-label="今日新增客户沟通状态"><p className="fan-state-empty">今日暂无新增客户</p></section>;
  return <section className="fan-state" aria-label="今日新增客户沟通状态">
    <div className="fan-state-title"><strong>今日新增 · 沟通状态</strong><InfoTip label="沟通状态口径" text="按今日填报的四种状态人数画占比，底数为今日加粉总数。状态合计少于加粉总数的部分（如旧版只填总数的记录）显示为灰色“未分类”，不按比例估算。" /></div>
    <div className="fan-state-bar" role="img" aria-label={data.segments.map(s => `${s.label} ${s.value}`).join("，")}>{data.segments.filter(s => s.value > 0).map(s => <span key={s.key} className={`fan-seg fan-seg-${s.key}`} style={{ flexGrow: s.value }} />)}</div>
    <ul className="fan-state-legend">{data.segments.map(s => <li key={s.key}><i className={`fan-seg-${s.key}`} />{s.label}<b>{s.value}</b></li>)}</ul>
    {data.overflow > 0 && <p className="data-flag">四种状态合计比加粉总数多 {data.overflow} 人，请核对填报</p>}
  </section>;
}
function HomeMetric({ label, value, note, page, onNavigate, pending = false }: { label: string; value: ReactNode; note?: string; page: Page; onNavigate: Navigate; pending?: boolean }) {
  // pending：读取中且尚无数据时显示灰色占位，读取完仍为“—”才表示无数据。
  return <button type="button" className="role-metric" onClick={() => onNavigate(page)}><span>{label}<DashboardIcon name="arrow" /></span><strong>{pending ? <Skeleton width="2.6em" height="1em" /> : value ?? "—"}</strong>{note && <small>{note}</small>}</button>;
}
function HomeAction({ page, title, detail, onNavigate }: { page: Page; title: string; detail: string; onNavigate: Navigate }) {
  return <button type="button" className="role-home-action" onClick={() => onNavigate(page)}><DashboardIcon name={page} /><span><strong>{title}</strong><small>{detail}</small></span><DashboardIcon name="arrow" /></button>;
}
function HomeErrors({ errors, retry }: { errors: string[]; retry: () => void }) {
  return errors.length ? <div className="overview-error" role="alert"><strong>部分概览暂不可用</strong>{errors.map(error => <p key={error}>{error}</p>)}<button type="button" onClick={retry}>重新加载</button></div> : null;
}
function sourceErrors(sources: [string, PromiseSettledResult<unknown> | undefined][]) {
  return sources.flatMap(([label, result]) => result?.status === "rejected" ? [`${label}：${toErrorMessage(result.reason)}`] : []);
}

export function AdminHome({ onNavigate }: { onNavigate: Navigate }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadAdminHome>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(value => value + 1);
  useEffect(() => {
    let active = true; setLoading(true); setData(null);
    loadAdminHome().then(result => { if (active) { setData(result); setLoading(false); } });
    return () => { active = false; };
  }, [tick]);
  const users = loaded(data?.users)?.users;
  const employees = users?.filter(user => user.accountKind !== "cs_wechat");
  const teams = loaded(data?.teams)?.teams;
  const accounts = loaded(data?.accounts)?.accounts;
  const modules = loaded(data?.modules);
  const moduleEntries = modules ? Object.entries(modules.modules) : null;
  const enabled = moduleEntries?.filter(([, value]) => value).length;
  const unassignedSupervisors = employees?.filter(user => user.role === "cs_supervisor" && user.isActive && user.managedTeamIds?.length === 0);
  const unassignedAccounts = accounts?.filter(account => account.isActive && !account.teamId);
  const inactiveEmployees = employees?.filter(user => !user.isActive).length;
  const inactiveAccounts = accounts?.filter(account => !account.isActive).length;
  const errors = sourceErrors([["员工账号", data?.users], ["小组", data?.teams], ["客服微信", data?.accounts], ["模块设置", data?.modules]]);
  return <div className="management-dashboard role-home" aria-busy={loading}>
    <HomeHeading title="系统管理概览" subtitle="账号、编制与系统配置" loading={loading} refresh={refresh} />
    <div className="role-kpis" aria-label="系统配置概况">
      <HomeMetric label="员工账号" value={employees?.length} note={employees ? `启用 ${employees.filter(user => user.isActive).length} · 停用 ${inactiveEmployees}` : undefined} page="people" onNavigate={onNavigate} />
      <HomeMetric label="已建小组" value={teams?.length} note="维护归属与主管权限" page="people" onNavigate={onNavigate} />
      <HomeMetric label="已登记微信" value={accounts?.length} note={accounts ? `启用 ${accounts.filter(account => account.isActive).length} · 停用 ${inactiveAccounts}` : undefined} page="csAccounts" onNavigate={onNavigate} />
      <HomeMetric label="启用模块" value={enabled} note={moduleEntries ? `共 ${moduleEntries.length} 个业务模块` : undefined} page="modules" onNavigate={onNavigate} />
    </div>
    <HomeErrors errors={errors} retry={refresh} />
    <section className="role-home-panel"><div className="role-panel-title"><h2>管理入口</h2><span>配置与维护</span></div><div className="role-action-list">
      <HomeAction page="people" title="账号与小组" detail="开通账号、分配负责小组" onNavigate={onNavigate} />
      <HomeAction page="csAccounts" title="客服微信号" detail="发放登记码、维护公司微信" onNavigate={onNavigate} />
      <HomeAction page="modules" title="模块与系统设置" detail="模块启停、填报补报窗口" onNavigate={onNavigate} />
    </div></section>
    <div className="role-detail-grid">
      <section className="role-home-panel"><div className="role-panel-title"><h2>归属待完善</h2><button type="button" className="text-action" onClick={() => onNavigate("people")}>设置小组<DashboardIcon name="arrow" /></button></div>
        <div className="role-status-row"><span>未分组的启用主管</span><strong>{unassignedSupervisors?.length ?? "—"}</strong></div>
        <div className="role-status-row"><span>未归组的启用微信</span><strong>{unassignedAccounts?.length ?? "—"}</strong></div>
        {unassignedSupervisors?.length === 0 && unassignedAccounts?.length === 0 && <p className="panel-note">暂无未分组的启用主管或微信。</p>}
        {!!unassignedSupervisors?.length && <p className="panel-note">{unassignedSupervisors.map(user => user.displayName).join("、")}：设置负责小组后才能查看组内数据。</p>}
        {teams?.length === 0 && <p className="panel-note">尚未创建小组，请先建立小组再分配主管、登记微信。</p>}
      </section>
      <section className="role-home-panel"><div className="role-panel-title"><h2>模块状态</h2><button type="button" className="text-action" onClick={() => onNavigate("modules")}>管理<DashboardIcon name="arrow" /></button></div>
        {moduleEntries?.map(([key, value]) => <div className="role-status-row" key={key}><span>{modules?.labels[key] ?? key}</span><span className={`role-status ${value ? "is-on" : "is-off"}`}>{value ? "已启用" : "已停用"}</span></div>)}
        {!moduleEntries && <p className="panel-note">{loading ? "正在读取模块状态…" : "模块状态暂不可用。"}</p>}
      </section>
    </div>
    <p className="role-home-scope">本账号管理系统配置，无业务数据查看或修改权限。员工账号数不含公司客服微信。</p>
  </div>;
}

export function SupervisorHome({ today, onNavigate }: { today: string; onNavigate: Navigate }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadSupervisorHome>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick(value => value + 1);
  useEffect(() => {
    let active = true; setLoading(true); setData(null);
    loadSupervisorHome(today).then(result => { if (active) { setData(result); setLoading(false); } });
    return () => { active = false; };
  }, [today, tick]);
  const teams = loaded(data?.fans)?.teams;
  const orders = loaded(data?.orders);
  const accounts = loaded(data?.accounts)?.accounts;
  const reporting = teams ? reportingOverview(teams) : null;
  const noScope = teams?.length === 0;
  const total = (key: "totalAdded" | "validToday" | "commReplied" | "commReadNoReply" | "commUnread" | "commInvalid") => teams && !noScope && teams.every(team => team[key] != null) ? teams.reduce((sum, team) => sum + (team[key] ?? 0), 0) : null;
  const missingList = missingReporters(teams);
  const effective = orders ? effectiveOrderAmount(orders.totals.amount, orders.totals.refunds) : null;
  const errors = sourceErrors([["本组加粉", data?.fans], ["本组订单", data?.orders], ["本组微信", data?.accounts]]);
  return <div className="management-dashboard role-home supervisor-home" aria-busy={loading}>
    <CompactHeading title="本组工作台" caption={`${today} · 今日`} loading={loading} refresh={refresh} />
    {noScope ? <section className="role-home-panel role-empty"><h2>尚未分配负责小组</h2><p>请联系后台管理员设置负责小组，设置后可查看组内数据并登记客服微信。</p></section> : <>
      <div className="role-kpis" aria-label="本组今日加粉概况">
        <HomeMetric label="加粉总数" value={total("totalAdded")} page="summary" onNavigate={onNavigate} pending={loading && !data} />
        <HomeMetric label="今日有效" value={total("validToday")} page="summary" onNavigate={onNavigate} pending={loading && !data} />
        <HomeMetric label="取得沟通" value={total("commReplied")} page="summary" onNavigate={onNavigate} pending={loading && !data} />
        <HomeMetric label="无效客源" value={total("commInvalid")} page="summary" onNavigate={onNavigate} pending={loading && !data} />
      </div>
      <FanStateBar total={total("totalAdded")} replied={total("commReplied")} readNoReply={total("commReadNoReply")} unread={total("commUnread")} invalid={total("commInvalid")} />
      {missingList.length > 0 && <section className="role-missing" aria-label="今日未报账号"><strong>今日未报 {missingList.length}</strong><div className="missing-chips">{missingList.map(item => <button type="button" key={item.userId} className="missing-chip" title={`${item.teamName} · 今日未报，点击查看加粉明细`} onClick={() => onNavigate("summary")}>{item.displayName}</button>)}</div><button type="button" className="text-action" onClick={() => onNavigate("summary")}>明细<DashboardIcon name="arrow" /></button></section>}
      <section className="role-home-panel role-order-preview"><div className="role-panel-title"><h2>今日订单概况<InfoTip label="订单口径" text={`有效金额 = 订单金额 ${yuan(orders?.totals.amount)}（含退款源订单）− 退款 ${yuan(orders?.totals.refunds)}。按今日业务日统计，人民币。`} /></h2><button type="button" className="text-action" onClick={() => onNavigate("orders")}>全部消费<DashboardIcon name="arrow" /></button></div><div className="role-order-values"><div><span>有效金额</span><strong>{yuan(effective)}</strong></div><div><span>有效订单</span><strong>{orders ? orders.orders.filter(order => order.status !== "refunded").length : "—"}<small>笔</small></strong></div></div></section>
    </>}
    <HomeErrors errors={errors} retry={refresh} />
    {!noScope && <section className="role-home-panel"><div className="role-panel-title"><h2>今日加粉填报<InfoTip label="填报口径" text="按微信及原员工账号计数，多主页不重复计数。填报 0 仍计为已报。" /></h2><button type="button" className="text-action" onClick={() => onNavigate("summary")}>查看明细<DashboardIcon name="arrow" /></button></div>
      <div className="role-reporting-line"><strong>{reporting?.reported ?? "—"}<small> / {reporting?.expected ?? "—"} 账号</small></strong><span>{reporting?.percentage == null ? reporting ? "暂无应报账号" : "暂不可用" : `完成 ${reporting.percentage}%`}</span></div>
      <progress className="reporting-progress" aria-label="本组今日加粉填报完成度" max={reporting?.expected || 1} value={reporting?.reported ?? 0} />
      {teams?.map(team => <div className="role-team-row" key={team.teamId}><div><strong>{team.teamName}</strong><small>已报 {team.reportedCount} / 应报 {team.expectedCount}</small></div><span>未报 {team.missingCount}</span></div>)}
      {!!teams?.some(team => team.statsIncomplete) && <p className="data-flag">含未分类旧记录 · 状态统计不完整</p>}
    </section>}
    <section className="role-home-panel"><div className="role-panel-title"><h2>本组客服微信</h2><span>{accounts ? `${accounts.length} 个已登记` : "—"}</span></div><p className="role-account-split">{accounts ? <>启用 <b>{accounts.filter(account => account.isActive).length}</b> · 停用 <b>{accounts.filter(account => !account.isActive).length}</b></> : loading ? "正在读取微信列表…" : "微信列表暂不可用"}</p><div className="role-action-list"><HomeAction page="csAccounts" title="登记与维护微信" detail="发放一次性登记码、更新本组微信" onNavigate={onNavigate} /></div></section>
    <p className="role-home-scope">数据范围<InfoTip label="数据范围说明" text="仅汇总已授权小组。加粉与订单按业务日的小组归属读取；历史筛选请进入对应明细。" /></p>
  </div>;
}
