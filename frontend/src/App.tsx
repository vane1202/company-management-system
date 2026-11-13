import { isServiceAccount } from './serviceAccounts';
import { AdAccountsWorkspace } from "./AdAccountsWorkspace";
import { SalaryWorkspace } from "./SalaryWorkspace";
import { WorkspaceBackbar, useWorkspaceNavigation } from "./WorkspaceNavigation";
import {LiveBusinessOverview} from './LiveBusinessOverview';
import {defaultLiveView,liveViewLabel,type LiveView} from './liveBusinessNavigation';
import { OrderWorkspace } from "./OrderWorkspace";
import { FinanceDesk } from "./FinanceDesk";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { DailyForm } from "./DailyForms";
import { LeadWorkspace } from "./LeadWorkspace";
import { detailLines } from "./dailyDetail";
import { ModuleSettings } from "./ModuleSettings";
import { SystemSettings } from "./SystemSettings";
import { DashboardHome } from "./DashboardHome";
import { AdminHome, SupervisorHome } from "./RoleHomes";
import {AdminWorkbench,SupervisorWorkbench} from "./demo/RoleWorkbenches";
import { DashboardIcon } from "./DashboardIcon";
import { CsDeviceRegistration } from "./CsDeviceRegistration";
import { CsAccountsPage } from "./CsAccountsPage";
import { fillEntries, fillEntryFromPath, canUseFillEntry } from "./fillEntries";
import { type FormEvent, type ReactNode, lazy, Suspense, useEffect, useState } from "react";
import { canQueryByDate, isIsoDate } from "./dates";
import { labelOrderStatus } from "./labels";
import { bossLinkedPages, navItems, pageLabel, roleLabel, type Page } from "./access";
import { createRequestGate } from "./requestGate";
import { toErrorMessage } from "./errors";
import { readSessionMeta, type SessionMeta } from "./sessionMeta";
import { toast } from "./Toast";
import { BootSkeleton, Skeleton } from "./Skeleton";
import {
  api,
  type AdminUser,
  type CsAccount,
  type EditorReport,
  type FanReport,
  type FanSummary,
  type Metrics,
  type Note,
  type OpsReport,
  type Order,
  type Salary,
  type Team,
  type User
} from "./api";

if (import.meta.env.MODE === 'demo') void import('./demo/dashboard-phase1.css');
const DemoOpsAnalysis = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/OpsAnalysis')) : null;
const DemoEstimateBoard = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/BossEstimateBoard')) : null;
const DemoCustomerFill = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/CustomerFillWorkspace')) : null;
const DemoSupervisorPerformance = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/SupervisorPerformance')) : null;
const DemoEditorFill = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/EditorFillWorkspace')) : null;
const DemoEditorOverview = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/EditorOverview')) : null;
const DemoStaffAssessment = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/StaffAssessment')) : null;

