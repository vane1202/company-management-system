import { SalaryWorkspace } from "./SalaryWorkspace";
import { OrderWorkspace } from "./OrderWorkspace";
import { FinanceWorkspace } from "./FinanceWorkspace";
import { DailyForm } from "./DailyForms";
import { detailLines } from "./dailyDetail";
import { ModuleSettings } from "./ModuleSettings";
import { SystemSettings } from "./SystemSettings";
import { DashboardHome } from "./DashboardHome";
import { AdminHome, SupervisorHome } from "./RoleHomes";
import { DashboardIcon } from "./DashboardIcon";
import { CsDeviceRegistration } from "./CsDeviceRegistration";
import { CsAccountsPage } from "./CsAccountsPage";
import { fillEntries, fillEntryFromPath, canUseFillEntry } from "./fillEntries";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { canQueryByDate, isIsoDate } from "./dates";
import { labelOrderStatus } from "./labels";
import { navItems, roleLabel, type Page } from "./access";
import { createRequestGate } from "./requestGate";
import { toErrorMessage } from "./errors";
import { readSessionMeta, type SessionMeta } from "./sessionMeta";
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

export function App() {
  const [modules, setModules] = useState<Record<string, boolean> | null>(null);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>(() => fillEntryFromPath(window.location.pathname) ?? "home");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [error, setError] = useState("");
  const [today, setToday] = useState("");
  const [backfillDays, setBackfillDays] = useState(3);
  const [disclaimer, setDisclaimer] = useState("");
  const entry = fillEntryFromPath(window.location.pathname);

  useEffect(() => {
    const onPopState = () => { setError(""); setPage(fillEntryFromPath(window.location.pathname) ?? "home"); };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
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

  if (!ready) return <div className="page">加载中…</div>;
  if (!user) return <Login onLogin={hydrateUser} entry={entry} />;
  if (!today) return <div className="page">加载中…</div>;
  if (user.mustChangePassword) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, mustChangePassword: false })} />;
  }

  if (entry && !canUseFillEntry(user.role, entry)) {
    return <section className="page"><div className="card"><h2>{fillEntries[entry].title}</h2>
      <p>此入口用于客服本人填报。当前登录身份为{roleLabel[user.role]}，请使用相应的客服账号。</p>
      <a className="btn secondary" href="/">返回管理首页</a>
      <button type="button" onClick={async () => { await api.logout(); setUser(null); setModules(null); }}>退出并切换账号</button>
    </div></section>;
  }
  if (entry && !modules) return <div className="page"><p>正在确认填报入口…</p>{error && <p className="error">{error}</p>}<button type="button" onClick={() => api.modules().then((data) => { setModules(data.modules); setError(""); }).catch((err) => setError(toErrorMessage(err)))}>重新加载</button></div>;
  if (entry && modules?.[entry] === false) return <section className="page"><div className="card"><h2>{fillEntries[entry].title}已停用</h2><p>请联系管理员重新启用，历史数据仍保留。</p><a className="btn secondary" href="/">返回首页</a></div></section>;

  const managementRole = ["boss", "admin", "cs_supervisor", "finance"].includes(user.role);
  const items = navItems(user.role).filter((item) => managementRole || !["fans", "orders", "ops", "editor"].includes(item.id) || modules?.[item.id] === true);
  const activePage = items.some((item) => item.id === page) ? page : "home";
  function goTo(next: Page) {
    setError("");
    setMobileNavOpen(false);
    setPage(next);
    const nextPath = (next === "fans" || next === "orders") && canUseFillEntry(user!.role, next) ? fillEntries[next].path : "/";
    if (window.location.pathname !== nextPath) window.history.pushState(null, "", nextPath);
  }
  async function logout() {
    await api.logout();
    await api.loadCsrf();
    setError(""); setMobileNavOpen(false); setUser(null); setModules(null);
  }
  return (
    <div className={`page app-shell ${managementRole ? "management-shell" : ""} ${user.role === "boss" ? "boss-shell" : ""}`}>
      <a className="skip-link" href="#main-content">跳到主要内容</a>
      <aside className={`app-sidebar ${mobileNavOpen ? "mobile-nav-open" : ""}`}>
        <div className="sidebar-brand-row"><a href="/" className="sidebar-brand"><span className="sidebar-brand-mark"><DashboardIcon name="home" /></span><span><b>内部管理系统</b><small>公司日常工作台</small></span></a>{managementRole && <button type="button" className="mobile-menu-toggle secondary" aria-expanded={mobileNavOpen} aria-controls="workspace-navigation" onClick={() => setMobileNavOpen(open => !open)}>{mobileNavOpen ? "收起菜单" : "全部菜单"}</button>}</div>
        <span className="nav-section-label">工作空间</span>
        <nav id="workspace-navigation" className="nav" aria-label="主要导航">
          {items.map((item) => <button key={item.id} aria-current={activePage === item.id ? "page" : undefined} className={activePage === item.id ? "active" : ""} onClick={() => goTo(item.id)}><DashboardIcon name={item.id} /><span>{item.label}</span></button>)}
          {managementRole && <button type="button" className="mobile-menu-logout" onClick={logout}>退出登录</button>}
        </nav>
        <div className="sidebar-footer"><span className="sidebar-avatar">{user.displayName.slice(0, 1)}</span><span><strong>{user.displayName}</strong><small>{roleLabel[user.role]} · 数据按权限展示</small></span></div>
      </aside>
      <div className="app-main">
      <header className="topbar app-toolbar">
        <div className="toolbar-breadcrumb">工作台 <span>/</span> <strong>{items.find((item) => item.id === activePage)?.label}</strong></div>
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
      {error && <p className="error">{error}</p>}
      {user.accountKind === "cs_wechat" && <p className="notice">当前填报微信：<strong>{user.wechatId}</strong>{user.phoneLabel ? `（${user.phoneLabel}）` : ""}。加粉与订单长期归属于此微信号；退出后需管理员重新发码。</p>}
      {activePage === "home" && <Home user={user} today={today} backfillDays={backfillDays} disclaimer={disclaimer} onNavigate={goTo} />}
      {activePage === "fans" && <FanForm today={today} onError={setError} />}
      {activePage === "summary" && <FanSummaryPage today={today} onError={setError} />}
      {activePage === "orders" && <OrderWorkspace today={today} user={user} />}
      {activePage === "ops" && <OpsPage today={today} onError={setError} readOnly={user.role === "boss"} />}
      {activePage === "editor" && <EditorPage today={today} onError={setError} readOnly={user.role === "boss"} />}
      {activePage === "dashboard" && <DashboardPage onError={setError} />}
      {activePage === "modules" && <><ModuleSettings onError={setError} onChange={setModules} /><SystemSettings defaultDays={backfillDays} /></>}
      {activePage === "people" && <PeoplePage today={today} onError={setError} />}
      {activePage === "csAccounts" && <CsAccountsPage supervisor={user.role === "cs_supervisor"} />}
      {activePage === "finance" && <FinanceWorkspace today={today} readOnly />}
      {activePage === "salaries" && <SalaryWorkspace today={today} readOnly={user.role !== "finance"} />}
      </main>
      </div>
      <nav className="bottom-nav" aria-label="底部导航">
        {items.slice(0, 5).map((item) => (
          <button key={item.id} aria-current={activePage === item.id ? "page" : undefined} className={activePage === item.id ? "active" : ""} onClick={() => goTo(item.id)}>
            {item.id === "csAccounts" ? "客服微信" : item.label}
          </button>
        ))}
      </nav>
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
        {entry && <button type="button" className="secondary" onClick={() => setEmployeeLogin(false)}>返回客服微信登记</button>}
      </form>
    </div>
  );
}

