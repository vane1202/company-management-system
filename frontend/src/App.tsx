import ReimbursementWorkspace from "./demo/ReimbursementWorkspace";
import "./admin-layout.css";
import WarehouseWorkspace from "./demo/WarehouseWorkspace";
import FinanceHome from "./demo/FinanceHome";
import { isServiceAccount } from './serviceAccounts';
import { AdAccountsWorkspace } from "./AdAccountsWorkspace";
import { OpsAdAccounts } from "./OpsAdAccounts";
import { SalaryWorkspace } from "./SalaryWorkspace";
import { WorkspaceBackbar, useWorkspaceNavigation } from "./WorkspaceNavigation";
import {LiveBusinessOverview} from './LiveBusinessOverview';
import {defaultLiveView,liveViewLabel,type LiveView} from './liveBusinessNavigation';
import { OrderWorkspace } from "./OrderWorkspace";
import { CsWorkbench } from "./CsWorkbench";
import { FinanceDesk } from "./FinanceDesk";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { DailyForm } from "./DailyForms";
import { LeadWorkspace } from "./LeadWorkspace";
import type { CashView } from "./cashNavigation";
import { detailLines } from "./dailyDetail";
import { ModuleSettings } from "./ModuleSettings";
import { SystemSettings } from "./SystemSettings";
import { DashboardHome } from "./DashboardHome";
import { AdminHome } from "./RoleHomes";
import {AdminWorkbench,SupervisorWorkbench} from "./demo/RoleWorkbenches";
import { DashboardIcon } from "./DashboardIcon";
import { IdentityName, useIdentityPrivacy } from "./IdentityName";
import { CsAccountsPage } from "./CsAccountsPage";
import { fillEntries, fillEntryFromPath, canUseFillEntry } from "./fillEntries";
import { type FormEvent, type ReactNode, lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from "react";
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
  setUnauthorizedHandler,
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

void import('./demo/dashboard-phase1.css');
const DemoOpsFeedback = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/OpsFeedback')) : null;
const DemoOpsAnalysis = lazy(() => import('./demo/OpsAnalysis'));
const DemoEstimateBoard = lazy(() => import('./demo/BossEstimateBoard'));
const DemoCustomerReview = lazy(() => import('./demo/CustomerInvalidReview'));
const DemoCustomerFill = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/CustomerFillWorkspace')) : null;
const DemoSupervisorPerformance = lazy(() => import('./demo/SupervisorPerformance'));
const DemoEditorFill = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/EditorHistoryWorkspace')) : null;
const DemoEditorOverview = lazy(() => import('./demo/EditorOverview'));
const DemoStaffAssessment = lazy(() => import('./demo/StaffAssessment'));
const DemoReportHistory = lazy(() => import('./demo/ReportHistory'));
const DemoRegisteredAccounts = import.meta.env.MODE === 'demo' ? lazy(() => import('./demo/RegisteredAccountsPage')) : null;

export function App() {
  const [modules, setModules] = useState<Record<string, boolean> | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const identityPrivacy = useIdentityPrivacy(user?.id);
  const navigation = useWorkspaceNavigation(user?.id, user?.role);
  const page = navigation.route.page;
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [error, setError] = useState("");
  const [today, setToday] = useState("");
  const [backfillDays, setBackfillDays] = useState(3);
  const [disclaimer, setDisclaimer] = useState("");
  const [pageErrors, setPageErrors] = useState<Partial<Record<Page, string>>>({});
  const [financeSub, setFinanceSub] = useState<{ label: string; onBack?: () => void } | null>(null);
  const [bossOrdersTick, setBossOrdersTick] = useState(0);
  const handleFinanceSub = useCallback((sub: { label: string; onBack?: () => void } | null) => setFinanceSub(sub), []);
  const entry = fillEntryFromPath(window.location.pathname);
  const hasUserRef = useRef(false);
  hasUserRef.current = user !== null;

  useEffect(() => {
    setError(""); setMobileNavOpen(false);
  }, [page, navigation.route.orderId, navigation.route.live]);
  useEffect(() => { setPageErrors({}); }, [user?.id, user?.role]);
  useEffect(() => {
    function redirectAttendance() {
      if (/^\/fill\/attendance\/?$/.test(window.location.pathname)) {
        window.history.replaceState(window.history.state, "", "/fill" + window.location.search);
      }
    }
    redirectAttendance();
    window.addEventListener("popstate", redirectAttendance);
    return () => window.removeEventListener("popstate", redirectAttendance);
  }, []);

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
    setUnauthorizedHandler((message) => {
      if (!hasUserRef.current) return;
      hasUserRef.current = false;
      identityPrivacy.reset();
      setError("");
      setMobileNavOpen(false);
      setPasswordOpen(false);
      setUser(null);
      setModules(null);
      toast.error(message);
      void api.loadCsrf().catch(() => {});
    });
    return () => setUnauthorizedHandler(null);
  }, []);

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
  if (user.role === "cs") {
    return (
      <CsWorkbench
        today={today}
        user={user}
        onLogout={logout}
        onDeviceActivated={hydrateUser}
      />
    );
  }
  if (DemoEditorFill && user.role === "editor") return <Suspense fallback={<p role="status">正在打开拍剪填报…</p>}><DemoEditorFill today={today} /></Suspense>;
  if (entry && !canUseFillEntry(user.role, entry)) {
    return <section className="page"><div className="card"><h2>{fillEntries[entry].title}</h2>
      <p>此入口用于客服本人填报。当前登录身份为{roleLabel[user.role]}，请使用相应的客服账号。</p>
      <a className="btn secondary" href="/">返回管理首页</a>
      <button type="button" onClick={logout}>退出并切换账号</button>
    </div></section>;
  }
  if (entry && !modules) return <div className="page"><p>正在确认填报入口…</p>{error && <p className="error">{error}</p>}<button type="button" onClick={() => api.modules().then((data) => { setModules(data.modules); setError(""); }).catch((err) => setError(toErrorMessage(err)))}>重新加载</button></div>;
  if (entry && modules?.[entry] === false) return <section className="page"><div className="card"><h2>{fillEntries[entry].title}已停用</h2><p>请联系管理员重新启用，历史数据仍保留。</p><a className="btn secondary" href="/">返回首页</a></div></section>;

  const managementRole = ["boss", "admin", "cs_supervisor", "finance", "warehouse", "ops"].includes(user.role);
  const compactMobileShell = managementRole || user.role === "editor";
  const isBoss = user.role === "boss";
  const linkedPages = isBoss ? bossLinkedPages() : [];
  const items = navItems(user.role).filter((item) => managementRole || !["fans", "orders", "ops", "editor"].includes(item.id) || modules?.[item.id] === true);
  const sidebarItems = user.role === "finance" ? items.filter(item=>item.id!=='salaries') : user.role === "cs_supervisor" ? items.filter((item) => !["summary", "orders", "reportHistory"].includes(item.id)) : items;
  const bottomItems = user.role === "cs_supervisor" && import.meta.env.MODE === "demo" ? sidebarItems : sidebarItems.slice(0, 5);
  const canChangePassword = !isServiceAccount(user.accountKind);
  const accountOnlyMobileNav = bottomItems.length >= sidebarItems.length;
  const rootPage: Page = isBoss ? "dashboard" : user.role === "editor" ? "editor" : "home";
  const activePage = items.some((item) => item.id === page) || linkedPages.includes(page) ? page : rootPage;
  const navCurrent = linkedPages.includes(activePage) || (user.role === "cs_supervisor" && ["summary", "orders", "reportHistory"].includes(activePage)) ? rootPage : activePage;
  const bossBusiness=user.role==='boss'&&activePage==='orders';
  const businessContext=navigation.views.orders?.live??defaultLiveView();
  const currentBusiness=navigation.route.live??defaultLiveView();
  const homeLabel = items[0]?.label ?? pageLabel(user.role, rootPage);
  const goHome = () => { financeSub?.onBack?.(); navigation.up({ page: rootPage }); };
  type Crumb = { label: string; onClick?: () => void };
  const breadcrumbs: Crumb[] = [];
  if (activePage === rootPage) {
    breadcrumbs.push({ label: homeLabel });
  } else {
    breadcrumbs.push({ label: homeLabel, onClick: goHome });
    if (user.role === "finance" && activePage === "salaries") {
      breadcrumbs.push({ label: pageLabel(user.role, "financeOut"), onClick: () => goTo("financeOut") });
      breadcrumbs.push({ label: pageLabel(user.role, "salaries") });
    } else if (bossBusiness) {
      const hasList = !!navigation.route.orderList;
      const hasOrder = !!navigation.route.orderId;
      const liveRoot = () => navigation.navigate({ page: "orders", live: { ...currentBusiness, view: "rooms", roomKey: undefined } });
      breadcrumbs.push({ label: pageLabel(user.role, "orders"), onClick: (hasList || hasOrder) ? liveRoot : undefined });
      if (hasList) {
        breadcrumbs.push({ label: "订单档案", onClick: hasOrder ? () => navigation.up() : undefined });
      }
      if (hasOrder) {
        breadcrumbs.push({ label: "订单详情" });
      }
    } else if ((activePage === "finance" || activePage === "financeOut") && financeSub) {
      breadcrumbs.push({ label: pageLabel(user.role, activePage), onClick: financeSub.onBack });
      breadcrumbs.push({ label: financeSub.label });
    } else if (activePage === "orders" && navigation.route.orderId) {
      breadcrumbs.push({ label: pageLabel(user.role, "orders"), onClick: () => navigation.up() });
      breadcrumbs.push({ label: "订单详情" });
    } else {
      breadcrumbs.push({ label: pageLabel(user.role, activePage) });
    }
  }
  const level3Parent = breadcrumbs.length >= 3 ? breadcrumbs[breadcrumbs.length - 2] : null;
  const currentCrumb = breadcrumbs[breadcrumbs.length - 1];
  function goTo(next: Page, cash?: CashView) {
    setError("");
    setMobileNavOpen(false);
    navigation.navigate({ page: next, ...(user?.role === 'boss' && next === 'finance' && cash ? { cash } : {}) });
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
    try {
      await api.logout();
    } catch {
      // Reset client session state even if server logout fails (expired session, CSRF mismatch, or offline).
    } finally {
      hasUserRef.current = false;
      identityPrivacy.reset();
      toast.clear();
      setError("");
      setMobileNavOpen(false);
      setPasswordOpen(false);
      setUser(null);
      setModules(null);
      void api.loadCsrf().catch(() => {});
    }
  }
  return (
    <div className={`page app-shell ${compactMobileShell ? "management-shell" : ""} ${user.role === "boss" ? "boss-shell" : ""} ${sidebarItems.length > 1 ? "has-bottom-nav" : "no-bottom-nav"}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className={`app-sidebar ${mobileNavOpen ? "mobile-nav-open" : ""} ${accountOnlyMobileNav ? "mobile-nav-account-only" : ""}`}>
        <div className="sidebar-brand-row"><button type="button" onClick={() => navigation.up({ page: rootPage })} className="sidebar-brand" aria-label="返回工作台首页"><span className="sidebar-brand-mark"><DashboardIcon name="home" /></span><span><b>翠管家</b><small>公司日常工作台</small></span></button>{compactMobileShell && <div className="mobile-identity"><IdentityName name={user.displayName} hidden={identityPrivacy.hidden} onToggle={identityPrivacy.toggle} /></div>}{compactMobileShell && (!canChangePassword ? <button type="button" className="mobile-menu-toggle secondary" onClick={logout}>{user.role === "cs_supervisor" ? "退出登录" : "退出"}</button> : <button type="button" className="mobile-menu-toggle secondary" aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(open => !open)}>{mobileNavOpen ? (accountOnlyMobileNav ? "收起" : "收起菜单") : (accountOnlyMobileNav ? "账号" : "全部菜单")}</button>)}</div>
        {sidebarItems.length > 0 && <span className="nav-section-label">工作空间</span>}
        {(sidebarItems.length > 0 || (compactMobileShell && canChangePassword)) && <nav id="workspace-navigation" className="nav" aria-label="主要导航">
          {sidebarItems.map((item) => <button key={item.id} aria-current={navCurrent === item.id ? "page" : undefined} className={navCurrent === item.id ? "active" : ""} onClick={() => goTo(item.id)}><DashboardIcon name={item.id} /><span>{item.label}</span></button>)}
          {compactMobileShell && canChangePassword && <button type="button" className="mobile-menu-logout" onClick={() => { setMobileNavOpen(false); setPasswordOpen(true); window.scrollTo?.({ top: 0, behavior: "smooth" }); }}>修改密码</button>}
          {compactMobileShell && <button type="button" className="mobile-menu-logout" onClick={logout}>退出登录</button>}
        </nav>}
      </aside>
      <div className="app-main">
      <header className="topbar app-toolbar">
        <nav className="toolbar-breadcrumb" aria-label="面包屑导航">
          {breadcrumbs.map((crumb, index) => (
            <span className="toolbar-crumb-item" key={`${crumb.label}:${index}`}>
              {index > 0 && <span className="toolbar-crumb-sep" aria-hidden="true">/</span>}
              {crumb.onClick ? <button type="button" className="toolbar-crumb-link" onClick={crumb.onClick}>{crumb.label}</button> : <strong aria-current="page">{crumb.label}</strong>}
            </span>
          ))}
        </nav>
        <div className="toolbar-account"><IdentityName name={user.displayName} hidden={identityPrivacy.hidden} onToggle={identityPrivacy.toggle} /><span className="toolbar-role-badge">{roleLabel[user.role]}</span>
        {!isServiceAccount(user.accountKind) && (
          <button type="button" className="secondary" onClick={() => setPasswordOpen(open => !open)}>
            修改密码
          </button>
        )}
        <button
          className="secondary"
          onClick={logout}
        >
          退出
        </button>
        </div>
      </header>
      <main id="main-content" tabIndex={-1}>
      {passwordOpen && !isServiceAccount(user.accountKind) && (
        <SelfChangePasswordCard user={user} onClose={() => setPasswordOpen(false)} />
      )}
      {level3Parent?.onClick && <WorkspaceBackbar backLabel={level3Parent.label} currentLabel={currentCrumb.label} onUp={level3Parent.onClick} />}
      {error && <p className="error">{error}</p>}
      {isServiceAccount(user.accountKind) && <p className="notice">当前填报接待账号：<strong>{user.serviceAccountLabel??user.wechatId}</strong>{user.phoneLabel ? `（${user.phoneLabel}）` : ""}。加粉与订单长期归属于此接待账号；退出后需管理员重新发码。</p>}
      {pagePanel("home", <Home user={user} today={today} backfillDays={backfillDays} disclaimer={disclaimer} onNavigate={goTo} active={activePage==='home'} onOpenBusiness={live=>navigation.navigate({page:'orders',live})} />)}
      {pagePanel("fans", <FanForm today={today} onError={pageError("fans")} platform={user.servicePlatform}/>)}
      {pagePanel("summary", <FanSummaryPage today={today} onError={pageError("summary")} supervisor={user.role === "cs_supervisor"} onNavigate={goTo} />)}
      {pagePanel("assessment", <Suspense fallback={<p role="status">正在读取客服考核…</p>}><DemoStaffAssessment today={today} scope={user.role === "cs_supervisor" ? "本组" : "全部"} /></Suspense>)}
      {pagePanel("customerReview", user.role === "cs_supervisor" ? <Suspense fallback={<p role="status">正在打开无效客资复核…</p>}><DemoCustomerReview today={today} /></Suspense> : null)}
      {pagePanel("teamReimbursements", user.role === "cs_supervisor" ? <ReimbursementWorkspace today={today} mode="supervisor" /> : null)}
      {pagePanel("reportHistory", user.role === "cs_supervisor" ? <Suspense fallback={<p role="status">正在读取填报历史…</p>}><DemoReportHistory today={today} supervisor /></Suspense> : null)}
      {pagePanel("orders", user.role === 'cs_supervisor' ? <Suspense fallback={<p role="status">正在读取本组业绩…</p>}><DemoSupervisorPerformance today={today} user={user} selectedId={navigation.views.orders?.orderId ?? ''} onSelectOrder={id => navigation.navigate({page:'orders',orderId:id})} /></Suspense> : user.role==='boss'?<><div hidden={!!navigation.views.orders?.orderId||!!navigation.views.orders?.orderList}><LiveBusinessOverview today={today} tick={bossOrdersTick} context={businessContext} onOpenBusiness={live=>navigation.navigate({page:'orders',live})} onOpenOrder={id=>navigation.navigate({page:'orders',live:businessContext,orderId:id})} onOpenOrders={()=>navigation.navigate({page:'orders',live:businessContext,orderList:true})}/></div>{(navigation.views.orders?.orderId||navigation.views.orders?.orderList)&&<OrderWorkspace today={today} user={user} selectedId={navigation.views.orders.orderId??''} onSelectOrder={id=>navigation.navigate({...navigation.views.orders!,orderId:id})} onOrdersChanged={()=>setBossOrdersTick(t=>t+1)}/>}</>:<OrderWorkspace today={today} user={user} selectedId={navigation.views.orders?.orderId ?? ""} onSelectOrder={id => navigation.navigate({ page: "orders", orderId: id })} />)}
      {user.role === "ops" && DemoOpsFeedback && pagePanel("opsFeedback", <Suspense fallback={<p role="status">Loading...</p>}><DemoOpsFeedback today={today}/></Suspense>)}
      {user.role === "ops" && pagePanel("opsAccounts", <OpsAdAccounts today={today} />)}
      {pagePanel("ops", user.role==='boss'?<Suspense fallback={<p role="status">正在读取投放分析…</p>}><DemoOpsAnalysis today={today} context={navigation.views.ops?.ops}/></Suspense>:<OpsPage today={today} onError={pageError("ops")} readOnly={false} />)}
      {pagePanel("editor", user.role==='boss'?<Suspense fallback={<p role="status">正在读取拍剪汇总…</p>}><DemoEditorOverview today={today}/></Suspense>:modules?.editor===false?<section className="card"><h2>拍剪模块已停用</h2><p>请联系管理员重新启用，历史数据仍保留。</p></section>:<EditorPage today={today} onError={pageError("editor")} readOnly={false} editorName={user.displayName} />)}
      {pagePanel("dashboard", <Suspense fallback={<p role="status">正在读取经营总览…</p>}><DemoEstimateBoard today={today} onError={pageError("dashboard")} onOpen={goTo} onDrill={route=>{setMobileNavOpen(false);setError("");navigation.navigate(route);}} /></Suspense>)}
      {pagePanel("modules", <div className="admin-columns"><ModuleSettings onError={pageError("modules")} onChange={setModules} /><SystemSettings defaultDays={backfillDays} /></div>)}
      {pagePanel("people", <PeoplePage today={today} currentUserId={user.id} onError={pageError("people")} />)}
      {pagePanel("csAccounts", DemoRegisteredAccounts ? <Suspense fallback={<p role="status">正在读取账号名册…</p>}><DemoRegisteredAccounts supervisor={user.role === "cs_supervisor"} /></Suspense> : <CsAccountsPage supervisor={user.role === "cs_supervisor"} />)}
      {pagePanel("finance", user.role==='finance'?<FinanceDesk today={today} section="finance" active={activePage==='finance'} onOpenSalary={()=>goTo('salaries')} onSubViewChange={handleFinanceSub}/>:<FinanceWorkspace today={today} readOnly cashView={navigation.views.finance?.cash} />)}
      {pagePanel("financeOut", <FinanceDesk today={today} section="financeOut" active={activePage==='financeOut'} onOpenSalary={()=>goTo('salaries')} onSubViewChange={handleFinanceSub}/>)}
      {pagePanel("salaries", <SalaryWorkspace today={today} readOnly={user.role !== "finance"} />)}

      </main>
      </div>
      {sidebarItems.length > 1 && <nav className="bottom-nav" aria-label="底部导航">
        {bottomItems.map((item) => (
          <button key={item.id} type="button" aria-current={navCurrent === item.id ? "page" : undefined} className={navCurrent === item.id ? "active" : ""} onClick={() => goTo(item.id)}>
            <DashboardIcon name={item.id} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>}
    </div>
  );
}


function Login({ onLogin, entry }: { onLogin: (user: User, extras?: SessionMeta) => void | Promise<void>; entry: keyof typeof fillEntries | null }) {
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

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <b>{entry ? fillEntries[entry].title : "翠管家"}</b>
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
      </form>
    </div>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const currentId = useId();
  const nextId = useId();
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
        <p className="notice">{user.role === "cs" ? "请设置一个新密码并自行记下。客服账号由客服主管保管这个密码，设置完成后再把登录名和新密码交给客服。系统不会再显示密码。" : user.displayName + "，为保护账号安全，请先设置新密码后再使用系统。"}</p>
        <div className="row">
          <label htmlFor={currentId}>当前密码</label>
          <input id={currentId} type="password" required maxLength={128} autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
        </div>
        <div className="row">
          <label htmlFor={nextId}>新密码（至少 10 位，含字母和数字）</label>
          <input id={nextId} type="password" required minLength={10} maxLength={128} autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={pending}>{pending ? "保存中…" : "保存新密码"}</button>
      </form>
    </div>
  );
}

function SelfChangePasswordCard({ user, onClose }: { user: User; onClose: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const currentId = useId();
  const nextId = useId();
  return (
    <section className="card" aria-label="修改登录密码">
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          setError("");
          try {
            await api.changePassword(currentPassword, newPassword);
            toast.success(`${user.displayName}：密码已更新，其他设备会话已失效`);
            setCurrent("");
            setNew("");
            onClose();
          } catch (err) {
            const text = toErrorMessage(err, "修改失败");
            setError(text);
            toast.error(`修改密码失败：${text}`);
          } finally {
            setPending(false);
          }
        }}
      >
        <h2>修改登录密码</h2>
        <p className="notice">保存新密码后，当前设备保持登录，其他已登录设备将自动失效。</p>
        <div className="row">
          <label htmlFor={currentId}>当前密码</label>
          <input id={currentId} type="password" required maxLength={128} value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="row">
          <label htmlFor={nextId}>新密码（至少 10 位，含字母和数字）</label>
          <input id={nextId} type="password" required minLength={10} maxLength={128} value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" />
        </div>
        {error && <p className="action-error" role="alert">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={pending}>{pending ? "保存中…" : "保存新密码"}</button>
          <button type="button" className="secondary" disabled={pending} onClick={onClose}>取消</button>
        </div>
      </form>
    </section>
  );
}

function Home({
  user,
  today,
  backfillDays,
  disclaimer,
  active,
  onNavigate,
  onOpenBusiness
}: {
  user: User;
  today: string;
  backfillDays: number;
  disclaimer: string;
  active: boolean;
  onNavigate: (page: Page) => void;
  onOpenBusiness:(view:LiveView)=>void;
}) {
  if (DemoOpsAnalysis && user.role === "ops") return <Suspense fallback={<p role="status">正在读取运营工作台…</p>}><DemoOpsAnalysis today={today} onOpenReports={()=>onNavigate("ops")} onOpenFeedback={import.meta.env.MODE==="demo"?(account)=>{try{sessionStorage.setItem("cms-demo-ops-feedback-context",account||"");}catch{}onNavigate("opsFeedback");}:undefined}/></Suspense>;
  if (user.role === "warehouse") return <WarehouseWorkspace today={today} userId={user.id}/>;
  if (user.role === "finance") return <FinanceHome today={today} active={active} onOpen={(section,task)=>{if(task)sessionStorage.setItem('cms-demo-finance-task',task);onNavigate(section);}}/>;
  if (user.role === "boss") return <DashboardHome today={today} onNavigate={onNavigate} onOpenBusiness={onOpenBusiness} />;
  if (user.role === "admin") return import.meta.env.MODE === "demo" ? <AdminWorkbench onNavigate={onNavigate}/> : <AdminHome onNavigate={onNavigate} />;
  if (user.role === "cs_supervisor") return <SupervisorWorkbench today={today} onNavigate={onNavigate}/>;
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
      <p className="notice">当日沟通情况可包含往日客户；月进粉仅作累计汇报。{import.meta.env.MODE==='demo'?'承接需求转化请看上方线索概况；员工开口转化请看客服考核。':'初步转化请看上方客户明细考核。'}</p>
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
        {supervisor && <button type="button" className="secondary" onClick={() => onNavigate("csAccounts")}>去客服账号管理</button>}
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

function EditorPage({ today, onError, readOnly, editorName }: { today: string; onError: (value: string) => void; readOnly?: boolean; editorName?: string }) {
  return <DailyForm kind="editor_report" today={today} onError={onError} readOnly={readOnly} editorName={editorName} />;
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
    {data && m && <><p className="notice">{data.period.from} 至 {data.period.to} · 按业务事件发生日归集</p><div className="metrics">{Object.entries({revenue:"当期收入合计（开单+追加）",baseOrderRevenue:"当日开单金额",additionalChargesRevenue:"当日追加收费",refunds:"退款金额",companyReceivedCny:"公司人民币净到账",supplierPaidCny:"供应商已付款",promoCost:"历史推广费（币种未知）",salaryAllocated:"工资分摊",customProductCost:"定制/商品成本（按费用日）",laborCost:"工费（按费用日）",shippingCost:"运费（按费用日）",estimate:"经营估算"}).map(([key,label]) => <div className="metric" key={key}><b>{String(m[key as keyof Metrics] ?? "0.00")}</b><span>{label}</span></div>)}</div><DailyDetailMetrics item={m} /><article className="review-card"><h3>运营投放 · USD</h3><p>花费 {data.opsUsd.spendUsd} · 咨询 {data.opsUsd.consultCount} · 点击 {data.opsUsd.clickCount}</p><p>区间末次余额 {data.opsUsd.endingBalanceUsd ?? "未记录"} USD</p></article><p className="notice">{data.formula}</p>{data.estimateNote && <p className="notice">{data.estimateNote}</p>}<p className="notice">{data.disclaimer}</p></>}
  </section>;
}

function PeoplePage({ today, currentUserId, onError }: { today: string; currentUserId: string; onError: (value: string) => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamPending, setTeamPending] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [editingTeamId, setEditingTeamId] = useState("");
  const [editingTeamName, setEditingTeamName] = useState("");
  const [teamBusyId, setTeamBusyId] = useState("");
  const [teamRowError, setTeamRowError] = useState("");
  const [teamMessageId, setTeamMessageId] = useState("");
  const [userPending, setUserPending] = useState(false);
  const [userError, setUserError] = useState("");
  const [scopeUser, setScopeUser] = useState<AdminUser | null>(null);
  const [editingUser, setEditingUser] = useState<{
    id: string;
    role: string;
    initialUsername: string;
    initialDisplayName: string;
    initialTeamIds: string[];
    username: string;
    displayName: string;
    teamIds: string[];
    effectiveDate: string;
  } | null>(null);
  const [editError, setEditError] = useState("");
  const [resetUser, setResetUser] = useState<{ id: string; username: string; displayName: string; temporaryPassword: string } | null>(null);
  const [resetError, setResetError] = useState("");
  const [issuedTempPassword, setIssuedTempPassword] = useState<{ displayName: string; username: string; temporaryPassword: string } | null>(null);
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [savingUser, setSavingUser] = useState("");
  const [tab, setTab] = useState<"users" | "teams">("users");
  const [create, setCreate] = useState<"user" | "team" | null>(null);
  const [roleFilter, setRoleFilter] = useState("");
  const [search, setSearch] = useState("");
  const [confirmation, setConfirmation] = useState<{ message: string; run: () => void } | null>(null);
  const visibleUsers = users.filter(item => {
    const groups = teams.filter(team => item.managedTeamIds?.includes(team.id)).map(team => team.name);
    return (!roleFilter || item.role === roleFilter) &&
      [item.displayName, item.username, item.currentTeam?.name, ...(item.currentTeams ?? []).map(team => team.name), ...groups].join(" ").toLowerCase().includes(search.trim().toLowerCase());
  });
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "ops",
    teamIds: [] as string[],
    membershipStart: today
  });

  function openScopePanel(item: AdminUser) {
    setEditingUser(null);
    setResetUser(null);
    setScopeUser(item);
    setScopeIds(item.managedTeamIds ?? []);
  }
  function openEditPanel(item: AdminUser) {
    setScopeUser(null);
    setResetUser(null);
    setEditError("");
    const currentTeamIds = item.currentTeams?.length
      ? item.currentTeams.map((team) => team.id)
      : item.currentTeam?.id
        ? [item.currentTeam.id]
        : [];
    setEditingUser({
      id: item.id,
      role: item.role,
      initialUsername: item.username,
      initialDisplayName: item.displayName,
      initialTeamIds: [...currentTeamIds].sort(),
      username: item.username,
      displayName: item.displayName,
      teamIds: currentTeamIds,
      effectiveDate: today
    });
  }
  function openResetPanel(item: AdminUser) {
    setScopeUser(null);
    setEditingUser(null);
    setResetError("");
    setIssuedTempPassword(null);
    setResetUser({ id: item.id, username: item.username, displayName: item.displayName, temporaryPassword: "" });
  }

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
    <section className="admin-people">
      <nav className="admin-pills" aria-label="账号与小组">
        <button type="button" aria-pressed={tab === "users"} onClick={() => setTab("users")}>员工账号与权限 ({users.length})</button>
        <button type="button" aria-pressed={tab === "teams"} onClick={() => setTab("teams")}>客服小组管理 ({teams.length})</button>
      </nav>
      {tab === "teams" && <div className="card">
        <div className="commerce-line"><h2>小组</h2><button type="button" className="secondary" onClick={() => refresh().then(() => onError("")).catch((err) => onError(toErrorMessage(err)))}>刷新</button></div>
        <button type="button" onClick={() => setCreate("team")}>＋ 新增小组</button>
        {create === "team" && <AdminDialog title="新增小组" busy={teamPending} close={() => setCreate(null)}><form className="admin-team-form"
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
            setCreate(null);
            toast.success(`已新增小组「${name}」`);
            await refreshAfterSave();
          }}
        >
          <Field label="小组名称"><input required maxLength={64} value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
          <button type="submit" disabled={teamPending}>{teamPending ? "保存中…" : "新增小组"}</button>
          {teamError && <p className="action-error" role="alert">{teamError}</p>}
        </form></AdminDialog>}
        {loaded && !teams.length && <div className="empty-state"><strong>还没有小组</strong><p>先新增一个小组，再开通主管和登记微信。</p></div>}
        <p className="notice">已有员工或业务记录的小组可以改名，不能删除。</p>
        <ul className="admin-team-list">
          {teams.map((team) => {
            const editing = editingTeamId === team.id;
            const busy = teamBusyId === team.id;
            return (
              <li className="admin-team-row" key={team.id}>
                {editing ? (
                  <AdminDialog title="小组改名" busy={busy} close={() => setEditingTeamId("")}><form className="admin-team-edit" onSubmit={async (event) => {
                    event.preventDefault();
                    if (teamBusyId) return;
                    const name = editingTeamName.trim();
                    if (!name) { setTeamMessageId(team.id); setTeamRowError("请填写小组名称"); return; }
                    if (name === team.name) { setEditingTeamId(""); setTeamRowError(""); setTeamMessageId(""); return; }
                    setTeamBusyId(team.id); setTeamRowError(""); setTeamMessageId("");
                    try {
                      await api.updateTeam(team.id, { name });
                      toast.success("已把小组改名为「" + name + "」");
                      setEditingTeamId("");
                      await refreshAfterSave();
                    } catch (err) {
                      setTeamMessageId(team.id); fail("修改小组失败", err, setTeamRowError);
                    } finally {
                      setTeamBusyId("");
                    }
                  }}>
                    <input aria-label={"修改" + team.name} maxLength={64} value={editingTeamName} onChange={(event) => setEditingTeamName(event.target.value)} />
                    <div className="admin-team-actions">
                      <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存"}</button>
                      <button type="button" className="secondary" disabled={!!teamBusyId} onClick={() => { setEditingTeamId(""); setTeamRowError(""); setTeamMessageId(""); }}>取消</button>
                    </div>
                    {teamMessageId === team.id && teamRowError && <p className="action-error" role="alert">{teamRowError}</p>}
                  </form></AdminDialog>
                ) : (
                  <>
                    <strong>{team.name}</strong>
                    <div className="admin-team-actions">
                      <button type="button" className="secondary" disabled={!!teamBusyId} onClick={() => { setEditingTeamId(team.id); setEditingTeamName(team.name); setTeamRowError(""); setTeamMessageId(""); }}>修改</button>
                      <button type="button" className="danger" disabled={!!teamBusyId} onClick={async () => {
                        if (teamBusyId) return;
                        if (!window.confirm("确定删除小组「" + team.name + "」？删除后不能恢复。")) return;
                        setTeamBusyId(team.id); setTeamRowError(""); setTeamMessageId("");
                        try {
                          await api.deleteTeam(team.id);
                          toast.success("已删除小组「" + team.name + "」");
                          await refreshAfterSave();
                        } catch (err) {
                          setTeamMessageId(team.id); fail("删除小组失败", err, setTeamRowError);
                        } finally {
                          setTeamBusyId("");
                        }
                      }}>{busy ? "处理中…" : "删除"}</button>
                    </div>
                  </>
                )}
                {teamMessageId === team.id && teamRowError ? <p className="action-error" role="alert">{teamRowError}</p> : null}
              </li>
            );
          })}
        </ul>
      </div>}
      {tab === "users" && <div className="card">
        <div className="commerce-line"><h2>员工账号与权限</h2><button type="button" onClick={() => setCreate("user")}>＋ 开通员工账号</button></div>
        {scopeUser && <AdminDialog title="分配负责小组" busy={!!savingUser} close={() => setScopeUser(null)}><form className="review-card" onSubmit={async (e) => { e.preventDefault(); if (savingUser) return; const target = scopeUser; setSavingUser(target.id); try { await api.setSupervisorTeams(target.id, scopeIds); setScopeUser(null); onError(""); toast.success(`已保存 ${target.displayName} 的负责小组（${scopeIds.length} 个）`); await refreshAfterSave(); } catch (err) { fail(`${target.displayName} 负责小组未保存`, err); } finally { setSavingUser(""); } }}><h3>设置 {scopeUser.displayName} 的负责小组</h3><p className="notice">未勾选任何小组时，主管不能查看业务数据或登记客服接待账号。</p>{teams.map((team) => <label className="row" key={team.id}><input type="checkbox" checked={scopeIds.includes(team.id)} disabled={!!savingUser} onChange={(e) => setScopeIds(e.target.checked ? [...scopeIds,team.id] : scopeIds.filter((id) => id !== team.id))} />{team.name}</label>)}<div className="actions"><button disabled={!!savingUser}>{savingUser ? "保存中…" : "保存负责小组"}</button><button type="button" className="secondary" disabled={!!savingUser} onClick={() => setScopeUser(null)}>取消</button></div></form></AdminDialog>}
        <p className="notice">在这里开通员工登录账号、分配角色和主管负责小组。客服账号也可以由客服主管在「客服账号管理」里新增；首次登录改密由主管完成并保管。忘记密码时，仍在这里重置。WhatsApp、Messenger 接待账号的新增、持有人更换和登记码由本组客服主管管理。</p>

        {create === "user" && <AdminDialog title="开通员工账号" busy={userPending} close={() => setCreate(null)}><form
          onSubmit={async (event) => {
            event.preventDefault();
            if (userPending) return;
            const created = { name: form.displayName.trim() || form.username.trim(), role: roleLabel[form.role as keyof typeof roleLabel] ?? form.role };
            setUserPending(true); setUserError("");
            try {
              await api.createUser({
                username: form.username,
                displayName: form.displayName,
                password: form.password,
                role: form.role,
                membershipStart: form.membershipStart,
                teamIds: form.role === "cs_supervisor" ? [] : form.teamIds,
                managedTeamIds: form.role === "cs_supervisor" ? form.teamIds : []
              });
            } catch (err) {
              fail("开通账号失败", err, setUserError);
              return;
            } finally {
              setUserPending(false);
            }
            setCreate(null);
            setForm({ ...form, username: "", displayName: "", password: "", teamIds: [] });
            onError("");
            toast.success(`已开通账号：${created.name}（${created.role}）`);
            await refreshAfterSave();
          }}
        >
          <Field label="登录名"><input required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{2,31}" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="小写字母、数字、_-（3–32位）" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} /></Field>
          <Field label="姓名"><input required maxLength={64} value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="初始密码"><input required type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 位，含字母和数字" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="角色">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(roleLabel).filter(([key]) => key !== "assistant").map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="field-label">
            <span>所属/负责小组（可多选，不勾选则暂不分配）</span>
            <div className="actions" style={{ marginTop: 6, flexWrap: "wrap" }}>
              {teams.map((team) => (
                <label className="row" key={team.id} style={{ width: "auto", marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(team.id)}
                    disabled={userPending}
                    onChange={(e) => setForm({
                      ...form,
                      teamIds: e.target.checked
                        ? [...form.teamIds, team.id]
                        : form.teamIds.filter((id) => id !== team.id)
                    })}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={userPending}>{userPending ? "保存中…" : "开通账号"}</button>
          {userError && <p className="action-error" role="alert">{userError}</p>}
        </form></AdminDialog>}
        {editingUser && <AdminDialog title="修改信息" busy={!!savingUser} close={() => setEditingUser(null)}><form className="review-card" onSubmit={async event => {
          event.preventDefault();
          if (savingUser) return;
          const target = editingUser;
          const profileChanged = target.username !== target.initialUsername || target.displayName.trim() !== target.initialDisplayName;
          const sortedNextTeams = [...new Set(target.teamIds)].sort();
          const teamChanged = target.role !== "cs_supervisor" && JSON.stringify(sortedNextTeams) !== JSON.stringify(target.initialTeamIds);
          setSavingUser(target.id); setEditError("");
          let profileSaved = false;
          try {
            if (profileChanged || !teamChanged) {
              await api.updateUser(target.id, { username: target.username, displayName: target.displayName });
              profileSaved = profileChanged;
            }
            if (teamChanged) {
              await api.transferUser(target.id, {
                teamIds: sortedNextTeams,
                effectiveDate: target.effectiveDate || today
              });
            }
            setEditingUser(null); onError("");
            const summary = target.username !== target.initialUsername
              ? "账号信息已更新，下次登录请使用新登录名"
              : teamChanged
                ? (sortedNextTeams.length ? "账号信息与所属小组已更新" : "账号信息已更新，已移出原小组")
                : "账号信息已更新";
            toast.success(summary);
            await refreshAfterSave();
          } catch (error) {
            if (profileSaved) {
              setEditingUser(current => current && current.id === target.id
                ? { ...current, initialUsername: target.username, initialDisplayName: target.displayName.trim() }
                : current);
              await refreshAfterSave();
            }
            fail("账号信息未保存", error, setEditError);
          } finally {
            setSavingUser("");
          }
        }}>
          <h3>修改账号信息</h3>
          <label className="row field-label">姓名<input required maxLength={64} value={editingUser.displayName} disabled={!!savingUser} onChange={event => setEditingUser({ ...editingUser, displayName: event.target.value })} /></label>
          <label className="row field-label">登录名<input required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{2,31}" value={editingUser.username} disabled={!!savingUser} autoCapitalize="none" autoCorrect="off" onChange={event => setEditingUser({ ...editingUser, username: event.target.value.toLowerCase() })} /></label>
          {editingUser.role !== "cs_supervisor" && (
            <>
              <div className="field-label">
                <span>所属小组（可多选，支持同时归属多个小组）</span>
                {teams.map(team => (
                  <label className="row" key={team.id}>
                    <input
                      type="checkbox"
                      checked={editingUser.teamIds.includes(team.id)}
                      disabled={!!savingUser}
                      onChange={event => setEditingUser({
                        ...editingUser,
                        teamIds: event.target.checked
                          ? [...editingUser.teamIds, team.id]
                          : editingUser.teamIds.filter(id => id !== team.id)
                      })}
                    />
                    {team.name}
                  </label>
                ))}
              </div>
              {JSON.stringify([...new Set(editingUser.teamIds)].sort()) !== JSON.stringify(editingUser.initialTeamIds) && (
                <label className="row field-label">{editingUser.teamIds.length ? "小组生效日期" : "移出小组生效日期"}<input type="date" required value={editingUser.effectiveDate} disabled={!!savingUser} onChange={event => setEditingUser({ ...editingUser, effectiveDate: event.target.value })} /></label>
              )}
            </>
          )}
          <p className="notice">{editingUser.role === "cs_supervisor" ? "客服主管的负责小组请在列表中点「设置负责小组」维护。" : "修改登录名会要求员工重新登录；调整所属小组会保留生效日期前的历史归属与业务记录。"}</p>
          {editError && <p className="action-error" role="alert">{editError}</p>}
          <div className="actions"><button disabled={!!savingUser}>{savingUser ? "保存中…" : "保存修改"}</button><button className="secondary" type="button" disabled={!!savingUser} onClick={() => setEditingUser(null)}>取消</button></div>
        </form></AdminDialog>}
        {resetUser && <AdminDialog title="重置密码" busy={!!savingUser} close={() => setResetUser(null)}><form className="card" onSubmit={async event => {
          event.preventDefault();
          if (savingUser) return;
          setSavingUser(resetUser.id); setResetError("");
          try {
            const res = await api.resetUserPassword(resetUser.id, resetUser.temporaryPassword ? { temporaryPassword: resetUser.temporaryPassword } : { generate: true });
            if (res.temporaryPassword) {
              setIssuedTempPassword({ displayName: resetUser.displayName, username: resetUser.username, temporaryPassword: res.temporaryPassword });
            } else {
              setIssuedTempPassword(null);
            }
            toast.success(`已重置 ${resetUser.displayName} 的密码，已注销其全部登录会话`);
            setResetUser(null);
            await refreshAfterSave();
          } catch (err) {
            fail(`${resetUser.displayName} 重置密码失败`, err, setResetError);
          } finally { setSavingUser(""); }
        }}>
          <h3>重置员工密码 · {resetUser.displayName}（{resetUser.username}）</h3>
          <label className="row field-label">临时密码（留空则由系统生成随机临时密码）<input type="password" minLength={10} maxLength={128} autoComplete="new-password" value={resetUser.temporaryPassword} disabled={!!savingUser} placeholder="至少 10 位，含字母和数字；留空自动生成" onChange={event => setResetUser({ ...resetUser, temporaryPassword: event.target.value })} /></label>
          <p className="notice">重置后会立即注销该员工所有已登录会话，下次登录必须修改为新密码。</p>
          {resetError && <p className="action-error" role="alert">{resetError}</p>}
          <div className="actions">
            <button disabled={!!savingUser}>{savingUser ? "重置中…" : resetUser.temporaryPassword ? "确认重置" : "生成随机临时密码并重置"}</button>
            <button className="secondary" type="button" disabled={!!savingUser} onClick={() => setResetUser(null)}>取消</button>
          </div>
        </form></AdminDialog>}
        {issuedTempPassword && <AdminDialog title="一次性临时密码" close={() => setIssuedTempPassword(null)}><div role="status">
          <h3>临时密码（仅显示本次）</h3>
          <p>{issuedTempPassword.displayName}（<code>{issuedTempPassword.username}</code>）的临时密码：<code>{issuedTempPassword.temporaryPassword}</code></p>
          <p className="notice">请通过受信任渠道发给员工本人，首次登录后系统将强制修改密码。</p>
          <button type="button" className="secondary" onClick={() => setIssuedTempPassword(null)}>我已记录</button>
        </div></AdminDialog>}
        <div className="admin-pills" aria-label="按角色筛选">
          <button type="button" aria-pressed={!roleFilter} onClick={() => setRoleFilter("")}>全部</button>
          {Object.entries(roleLabel).filter(([role]) => role !== "assistant").map(([role, label]) => <button key={role} type="button" aria-pressed={roleFilter === role} onClick={() => setRoleFilter(role)}>{label}</button>)}
        </div>
        <Field label="搜索姓名、登录名或小组"><input type="search" value={search} onChange={event => setSearch(event.target.value)} /></Field>
        {loaded && !visibleUsers.length && <p className="empty-state">没有符合条件的账号。</p>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>姓名</th><th>登录名</th><th>角色</th><th>小组 / 管理范围</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              {visibleUsers.length === 0 ? (
                <tr><td colSpan={6} className="notice">{roleFilter ? "该角色暂无账号" : "暂无账号"}</td></tr>
              ) : visibleUsers.map((item) => (
                <tr key={item.id}>
                  <td data-label="姓名">{item.displayName}</td>
                  <td data-label="登录名">{item.username}</td>
                  <td data-label="角色"><select aria-label={`${item.username}角色`} disabled={!!savingUser} value={item.role} onChange={(e) => { const role = e.target.value; setConfirmation({ message: `将更改 ${item.displayName} 的角色及可访问的功能，确定继续？`, run: async () => { if (savingUser) return; setSavingUser(item.id); try { await api.updateUser(item.id, { role }); onError(""); toast.success(`已将 ${item.displayName} 的角色改为${roleLabel[role as keyof typeof roleLabel] ?? role}`); await refreshAfterSave(); } catch (err) { fail(`${item.displayName} 角色未修改`, err); } finally { setSavingUser(""); } }}); }}>{Object.entries(roleLabel).filter(([key]) => key !== "assistant" || item.role === "assistant").map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td data-label="小组 / 管理范围">{item.role === "cs_supervisor" ? <div className="admin-scope-cell"><p>{(item.managedTeamIds ?? []).map((id) => teams.find((team) => team.id === id)?.name || id).join("、") || <span className="admin-warning-badge">待分配负责小组</span>}</p><button className="secondary" type="button" disabled={!!savingUser} onClick={() => openScopePanel(item)}>设置负责小组</button></div> : <div className="admin-scope-cell"><p>{(item.currentTeams?.length ? item.currentTeams.map((t) => t.name).join("、") : item.currentTeam?.name) || "未分配"}</p><button className="secondary" type="button" disabled={!!savingUser} onClick={() => openEditPanel(item)}>调整小组</button></div>}</td>
                  <td data-label="状态"><button className="secondary" type="button" disabled={!!savingUser} onClick={() => setConfirmation({ message: item.isActive ? `停用后 ${item.displayName} 将无法登录。` : `启用后 ${item.displayName} 可按原有角色权限登录。`, run: async () => { if (savingUser) return; setSavingUser(item.id); try { await api.updateUser(item.id, { isActive: !item.isActive }); onError(""); toast.success(`已${item.isActive ? "停用" : "启用"}账号：${item.displayName}`); await refreshAfterSave(); } catch (err) { fail(`${item.displayName} ${item.isActive ? "停用" : "启用"}失败`, err); } finally { setSavingUser(""); } } })}>{savingUser === item.id ? "保存中…" : item.isActive ? "停用账号" : "启用账号"}</button></td>
                  <td data-label="操作"><div className="actions">
                    <button className="secondary" type="button" disabled={!!savingUser} onClick={() => openEditPanel(item)}>修改信息</button>
                    {item.id !== currentUserId && <>
                      <button className="secondary" type="button" disabled={!!savingUser} onClick={() => openResetPanel(item)}>重置密码</button>
                      <button className="secondary" type="button" disabled={!!savingUser} onClick={() => setConfirmation({ message: `将注销 ${item.displayName} 的全部登录会话，继续使用需重新登录。`, run: async () => {
                        setSavingUser(item.id);
                        try {
                          await api.revokeUserSessions(item.id);
                          onError("");
                          toast.success(`已强制下线：${item.displayName}`);
                        } catch (err) {
                          fail(`${item.displayName} 强制下线失败`, err);
                        } finally {
                          setSavingUser("");
                        }
                      } })}>强制下线</button>
                    </>}
                    {item.id !== currentUserId && item.role !== "admin" && (
                      <button type="button" className="danger" disabled={!!savingUser} onClick={() => setConfirmation({
                        message: `删除 ${item.displayName}（${item.username}）后，账号将从员工列表移除，所有会话会退出。历史业务数据会保留。`,
                        run: async () => {
                          if (savingUser) return;
                          setSavingUser(item.id);
                          try {
                            await api.deleteEmployeeAccount(item.id);
                            setUsers(current => current.filter(user => user.id !== item.id));
                            onError("");
                            toast.success(`已删除员工账号：${item.displayName}`);
                            await refreshAfterSave();
                          } catch (error) {
                            fail("删除员工账号失败", error);
                          } finally {
                            setSavingUser("");
                          }
                        }
                      })}>删除账号</button>
                    )}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>}
      {confirmation && <AdminDialog title="确认账号操作" center close={() => setConfirmation(null)}><p>{confirmation.message}</p><button type="button" onClick={() => {setConfirmation(null); confirmation.run();}}>确认</button></AdminDialog>}
    </section>
  );
}

function AdminDialog({title, children, close, busy, center}: {title: string; children: ReactNode; close: () => void; busy?: boolean; center?: boolean}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-label={title} className={center ? "admin-dialog admin-modal" : "admin-dialog admin-drawer"} onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <header className="commerce-line"><h2>{title}</h2><button className="secondary" type="button" disabled={busy} onClick={close}>{center ? "取消" : "关闭"}</button></header>
    {children}
  </dialog>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="row field-label">
      {label}
      {children}
    </label>
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