export function App() {
  const [modules, setModules] = useState<Record<string, boolean> | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const navigation = useWorkspaceNavigation(user?.id, user?.role);
  const page = navigation.route.page;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [error, setError] = useState("");
  const [today, setToday] = useState("");
  const [backfillDays, setBackfillDays] = useState(3);
  const [disclaimer, setDisclaimer] = useState("");
  const [pageErrors, setPageErrors] = useState<Partial<Record<Page, string>>>({});
  const entry = fillEntryFromPath(window.location.pathname);

  useEffect(() => {
    setError(""); setMobileNavOpen(false);
  }, [page, navigation.route.orderId, navigation.route.live]);
  useEffect(() => { setPageErrors({}); }, [user?.id, user?.role]);

  function applySession(nextUser: User, payload?: SessionMeta) {
    const meta = readSessionMeta(payload);
    setToday(meta.today);
    if (typeof meta.backfillDays === "number") setBackfillDays(meta.backfillDays);
    if (meta.disclaimer) setDisclaimer(meta.disclaimer);
    setUser(nextUser);
  }

  async function hydrateUser(nextUser: User, payload?: SessionMeta) {
    const parsed = readSessionMeta(payload);
    if (parsed.today && parsed.disclaimer) {
      applySession(nextUser, parsed);
      return;
    }
    const meta = await api.meta();
    applySession(nextUser, { ...parsed, ...meta });
  }

  useEffect(() => {
    if (user) api.modules().then((data) => setModules(data.modules)).catch((err) => setError(toErrorMessage(err, "加载模块配置失败")));
  }, [user?.id]);

  useEffect(() => {
    (async () => {
      try {
        await api.loadCsrf();
        const me = await api.me();
        await hydrateUser(me.user, me);
      } catch {
        setUser(null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  if (!ready) return <BootSkeleton />;
  if (!user) return <Login onLogin={hydrateUser} entry={entry} />;
  if (!today) return <BootSkeleton />;
  if (user.mustChangePassword) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, mustChangePassword: false })} />;
  }

  if (DemoCustomerFill && user.role === "cs") return <Suspense fallback={<p role="status">正在打开客服填报…</p>}><DemoCustomerFill today={today} /></Suspense>;
  if (DemoEditorFill && user.role === "editor") return <Suspense fallback={<p role="status">正在打开拍剪填报…</p>}><DemoEditorFill today={today} /></Suspense>;
  if (entry && !canUseFillEntry(user.role, entry)) {
    return <section className="page"><div className="card"><h2>{fillEntries[entry].title}</h2>
      <p>此入口用于客服本人填报。当前登录身份为{roleLabel[user.role]}，请使用相应的客服账号。</p>
      <a className="btn secondary" href="/">返回管理首页</a>
      <button type="button" onClick={async () => { await api.logout(); setUser(null); setModules(null); }}>退出并切换账号</button>
    </div></section>;
  }
  if (entry && !modules) return <div className="page"><p>正在确认填报入口…</p>{error && <p className="error">{error}</p>}<button type="button" onClick={() => api.modules().then((data) => { setModules(data.modules); setError(""); }).catch((err) => setError(toErrorMessage(err)))}>重新加载</button></div>;
  if (entry && modules?.[entry] === false) return <section className="page"><div className="card"><h2>{fillEntries[entry].title}已停用</h2><p>请联系管理员重新启用，历史数据仍保留。</p><a className="btn secondary" href="/">返回首页</a></div></section>;

  const managementRole = ["boss", "admin", "cs_supervisor", "finance"].includes(user.role) || (import.meta.env.MODE === "demo" && user.role === "ops");
  const demoBoss = import.meta.env.MODE === "demo" && user.role === "boss";
  const linkedPages = demoBoss ? bossLinkedPages() : [];
  const items = navItems(user.role).filter((item) => managementRole || !["fans", "orders", "ops", "editor"].includes(item.id) || modules?.[item.id] === true);
  const sidebarItems = user.role === "finance" ? [] : items;
  const rootPage: Page = demoBoss ? "dashboard" : "home";
  const activePage = items.some((item) => item.id === page) || linkedPages.includes(page) ? page : rootPage;
  const navCurrent = linkedPages.includes(activePage) ? rootPage : activePage;
  const bossBusiness=user.role==='boss'&&activePage==='orders';
  const businessContext=navigation.views.orders?.live??defaultLiveView();
  const currentBusiness=navigation.route.live??defaultLiveView();
  const businessBackLabel=bossBusiness?(navigation.route.orderId?(navigation.route.orderList?'订单列表':liveViewLabel(currentBusiness)):navigation.route.orderList?'直播间经营':currentBusiness.view!=='rooms'?'直播间列表':undefined):undefined;
  function goTo(next: Page) {
    setError("");
    setMobileNavOpen(false);
    navigation.navigate({ page: next });
  }
  const pageError = (id: Page) => (value: string) => setPageErrors(current => ({ ...current, [id]: value }));
  function pagePanel(id: Page, children: ReactNode) {
    if (!items.some(item => item.id === id) && !linkedPages.includes(id)) return null;
    if (!(id in navigation.views) && activePage !== id) return null;
    return <section key={`${user!.id}:${user!.role}:${id}`} className="workspace-page" hidden={activePage !== id} aria-label={pageLabel(user!.role, id)}>
      {pageErrors[id] && <p role="alert" className="error">{pageErrors[id]}</p>}{children}
    </section>;
  }
  async function logout() {
    await api.logout();
    await api.loadCsrf();
    toast.clear();
    setError(""); setMobileNavOpen(false); setUser(null); setModules(null);
  }
  return (
    <div className={`page app-shell ${managementRole ? "management-shell" : ""} ${user.role === "boss" ? "boss-shell" : ""}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className={`app-sidebar ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
        <div className="sidebar-brand-row"><button type="button" onClick={() => navigation.up({ page: rootPage })} className="sidebar-brand" aria-label="返回工作台首页"><span className="sidebar-brand-mark"><DashboardIcon name="home" /></span><span><b>内部管理系统</b><small>公司日常工作台</small></span></button>{managementRole && <button type="button" className="mobile-menu-toggle secondary" aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(open => !open)}>{mobileNavOpen ? "收起菜单" : "全部菜单"}</button>}</div>
        {sidebarItems.length > 0 && <span className="nav-section-label">工作空间</span>}
        {sidebarItems.length > 0 && <nav id="workspace-navigation" className="nav" aria-label="主要导航">
          {sidebarItems.map((item) => <button key={item.id} aria-current={navCurrent === item.id ? "page" : undefined} className={navCurrent === item.id ? "active" : ""} onClick={() => goTo(item.id)}><DashboardIcon name={item.id} /><span>{item.label}</span></button>)}
          {managementRole && <button type="button" className="mobile-menu-logout" onClick={logout}>退出登录</button>}
        </nav>}
        <div className="sidebar-footer"><span className="sidebar-avatar">{user.displayName.slice(0, 1)}</span><span><strong>{user.displayName}</strong><small>{roleLabel[user.role]} · 数据按权限展示</small></span></div>
      </aside>
      <div className="app-main">
      <header className="topbar app-toolbar">
        <div className="toolbar-breadcrumb">工作台 <span>/</span> <strong>{pageLabel(user.role, activePage)}</strong></div>
        <div className="toolbar-account"><span>{user.displayName}</span>
        <button
          className="secondary"
          onClick={logout}
        >
          退出
        </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
      {activePage !== rootPage && <WorkspaceBackbar page={activePage} detail={activePage === "orders" && !!navigation.route.orderId} homeLabel={items[0].label} pageLabel={bossBusiness?(navigation.route.orderList?'订单档案':liveViewLabel(currentBusiness)):pageLabel(user.role, activePage)} backLabel={businessBackLabel} onUp={() => { const route = navigation.route; const insideOrders = route.page === "orders" && !!(route.orderId || route.orderList || route.live && route.live.view !== "rooms"); navigation.up(demoBoss && !insideOrders ? { page: "dashboard" } : undefined); }} onHome={() => navigation.up({ page: rootPage })} />}
      {error && <p className="error">{error}</p>}
      {isServiceAccount(user.accountKind) && <p className="notice">当前填报接待账号：<strong>{user.serviceAccountLabel??user.wechatId}</strong>{user.phoneLabel ? `（${user.phoneLabel}）` : ""}。加粉与订单长期归属于此接待账号；退出后需管理员重新发码。</p>}
      {pagePanel("home", <Home user={user} today={today} backfillDays={backfillDays} disclaimer={disclaimer} onNavigate={goTo} onOpenBusiness={live=>navigation.navigate({page:'orders',live})} />)}
      {pagePanel("fans", <FanForm today={today} onError={pageError("fans")} platform={user.servicePlatform}/>)}
      {pagePanel("summary", <FanSummaryPage today={today} onError={pageError("summary")} supervisor={user.role === "cs_supervisor"} onNavigate={goTo} />)}
      {pagePanel("assessment", DemoStaffAssessment ? <Suspense fallback={<p role="status">正在读取客服考核…</p>}><DemoStaffAssessment today={today} scope={user.role === "cs_supervisor" ? "本组" : "全部"} /></Suspense> : <p className="notice">客服考核目前只在独立演示提供。</p>)}
      {pagePanel("orders", DemoSupervisorPerformance && user.role === 'cs_supervisor' ? <Suspense fallback={<p role="status">正在读取本组业绩…</p>}><DemoSupervisorPerformance today={today} user={user} selectedId={navigation.views.orders?.orderId ?? ''} onSelectOrder={id => navigation.navigate({page:'orders',orderId:id})} /></Suspense> : user.role==='boss'?<><div hidden={!!navigation.views.orders?.orderId||!!navigation.views.orders?.orderList}><LiveBusinessOverview today={today} context={businessContext} onOpenBusiness={live=>navigation.navigate({page:'orders',live})} onOpenOrder={id=>navigation.navigate({page:'orders',live:businessContext,orderId:id})} onOpenOrders={()=>navigation.navigate({page:'orders',live:businessContext,orderList:true})}/></div>{(navigation.views.orders?.orderId||navigation.views.orders?.orderList)&&<OrderWorkspace today={today} user={user} selectedId={navigation.views.orders.orderId??''} onSelectOrder={id=>navigation.navigate({...navigation.views.orders!,orderId:id})}/>}</>:<OrderWorkspace today={today} user={user} selectedId={navigation.views.orders?.orderId ?? ""} onSelectOrder={id => navigation.navigate({ page: "orders", orderId: id })} />)}
      {pagePanel("ops", DemoOpsAnalysis&&user.role==='boss'?<Suspense fallback={<p role="status">正在读取投放分析…</p>}><DemoOpsAnalysis today={today}/></Suspense>:<OpsPage today={today} onError={pageError("ops")} readOnly={user.role === "boss"} />)}
      {pagePanel("editor", DemoEditorOverview && user.role==='boss'?<Suspense fallback={<p role="status">正在读取拍剪汇总…</p>}><DemoEditorOverview today={today}/></Suspense>:<EditorPage today={today} onError={pageError("editor")} readOnly={user.role === "boss"} />)}
      {pagePanel("dashboard", DemoEstimateBoard ? <Suspense fallback={<p role="status">正在读取经营估算…</p>}><DemoEstimateBoard today={today} onError={pageError("dashboard")} onOpen={goTo} /></Suspense> : <DashboardPage onError={pageError("dashboard")} />)}
      {pagePanel("modules", <><ModuleSettings onError={pageError("modules")} onChange={setModules} /><SystemSettings defaultDays={backfillDays} /></>)}
      {pagePanel("people", <PeoplePage today={today} onError={pageError("people")} />)}
      {pagePanel("csAccounts", <CsAccountsPage supervisor={user.role === "cs_supervisor"} />)}
      {pagePanel("finance", <FinanceWorkspace today={today} readOnly />)}
      {pagePanel("salaries", <SalaryWorkspace today={today} readOnly={user.role !== "finance"} />)}

      </main>
      </div>
      {sidebarItems.length > 0 && <nav className="bottom-nav" aria-label="底部导航">
        {sidebarItems.slice(0, 5).map((item) => (
          <button key={item.id} aria-current={navCurrent === item.id ? "page" : undefined} className={navCurrent === item.id ? "active" : ""} onClick={() => goTo(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>}
    </div>
  );
}


function Login({ onLogin, entry }: { onLogin: (user: User, extras?: SessionMeta) => void | Promise<void>; entry: keyof typeof fillEntries | null }) {
  const [employeeLogin, setEmployeeLogin] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await api.loadCsrf();
      const data = await api.login(username, password);
      await onLogin(data.user, data);
    } catch (err) {
      setError(toErrorMessage(err, "登录失败"));
    } finally {
      setPending(false);
    }
  }

  if (entry && !employeeLogin) return <CsDeviceRegistration title={fillEntries[entry].title} onRegistered={onLogin} onEmployeeLogin={() => setEmployeeLogin(true)} />;
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <b>{entry ? fillEntries[entry].title : "公司内部管理系统"}</b>
          <span>{entry ? fillEntries[entry].description : "账号由行政开通，不能自行注册"}</span>
        </div>
        <div className="row">
          <label htmlFor="username">登录名</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div className="row">
          <label htmlFor="password">密码</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "登录中…" : "登录"}</button>
        {entry && <button type="button" className="secondary" onClick={() => setEmployeeLogin(false)}>返回客服接待账号登记</button>}
      </form>
    </div>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div className="login-wrap">
      <form
        className="card login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          try {
            await api.changePassword(currentPassword, newPassword);
            toast.success(`${user.displayName}：新密码已保存`);
            onDone();
          } catch (err) {
            const text = toErrorMessage(err, "修改失败");
            setError(text);
            toast.error(`修改密码失败：${text}`);
          } finally {
            setPending(false);
          }
        }}
      >
        <h2>首次登录请修改密码</h2>
        <p className="notice">{user.displayName}，为保护账号安全，请先设置新密码后再使用系统。</p>
        <div className="row">
          <label>当前密码</label>
          <input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="row">
          <label>新密码（至少 10 位，含字母和数字）</label>
          <input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "保存中…" : "保存新密码"}</button>
      </form>
    </div>
  );
}