function ChangePassword({ user, onDone }: { user: User; onDone: () => void }) {
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login-wrap">
      <form
        className="card login-card"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.changePassword(currentPassword, newPassword);
            onDone();
          } catch (err) {
            setError(toErrorMessage(err, "修改失败"));
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
        <button type="submit">保存新密码</button>
      </form>
    </div>
  );
}

function Home({
  user,
  today,
  backfillDays,
  disclaimer,
  onNavigate
}: {
  user: User;
  today: string;
  backfillDays: number;
  disclaimer: string;
  onNavigate: (page: Page) => void;
}) {
  if (user.role === "finance") return <FinanceWorkspace today={today} />;
  if (user.role === "boss") return <DashboardHome today={today} onNavigate={onNavigate} />;
  if (user.role === "admin") return <AdminHome onNavigate={onNavigate} />;
  if (user.role === "cs_supervisor") return <SupervisorHome today={today} onNavigate={onNavigate} />;
  return (
    <section className="card">
      <h2>今日 {today || "—"}</h2>
      <p className="notice">业务日按东八区计算。客服加粉入口可放进微信群公告，每天打开同一链接即可，系统不会自动往群里发消息。</p>
      {user.role === "cs" && <p className="notice">你只能填报并查看自己的加粉与订单。补报窗口为近 {backfillDays} 个业务日（含今天）。填写 0 表示当天已报零粉，未提交则是未报。</p>}
      {user.role === "assistant" && <p className="notice">原助理流程已停用，请由后台管理员调整账号角色。</p>}
    </section>
  );
}

function FanForm({ today, onError }: { today: string; onError: (value: string) => void }) {
  return <DailyForm kind="fan_report" today={today} onError={onError} />;
}