function Home({
  user,
  today,
  backfillDays,
  disclaimer,
  onNavigate,
  onOpenBusiness
}: {
  user: User;
  today: string;
  backfillDays: number;
  disclaimer: string;
  onNavigate: (page: Page) => void;
  onOpenBusiness:(view:LiveView)=>void;
}) {
  if (DemoOpsAnalysis && user.role === "ops") return <Suspense fallback={<p role="status">正在读取运营工作台…</p>}><DemoOpsAnalysis today={today} onOpenReports={()=>onNavigate("ops")}/></Suspense>;
  if (user.role === "finance") return <FinanceDesk today={today} onOpenSalary={() => onNavigate("salaries")} />;
  if (user.role === "boss") return <DashboardHome today={today} onNavigate={onNavigate} onOpenBusiness={onOpenBusiness} />;
  if (user.role === "admin") return import.meta.env.MODE === "demo" ? <AdminWorkbench onNavigate={onNavigate}/> : <AdminHome onNavigate={onNavigate} />;
  if (user.role === "cs_supervisor") return import.meta.env.MODE === "demo" ? <SupervisorWorkbench today={today} onNavigate={onNavigate}/> : <SupervisorHome today={today} onNavigate={onNavigate} />;
  return (
    <section className="card">
      <h2>今日 {today || "—"}</h2>
      <p className="notice">业务日按东八区计算。客服加粉入口可放进接待账号群公告，每天打开同一链接即可，系统不会自动往群里发消息。</p>
      {user.role === "cs" && <p className="notice">你只能填报并查看自己的加粉与订单。补报窗口为近 {backfillDays} 个业务日（含今天）。填写 0 表示当天已报零粉，未提交则是未报。</p>}
      {user.role === "assistant" && <p className="notice">原助理流程已停用，请由后台管理员调整账号角色。</p>}
    </section>
  );
}