function FanSummaryPage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [date, setDate] = useState(today);
  const [accounts, setAccounts] = useState<CsAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [teams, setTeams] = useState<FanSummary[]>([]);
  const gate = useState(() => createRequestGate())[0];

  async function load(next = date) {
    if (!canQueryByDate(next)) return;
    const ticket = gate.next();
    try {
      const [data, choices] = await Promise.all([api.fanSummary(next, undefined, accountId), api.csAccounts(next)]);
      if (!ticket.isCurrent()) return;
      setTeams(data.teams);
      setAccounts(choices.accounts);
      onError("");
    } catch (err) {
      if (!ticket.isCurrent()) return;
      onError(toErrorMessage(err, "加载失败"));
    }
  }
  useEffect(() => {
    if (isIsoDate(today)) setDate(today);
  }, [today]);
  useEffect(() => {
    if (canQueryByDate(date)) load(date);
  }, [date, accountId]);

  return (
    <section className="card">
      <h2>加粉日报汇总</h2>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input aria-label="汇总业务日" type="date" value={date} onChange={(e) => { setDate(e.target.value); setAccountId(""); }} />
        <select aria-label="按客服微信号筛选加粉" value={accountId} onChange={(e) => setAccountId(e.target.value)}><option value="">全部客服微信及原员工账号</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.wechatId}{account.phoneLabel ? ` · ${account.phoneLabel}` : ""}</option>)}</select>
        <button type="button" onClick={() => load(date)}>查询</button>
        <a className="btn secondary" href={api.fanExportUrl(date, accountId)}>导出 CSV</a>
      </div>
      {teams.map((team) => (
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
                <tr><th>客服微信 / 原账号</th><th>加粉数</th><th>填报</th></tr>
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
    </section>
  );
}

function OpsPage({ today, onError, readOnly }: { today: string; onError: (value: string) => void; readOnly?: boolean }) {
  return <DailyForm kind="ops_report" today={today} onError={onError} readOnly={readOnly} />;
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
  const [teamName, setTeamName] = useState("");
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
    setUsers((await api.users()).users.filter((item) => item.accountKind !== "cs_wechat"));
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
        <h2>小组</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            await api.createTeam({ name: teamName });
            setTeamName("");
            await refresh();
          }}
        >
          <Field label="小组名称"><input value={teamName} onChange={(e) => setTeamName(e.target.value)} /></Field>
          <button type="submit">新增小组</button>
        </form>
        <ul>
          {teams.map((team) => <li key={team.id}>{team.name}</li>)}
        </ul>
      </div>
      <div className="card">
        <h2>员工账号与权限</h2>
        {scopeUser && <form className="review-card" onSubmit={async (e) => { e.preventDefault(); setSavingUser(scopeUser.id); try { await api.setSupervisorTeams(scopeUser.id, scopeIds); setScopeUser(null); await refresh(); onError(""); } catch (err) { onError(toErrorMessage(err)); } finally { setSavingUser(""); } }}><h3>设置 {scopeUser.displayName} 的负责小组</h3><p className="notice">未勾选任何小组时，主管不能查看业务数据或登记客服微信。</p>{teams.map((team) => <label className="row" key={team.id}><input type="checkbox" checked={scopeIds.includes(team.id)} onChange={(e) => setScopeIds(e.target.checked ? [...scopeIds,team.id] : scopeIds.filter((id) => id !== team.id))} />{team.name}</label>)}<div className="actions"><button disabled={!!savingUser}>保存负责小组</button><button type="button" className="secondary" onClick={() => setScopeUser(null)}>取消</button></div></form>}
        <p className="notice">管理、运营、拍剪等人员在这里开通。固定客服手机请到“客服微信号”发放登记码，无需为每位轮班客服创建员工账号。</p>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api.createUser({ ...form, managedTeamIds: form.role === "cs_supervisor" && form.teamId ? [form.teamId] : [] });
              setForm({ ...form, username: "", displayName: "", password: "" });
              await refresh();
              onError("");
            } catch (err) {
              onError(toErrorMessage(err, "创建失败"));
            }
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
          <button type="submit">开通账号</button>
        </form>
        <div className="table-wrap">
          <table>
            <thead><tr><th>姓名</th><th>登录名</th><th>角色</th><th>小组 / 管理范围</th><th>状态</th></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.displayName}</td>
                  <td>{item.username}</td>
                  <td><select aria-label={`${item.username}角色`} disabled={savingUser === item.id} value={item.role} onChange={async (e) => { setSavingUser(item.id); try { await api.updateUser(item.id, { role: e.target.value }); await refresh(); onError(""); } catch (err) { onError(toErrorMessage(err)); } finally { setSavingUser(""); } }}>{Object.entries(roleLabel).filter(([key]) => key !== "assistant" || item.role === "assistant").map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                  <td>{item.role === "cs_supervisor" ? <><p>{(item.managedTeamIds ?? []).map((id) => teams.find((team) => team.id === id)?.name || id).join("、") || "暂未分配小组"}</p><button className="secondary" type="button" onClick={() => { setScopeUser(item); setScopeIds(item.managedTeamIds ?? []); }}>设置负责小组</button></> : item.currentTeam?.name ?? "—"}</td>
                  <td><button className="secondary" type="button" disabled={savingUser === item.id} onClick={async () => { setSavingUser(item.id); try { await api.updateUser(item.id, { isActive: !item.isActive }); await refresh(); } catch (err) { onError(toErrorMessage(err)); } finally { setSavingUser(""); } }}>{item.isActive ? "停用账号" : "启用账号"}</button></td>
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
    {team.details.map((member) => <article className="review-card" key={member.userId}><strong>{member.wechatId || member.displayName}</strong><span className="chip">{member.accountKind === "cs_wechat" ? "客服微信" : "原员工账号"}</span>
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