function FanForm({ today, onError,platform }: { today: string; onError: (value: string) => void;platform?:string|null }) {
  return <><LeadWorkspace today={today} editable platform={platform}/><details className="card"><summary>主页日报与当日沟通汇报</summary><DailyForm kind="fan_report" today={today} onError={onError} servicePlatform={platform}/></details></>;
}

function FanSummaryPage({ today, onError, supervisor = false, onNavigate }: { today: string; onError: (value: string) => void; supervisor?: boolean; onNavigate: (page: Page) => void }) {
  const [date, setDate] = useState(today);
  const [accounts, setAccounts] = useState<CsAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [teams, setTeams] = useState<FanSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedDate, setLoadedDate] = useState("");
  const gate = useState(() => createRequestGate())[0];

  async function load(next = date) {
    if (!canQueryByDate(next)) return;
    const ticket = gate.next();
    setLoading(true);
    try {
      const [data, choices] = await Promise.all([api.fanSummary(next, undefined, accountId), api.csAccounts(next)]);
      if (!ticket.isCurrent()) return;
      setTeams(data.teams);
      setAccounts(choices.accounts);
      setLoaded(true);
      setLoadedDate(next);
      onError("");
    } catch (err) {
      if (!ticket.isCurrent()) return;
      onError(toErrorMessage(err, "加载失败"));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }
  useEffect(() => {
    if (isIsoDate(today)) setDate(today);
  }, [today]);
  useEffect(() => {
    if (canQueryByDate(date)) load(date);
  }, [date, accountId]);
  const empty = loaded && !loading && teams.every((team) => team.details.length === 0);
  // 有应报账号但全部未报：同样提示“还没有加粉记录”，下方仍列出未报名单。
  const noReports = loaded && !loading && !empty && teams.every((team) => team.details.every((item) => item.status !== "reported"));

  return (
    <><LeadWorkspace today={today} layered={import.meta.env.MODE==='demo'} supervisor={supervisor}/><details className="card" aria-busy={loading}><summary>原始加粉日报与当日沟通汇报</summary><section>

      <h2>加粉日报汇总</h2>
      <p className="notice">当日沟通情况可包含往日客户；月进粉仅作累计汇报。初步转化请看上方客户明细考核。</p>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input aria-label="汇总业务日" type="date" value={date} onChange={(e) => { setDate(e.target.value); setAccountId(""); }} />
        <select aria-label="按客服接待账号筛选加粉" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">全部客服接待账号及原员工账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.wechatId}{account.phoneLabel ? ` · ${account.phoneLabel}` : ""}</option>)}</select>
        <button type="button" disabled={loading} onClick={() => load(date)}>{loading ? "查询中…" : "查询"}</button>

        <a className="btn secondary" href={api.fanExportUrl(date, accountId)}>导出 CSV</a>
      </div>
      {loading && loaded && <p className="notice" role="status">正在读取 {date} 的加粉记录…</p>}
      {loading && !loaded && <div className="card" aria-hidden="true">
        <Skeleton block width="30%" height="1.1rem" />
        <div className="metrics">{[0, 1, 2, 3].map((i) => <div className="metric" key={i}><b><Skeleton width="2.5em" height="1.2em" /></b><span><Skeleton width="4em" /></span></div>)}</div>
        <Skeleton block width="100%" height="2.6rem" />
        <Skeleton block width="100%" height="2.6rem" />
      </div>}
      {(empty || noReports) && <div className="empty-state" role="status">
        <strong>{loadedDate} 还没有加粉记录</strong>
        <p>{supervisor ? "可切换上方日期查看其他业务日；如果本组客服还没出现在这里，请去“本组客服微信”确认微信已登记。" : "可切换上方日期查看其他业务日。"}</p>
        {supervisor && <button type="button" className="secondary" onClick={() => onNavigate("csAccounts")}>去本组客服账号管理</button>}
      </div>}
      {!empty && teams.map((team) => (
        <div key={team.teamId} className="card">
          <h3>{team.teamName}</h3>
          <div className="metrics">
            <div className="metric"><b>{team.totalAdded}</b><span>加粉总数</span></div>
            <div className="metric"><b>{team.validToday ?? "—"}</b><span>今日有效</span></div>
            <div className="metric"><b>{team.commReplied ?? "—"}</b><span>取得沟通</span></div>
            <div className="metric"><b>{team.commInvalid ?? "—"}</b><span>无效客源</span></div>
          </div>
          <FanDetailCards team={team} />
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>客服接待账号 / 原账号</th><th>加粉数</th><th>填报</th></tr>
              </thead>
              <tbody>
                {team.details.map((item) => (
                  <tr key={item.userId}>
                    <td>{item.displayName}</td>
                    <td>{item.addedCount === null ? "—" : item.addedCount}</td>
                    <td><span className={`badge ${item.status}`}>{item.status === "reported" ? (item.addedCount === 0 ? "已报 0" : "已报") : "未报"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section></details></>
  );
}

function OpsPage({ today, onError, readOnly }: { today: string; onError: (value: string) => void; readOnly?: boolean }) {
  return <><DailyForm kind="ops_report" today={today} onError={onError} readOnly={readOnly} /><AdAccountsWorkspace today={today} readOnly={readOnly} /></>;
}

function EditorPage({ today, onError, readOnly }: { today: string; onError: (value: string) => void; readOnly?: boolean }) {
  return <DailyForm kind="editor_report" today={today} onError={onError} readOnly={readOnly} />;
}

function DashboardPage({ onError }: { onError: (value: string) => void }) {
  const [preset, setPreset] = useState("day");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.dashboard>> | null>(null);
  const [loading, setLoading] = useState(false);
  const gate = useState(() => createRequestGate())[0];
  async function load(next = preset) {
    const ticket = gate.next(); setLoading(true); setData(null);
    try { const result = await api.dashboard(next); if (ticket.isCurrent()) { setData(result); onError(""); } }
    catch (err) { if (ticket.isCurrent()) onError(toErrorMessage(err, "加载经营估算失败")); }
    finally { if (ticket.isCurrent()) setLoading(false); }
  }
  useEffect(() => { load("day"); }, []);
  const m = data?.metrics;
  return <section className="card"><h2>经营估算</h2><div className="actions">{[["day","今日"],["week","本周"],["month","本月"]].map(([key,label]) => <button key={key} type="button" className={preset === key ? "" : "secondary"} onClick={() => { setPreset(key); load(key); }}>{label}</button>)}<button type="button" className="secondary" onClick={() => load()}>刷新</button></div>
    {loading && <p role="status">读取中…</p>}
    {data && m && <><p className="notice">{data.period.from} 至 {data.period.to}</p><div className="metrics">{Object.entries({revenue:"订单金额（含退款源订单）",refunds:"退款金额",promoCost:"历史推广费（币种未知）",salaryAllocated:"工资分摊",customProductCost:"定制成本",laborCost:"工费",shippingCost:"运费",estimate:"经营估算"}).map(([key,label]) => <div className="metric" key={key}><b>{String(m[key as keyof Metrics])}</b><span>{label}</span></div>)}</div><DailyDetailMetrics item={m} /><article className="review-card"><h3>运营投放 · USD</h3><p>花费 {data.opsUsd.spendUsd} · 咨询 {data.opsUsd.consultCount} · 点击 {data.opsUsd.clickCount}</p><p>区间末次余额 {data.opsUsd.endingBalanceUsd ?? "未记录"} USD</p></article><p className="notice">{data.formula}</p><p className="notice">{data.estimateNote}</p><p className="notice">{data.disclaimer}</p></>}
  </section>;
}

function PeoplePage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamPending, setTeamPending] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [userPending, setUserPending] = useState(false);
  const [userError, setUserError] = useState("");
  const [scopeUser, setScopeUser] = useState<AdminUser | null>(null);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [savingUser, setSavingUser] = useState("");
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "ops",
    teamId: "",
    membershipStart: today
  });

  async function refresh() {
    setTeams((await api.teams()).teams);
    setUsers((await api.users()).users.filter((item) => !isServiceAccount(item.accountKind)));
    setLoaded(true);
  }
  /** 保存已成功后再刷新列表；刷新失败单独说明，不把已保存误报为失败。 */
  async function refreshAfterSave() {
    try { await refresh(); }
    catch { const text = "已保存，但列表刷新失败，请点刷新"; onError(text); toast.error(text); }
  }
  function fail(prefix: string, err: unknown, setLocal?: (value: string) => void) {
    const text = toErrorMessage(err, "保存失败");
    if (setLocal) setLocal(text); else onError(text);
    toast.error(`${prefix}：${text}`);

  }
  useEffect(() => {
    if (isIsoDate(today)) setForm((current) => ({ ...current, membershipStart: current.membershipStart || today }));
  }, [today]);
  useEffect(() => {
    refresh().catch((err) => onError(toErrorMessage(err)));
  }, []);

  return (
    <section className="grid two">
      <div className="card">
        <div className="commerce-line"><h2>小组</h2><button type="button" className="secondary" onClick={() => refresh().then(() => onError("")).catch((err) => onError(toErrorMessage(err)))}>刷新</button></div>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (teamPending) return;
            const name = teamName.trim();
            setTeamPending(true); setTeamError("");
            try {
              await api.createTeam({ name: teamName });
            } catch (err) {
              fail("新增小组失败", err, setTeamError);
              return;
            } finally {
              setTeamPending(false);
            }
            setTeamName("");
            toast.success(`已新增小组「${name}」`);
            await refreshAfterSave();
          }}
        >
          <Field label="小组名称"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
          <button type="submit" disabled={teamPending}>{teamPending ? "保存中…" : "新增小组"}</button>
          {teamError && <p className="action-error" role="alert">{teamError}</p>}
        </form>
        {loaded && !teams.length && <div className="empty-state"><strong>还没有小组</strong><p>先新增一个小组，再开通主管和登记微信。</p></div>}
        <ul>
          {teams.map((team) => <li key={team.id}>{team.name}</li>)}
        </ul>
      </div>
      <div className="card">
        <h2>员工账号与权限</h2>
        {scopeUser && <form className="review-card" onSubmit={async (e) => { e.preventDefault(); const target = scopeUser; setSavingUser(target.id); try { await api.setSupervisorTeams(target.id, scopeIds); } catch (err) { fail(`${target.displayName} 负责小组未保存`, err); setSavingUser(""); return; } setSavingUser(""); setScopeUser(null); onError(""); toast.success(`已保存 ${target.displayName} 的负责小组（${scopeIds.length} 个）`); await refreshAfterSave(); }}><h3>设置 {scopeUser.displayName} 的负责小组</h3><p className="notice">未勾选任何小组时，主管不能查看业务数据或登记客服接待账号。</p>{teams.map((team) => <label className="row" key={team.id}><input type="checkbox" checked={scopeIds.includes(team.id)} onChange={(e) => setScopeIds(e.target.checked ? [...scopeIds,team.id] : scopeIds.filter((id) => id !== team.id))} />{team.name}</label>)}<div className="actions"><button disabled={!!savingUser}>{savingUser ? "保存中…" : "保存负责小组"}</button><button type="button" className="secondary" onClick={() => setScopeUser(null)}>取消</button></div></form>}
        <p className="notice">管理、运营、拍剪等人员在这里开通。固定客服手机请到“客服接待账号”发放登记码，无需为每位轮班客服创建员工账号。</p>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            if (userPending) return;
            const created = { name: form.displayName.trim() || form.username.trim(), role: roleLabel[form.role as keyof typeof roleLabel] ?? form.role };
            setUserPending(true); setUserError("");
            try {
              await api.createUser({ ...form, managedTeamIds: form.role === "cs_supervisor" && form.teamId ? [form.teamId] : [] });
            } catch (err) {
              fail("开通账号失败", err, setUserError);
              return;
            } finally {
              setUserPending(false);
            }
            setForm({ ...form, username: "", displayName: "", password: "" });
            onError("");
            toast.success(`已开通账号：${created.name}（${created.role}）`);
            await refreshAfterSave();
          }}
        >
          <Field label="登录名"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="姓名"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="初始密码"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="角色">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(roleLabel).filter(([key]) => key !== "assistant").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="所属/负责小组">
            <select value={form.teamId} onChange={(e) => setForm({ ...form, teamId: e.target.value })}>
              <option value="">不设置</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </Field>
          <button type="submit" disabled={userPending}>{userPending ? "保存中…" : "开通账号"}</button>
          {userError && <p className="action-error" role="alert">{userError}</p>}
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>姓名</th><th>登录名</th><th>角色</th><th>小组 / 管理范围</th><th>状态</th></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.displayName}</td>
                  <td>{item.username}</td>
                  <td><select aria-label={`${item.username}角色`} disabled={savingUser === item.id} value={item.role} onChange={async (e) => { const role = e.target.value; setSavingUser(item.id); try { await api.updateUser(item.id, { role }); } catch (err) { fail(`${item.displayName} 角色未修改`, err); setSavingUser(""); return; } setSavingUser(""); onError(""); toast.success(`已将 ${item.displayName} 的角色改为${roleLabel[role as keyof typeof roleLabel] ?? role}`); await refreshAfterSave(); }}>{Object.entries(roleLabel).filter(([key]) => key !== "assistant" || item.role === "assistant").map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td>{item.role === "cs_supervisor" ? <><p>{(item.managedTeamIds ?? []).map((id) => teams.find((team) => team.id === id)?.name || id).join("、") || "暂未分配小组"}</p><button className="secondary" type="button" onClick={() => { setScopeUser(item); setScopeIds(item.managedTeamIds ?? []); }}>设置负责小组</button></> : item.currentTeam?.name ?? "—"}</td>
                  <td><button className="secondary" type="button" disabled={savingUser === item.id} onClick={async () => { setSavingUser(item.id); try { await api.updateUser(item.id, { isActive: !item.isActive }); } catch (err) { fail(`${item.displayName} ${item.isActive ? "停用" : "启用"}失败`, err); setSavingUser(""); return; } setSavingUser(""); onError(""); toast.success(`已${item.isActive ? "停用" : "启用"}账号：${item.displayName}`); await refreshAfterSave(); }}>{savingUser === item.id ? "保存中…" : item.isActive ? "停用账号" : "启用账号"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="row">
      <label>{label}</label>
      {children}
    </div>
  );
}

function FanDetailCards({ team }: { team: FanSummary }) {
  return <><p className="notice">月累计为当日已填主页的累计快照；未填主页不在此汇总内。{team.statsIncomplete ? "含历史未分类记录，统计不完整。" : ""}</p>
    {team.details.map((member) => <article className="review-card" key={member.userId}><strong>{member.wechatId || member.displayName}</strong><span className="chip">{isServiceAccount(member.accountKind) ? "客服接待账号" : "原员工账号"}</span>
      {(member.pages ?? []).map((page) => <div key={page.reportId}>{detailLines("fan_report", page).map((line) => <p key={line}>{line}</p>)}</div>)}
    </article>)}
  </>;
}
function DailyDetailMetrics({ item }: { item: Metrics }) {
 const fields = {msToday:"Messenger 区间新增",wsToday:"WhatsApp 区间新增",msMonth:"Messenger 月累计快照",wsMonth:"WhatsApp 月累计快照",validToday:"区间有效",commReplied:"正常沟通回复",commReadNoReply:"已读不回",commUnread:"未读",commInvalid:"无效粉",legacyUnclassifiedAdded:"未分类旧加粉",editCount:"剪辑",sentToOpsCount:"发给运营"};
 return <><div className="metrics">{Object.entries(fields).map(([key,label]) => <div className="metric" key={key}><b>{String((item as unknown as Record<string, unknown>)[key] ?? "未记录")}</b><span>{label}</span></div>)}</div>
 {item.statsIncomplete && <p className="notice">含历史未分类数据，渠道统计不完整。</p>}
</>;
}
