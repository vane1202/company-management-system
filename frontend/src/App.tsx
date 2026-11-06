import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { canQueryByDate, isIsoDate } from "./dates";
import { labelOrderStatus } from "./labels";
import { createRequestGate } from "./requestGate";
import { readSessionMeta, type SessionMeta } from "./sessionMeta";
import {
  api,
  type AdminUser,
  type EditorReport,
  type FanReport,
  type FanSummary,
  type Metrics,
  type Note,
  type OpsReport,
  type Order,
  type Role,
  type Salary,
  type Team,
  type User
} from "./api";

type Page =
  | "home"
  | "fans"
  | "summary"
  | "orders"
  | "ops"
  | "editor"
  | "dashboard"
  | "people"
  | "salaries";

const roleLabel: Record<Role, string> = {
  boss: "Boss",
  admin: "行政",
  ops: "运营",
  editor: "拍剪",
  cs: "客服",
  cs_supervisor: "客服主管"
};

function navItems(role: Role): { id: Page; label: string }[] {
  const items: { id: Page; label: string }[] = [{ id: "home", label: "首页" }];
  if (role === "cs" || role === "cs_supervisor") items.push({ id: "fans", label: "加粉填报" });
  if (role === "cs_supervisor" || role === "boss" || role === "admin") items.push({ id: "summary", label: "加粉汇总" });
  if (role === "cs" || role === "boss" || role === "admin") items.push({ id: "orders", label: "订单" });
  if (role === "ops" || role === "boss" || role === "admin") items.push({ id: "ops", label: "推广" });
  if (role === "editor" || role === "boss" || role === "admin") items.push({ id: "editor", label: "拍剪" });
  if (role === "boss" || role === "admin") {
    items.push({ id: "dashboard", label: "经营估算" }, { id: "people", label: "编制" }, { id: "salaries", label: "工资" });
  }
  return items;
}

export function App() {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("home");
  const [error, setError] = useState("");
  const [today, setToday] = useState("");
  const [backfillDays, setBackfillDays] = useState(3);
  const [disclaimer, setDisclaimer] = useState("");

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
  if (!user) return <Login onLogin={hydrateUser} />;
  if (!today) return <div className="page">加载中…</div>;
  if (user.mustChangePassword) {
    return <ChangePassword user={user} onDone={() => setUser({ ...user, mustChangePassword: false })} />;
  }

  const items = navItems(user.role);
  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <b>内部管理系统</b>
          <span>
            {user.displayName} · {roleLabel[user.role]}
          </span>
        </div>
        <button
          className="secondary"
          onClick={async () => {
            await api.logout();
            await api.loadCsrf();
            setUser(null);
          }}
        >
          退出
        </button>
      </header>
      <nav className="nav">
        {items.map((item) => (
          <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {page === "home" && <Home user={user} today={today} backfillDays={backfillDays} disclaimer={disclaimer} />}
      {page === "fans" && <FanForm today={today} onError={setError} />}
      {page === "summary" && <FanSummaryPage today={today} onError={setError} />}
      {page === "orders" && <OrdersPage today={today} onError={setError} />}
      {page === "ops" && <OpsPage today={today} onError={setError} />}
      {page === "editor" && <EditorPage today={today} onError={setError} />}
      {page === "dashboard" && <DashboardPage onError={setError} />}
      {page === "people" && <PeoplePage today={today} onError={setError} />}
      {page === "salaries" && <SalaryPage onError={setError} />}
      <nav className="bottom-nav">
        {items.slice(0, 5).map((item) => (
          <button key={item.id} className={page === item.id ? "active" : ""} onClick={() => setPage(item.id)}>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (user: User, extras?: SessionMeta) => void | Promise<void> }) {
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
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <b>公司内部管理系统</b>
          <span>账号由行政开通，不能自行注册</span>
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
            setError(err instanceof Error ? err.message : "修改失败");
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
  disclaimer
}: {
  user: User;
  today: string;
  backfillDays: number;
  disclaimer: string;
}) {
  return (
    <section className="card">
      <h2>今日 {today || "—"}</h2>
      <p className="notice">业务日按东八区计算。客服加粉入口可放进微信群公告，每天打开同一链接即可，系统不会自动往群里发消息。</p>
      {user.role === "cs" && <p className="notice">你只能填报并查看自己的加粉与订单。补报窗口为近 {backfillDays} 个业务日（含今天）。填写 0 表示当天已报零粉，未提交则是未报。</p>}
      {user.role === "cs_supervisor" && <p className="notice">你可以查看负责小组的加粉汇总、未报名单和逐人明细，不能查看工资或客户消费。</p>}
      {(user.role === "boss" || user.role === "admin") && <p className="notice">{disclaimer}</p>}
    </section>
  );
}

function FanForm({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [addedCount, setAddedCount] = useState("0");
  const [businessDate, setBusinessDate] = useState(today);
  const [reports, setReports] = useState<FanReport[]>([]);
  const [message, setMessage] = useState("");

  async function refresh() {
    const data = await api.myFanReports();
    setReports(data.reports);
  }
  useEffect(() => {
    if (isIsoDate(today)) setBusinessDate(today);
  }, [today]);
  useEffect(() => {
    refresh().catch((err) => onError(err.message));
  }, []);

  return (
    <section className="card">
      <h2>每日加粉</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            const result = await api.saveFanReport({
              addedCount: Number(addedCount),
              businessDate
            });
            setMessage(result.revised ? "已覆盖更新并留痕，不会累加。" : "已保存。");
            onError("");
            await refresh();
          } catch (err) {
            onError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <div className="grid two">
          <div className="row">
            <label>业务日</label>
            <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
          </div>
          <div className="row">
            <label>加粉人数（可填 0）</label>
            <input inputMode="numeric" value={addedCount} onChange={(e) => setAddedCount(e.target.value)} />
          </div>
        </div>
        <button type="submit">提交</button>
        {message && <p className="ok">{message}</p>}
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>日期</th><th>加粉数</th></tr>
          </thead>
          <tbody>
            {reports.map((item) => (
              <tr key={item.id}>
                <td>{item.businessDate}</td>
                <td>{item.addedCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FanSummaryPage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [date, setDate] = useState(today);
  const [teams, setTeams] = useState<FanSummary[]>([]);
  const gate = useState(() => createRequestGate())[0];

  async function load(next = date) {
    if (!canQueryByDate(next)) return;
    const ticket = gate.next();
    try {
      const data = await api.fanSummary(next);
      if (!ticket.isCurrent()) return;
      setTeams(data.teams);
      onError("");
    } catch (err) {
      if (!ticket.isCurrent()) return;
      onError(err instanceof Error ? err.message : "加载失败");
    }
  }
  useEffect(() => {
    if (isIsoDate(today)) setDate(today);
  }, [today]);
  useEffect(() => {
    if (canQueryByDate(date)) load(date);
  }, [date]);

  return (
    <section className="card">
      <h2>加粉日报汇总</h2>
      <div className="actions" style={{ marginBottom: 12 }}>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" onClick={() => load(date)}>查询</button>
        <a className="btn secondary" href={api.fanExportUrl(date)}>导出 CSV</a>
      </div>
      {teams.map((team) => (
        <div key={team.teamId} className="card">
          <h3>{team.teamName}</h3>
          <div className="metrics">
            <div className="metric"><b>{team.totalAdded}</b><span>加粉总数</span></div>
            <div className="metric"><b>{team.expectedCount}</b><span>应报</span></div>
            <div className="metric"><b>{team.reportedCount}</b><span>已报</span></div>
            <div className="metric"><b>{team.missingCount}</b><span>未报</span></div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>姓名</th><th>人数</th><th>状态</th></tr>
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

function OrdersPage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [form, setForm] = useState({
    businessDate: today,
    orderRef: "",
    customerLabel: "",
    amount: "0.00",
    status: "placed",
    isCustom: false,
    customProductCost: "0.00",
    laborCost: "0.00",
    shippingCost: "0.00"
  });

  async function refresh() {
    setOrders((await api.orders()).orders);
  }
  useEffect(() => {
    if (isIsoDate(today)) setForm((current) => ({ ...current, businessDate: current.businessDate || today }));
  }, [today]);
  useEffect(() => {
    refresh().catch((err) => onError(err.message));
  }, []);

  return (
    <section className="card">
      <h2>客户消费订单</h2>
      <p className="notice">填写订单标识即可去重，客户备注用昵称或内部编号，不要把手机号当必填项。</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.createOrder({ ...form, isCustom: form.isCustom });
            onError("");
            setForm({ ...form, orderRef: "", customerLabel: "" });
            await refresh();
          } catch (err) {
            onError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <div className="grid two">
          <Field label="业务日"><input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></Field>
          <Field label="订单标识"><input value={form.orderRef} onChange={(e) => setForm({ ...form, orderRef: e.target.value })} /></Field>
          <Field label="客户备注（可选）"><input value={form.customerLabel} onChange={(e) => setForm({ ...form, customerLabel: e.target.value })} /></Field>
          <Field label="消费金额"><input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field>
          <Field label="状态">
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="placed">下单</option>
              <option value="in_production">制作中</option>
              <option value="shipped">已发货</option>
              <option value="refunded">退款</option>
            </select>
          </Field>
          <Field label="定制商品">
            <select value={form.isCustom ? "1" : "0"} onChange={(e) => setForm({ ...form, isCustom: e.target.value === "1" })}>
              <option value="0">否</option>
              <option value="1">是</option>
            </select>
          </Field>
          <Field label="定制商品成本"><input value={form.customProductCost} onChange={(e) => setForm({ ...form, customProductCost: e.target.value })} /></Field>
          <Field label="工费"><input value={form.laborCost} onChange={(e) => setForm({ ...form, laborCost: e.target.value })} /></Field>
          <Field label="运费"><input value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} /></Field>
        </div>
        <button type="submit">录入订单</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>日期</th><th>标识</th><th>金额</th><th>状态</th><th>成本/工费/运费</th></tr>
          </thead>
          <tbody>
            {orders.map((item) => (
              <tr key={item.id}>
                <td>{item.businessDate}</td>
                <td>{item.orderRef}</td>
                <td>{item.amount}</td>
                <td>{labelOrderStatus(item.status)}</td>
                <td>{item.customProductCost} / {item.laborCost} / {item.shippingCost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OpsPage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [reports, setReports] = useState<OpsReport[]>([]);
  const [form, setForm] = useState({ businessDate: today, platform: "", promoVideoCount: "0", promoCost: "0.00", note: "" });
  useEffect(() => {
    if (isIsoDate(today)) setForm((current) => ({ ...current, businessDate: current.businessDate || today }));
  }, [today]);
  useEffect(() => {
    api.opsReports().then((data) => setReports(data.reports)).catch((err) => onError(err.message));
  }, []);
  return (
    <section className="card">
      <h2>推广日报</h2>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.saveOps({
              ...form,
              promoVideoCount: Number(form.promoVideoCount)
            });
            setReports((await api.opsReports()).reports);
            onError("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <div className="grid two">
          <Field label="业务日"><input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></Field>
          <Field label="平台/账号（可选）"><input value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })} /></Field>
          <Field label="推广视频数"><input value={form.promoVideoCount} onChange={(e) => setForm({ ...form, promoVideoCount: e.target.value })} /></Field>
          <Field label="推广费用"><input value={form.promoCost} onChange={(e) => setForm({ ...form, promoCost: e.target.value })} /></Field>
        </div>
        <Field label="备注"><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        <button type="submit">保存</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>平台</th><th>视频数</th><th>费用</th></tr></thead>
          <tbody>
            {reports.map((item) => (
              <tr key={item.id}><td>{item.businessDate}</td><td>{item.platform || "—"}</td><td>{item.promoVideoCount}</td><td>{item.promoCost}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EditorPage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [reports, setReports] = useState<EditorReport[]>([]);
  const [summary, setSummary] = useState("");
  const [form, setForm] = useState({
    businessDate: today,
    shootCount: "0",
    finishedCount: "0",
    publishedCount: "0",
    inventorySnapshot: "0"
  });
  async function refresh() {
    setReports((await api.editorReports()).reports);
    const result = await api.editorSummary();
    setSummary(`区间拍摄 ${result.shootCount}，成片 ${result.finishedCount}，已发布 ${result.publishedCount}，期末囤量 ${result.endingInventory}。${result.note}`);
  }
  useEffect(() => {
    if (isIsoDate(today)) setForm((current) => ({ ...current, businessDate: current.businessDate || today }));
  }, [today]);
  useEffect(() => {
    refresh().catch((err) => onError(err.message));
  }, []);
  return (
    <section className="card">
      <h2>拍剪日报</h2>
      <p className="notice">{summary}</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.saveEditor({
              ...form,
              shootCount: Number(form.shootCount),
              finishedCount: Number(form.finishedCount),
              publishedCount: Number(form.publishedCount),
              inventorySnapshot: Number(form.inventorySnapshot)
            });
            await refresh();
            onError("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <div className="grid two">
          <Field label="业务日"><input type="date" value={form.businessDate} onChange={(e) => setForm({ ...form, businessDate: e.target.value })} /></Field>
          <Field label="拍摄数"><input value={form.shootCount} onChange={(e) => setForm({ ...form, shootCount: e.target.value })} /></Field>
          <Field label="成片数"><input value={form.finishedCount} onChange={(e) => setForm({ ...form, finishedCount: e.target.value })} /></Field>
          <Field label="已发布数"><input value={form.publishedCount} onChange={(e) => setForm({ ...form, publishedCount: e.target.value })} /></Field>
          <Field label="当日囤量快照"><input value={form.inventorySnapshot} onChange={(e) => setForm({ ...form, inventorySnapshot: e.target.value })} /></Field>
        </div>
        <button type="submit">保存</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>拍摄</th><th>成片</th><th>发布</th><th>囤量快照</th></tr></thead>
          <tbody>
            {reports.map((item) => (
              <tr key={item.id}>
                <td>{item.businessDate}</td>
                <td>{item.shootCount}</td>
                <td>{item.finishedCount}</td>
                <td>{item.publishedCount}</td>
                <td>{item.inventorySnapshot}{item.inventoryAdjusted ? "（已校正）" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DashboardPage({ onError }: { onError: (value: string) => void }) {
  const [preset, setPreset] = useState("day");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [meta, setMeta] = useState({ disclaimer: "", formula: "", from: "", to: "" });
  const [notes, setNotes] = useState<Note[]>([]);
  const [note, setNote] = useState("");
  const gate = useState(() => createRequestGate())[0];

  async function load(next = preset) {
    const ticket = gate.next();
    try {
      const data = await api.dashboard(next);
      if (!ticket.isCurrent()) return;
      setMetrics(data.metrics);
      setMeta({ disclaimer: data.disclaimer, formula: data.formula, from: data.period.from, to: data.period.to });
      const notesData = await api.notes(data.period.to);
      if (!ticket.isCurrent()) return;
      setNotes(notesData.notes);
      onError("");
    } catch (err) {
      if (!ticket.isCurrent()) return;
      onError(err instanceof Error ? err.message : "加载失败");
    }
  }
  useEffect(() => {
    load("day");
  }, []);

  if (!metrics) return <section className="card">加载经营估算…</section>;
  return (
    <section className="card">
      <h2>经营估算</h2>
      <div className="actions" style={{ marginBottom: 12 }}>
        {["day", "week", "month"].map((item) => (
          <button key={item} className={preset === item ? "" : "secondary"} type="button" onClick={() => { setPreset(item); load(item); }}>
            {item === "day" ? "今日" : item === "week" ? "本周" : "本月"}
          </button>
        ))}
      </div>
      <p className="notice">{meta.from} 至 {meta.to} · {meta.formula}</p>
      <div className="metrics">
        <div className="metric"><b>{metrics.estimate}</b><span>经营估算</span></div>
        <div className="metric"><b>{metrics.revenue}</b><span>收入</span></div>
        <div className="metric"><b>{metrics.refunds}</b><span>退款</span></div>
        <div className="metric"><b>{metrics.promoCost}</b><span>推广费</span></div>
        <div className="metric"><b>{metrics.salaryAllocated}</b><span>工资分摊</span></div>
        <div className="metric"><b>{metrics.customProductCost}</b><span>定制成本</span></div>
        <div className="metric"><b>{metrics.laborCost}</b><span>工费</span></div>
        <div className="metric"><b>{metrics.shippingCost}</b><span>运费</span></div>
        <div className="metric"><b>{metrics.endingInventory}</b><span>期末囤量</span></div>
        <div className="metric"><b>{metrics.fanAddedTotal}</b><span>加粉合计</span></div>
      </div>
      <p className="notice">{meta.disclaimer}</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          await api.createNote({ targetDate: meta.to, content: note, targetType: "day" });
          setNote("");
          await load(preset);
        }}
      >
        <Field label="批注">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <button type="submit">写下批注</button>
      </form>
      {notes.map((item) => (
        <p key={item.id} className="notice">{item.authorName}：{item.content}</p>
      ))}
    </section>
  );
}

function PeoplePage({ today, onError }: { today: string; onError: (value: string) => void }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [teamName, setTeamName] = useState("");
  const [form, setForm] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "cs",
    teamId: "",
    membershipStart: today
  });

  async function refresh() {
    setTeams((await api.teams()).teams);
    setUsers((await api.users()).users);
  }
  useEffect(() => {
    if (isIsoDate(today)) setForm((current) => ({ ...current, membershipStart: current.membershipStart || today }));
  }, [today]);
  useEffect(() => {
    refresh().catch((err) => onError(err.message));
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
        <h2>员工账号</h2>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            try {
              await api.createUser({ ...form, managedTeamIds: form.role === "cs_supervisor" && form.teamId ? [form.teamId] : [] });
              setForm({ ...form, username: "", displayName: "", password: "" });
              await refresh();
              onError("");
            } catch (err) {
              onError(err instanceof Error ? err.message : "创建失败");
            }
          }}
        >
          <Field label="登录名"><input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="姓名"><input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} /></Field>
          <Field label="初始密码"><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="角色">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(roleLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
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
            <thead><tr><th>姓名</th><th>登录名</th><th>角色</th><th>小组</th></tr></thead>
            <tbody>
              {users.map((item) => (
                <tr key={item.id}>
                  <td>{item.displayName}</td>
                  <td>{item.username}</td>
                  <td>{roleLabel[item.role]}</td>
                  <td>{item.currentTeam?.name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SalaryPage({ onError }: { onError: (value: string) => void }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [salaries, setSalaries] = useState<Salary[]>([]);
  const [form, setForm] = useState({ userId: "", monthlyAmount: "0.00", effectiveFrom: "", effectiveTo: "" });
  useEffect(() => {
    Promise.all([api.users(), api.salaries()]).then(([people, pay]) => {
      setUsers(people.users);
      setSalaries(pay.salaries);
    }).catch((err) => onError(err.message));
  }, []);
  return (
    <section className="card">
      <h2>岗位基本工资</h2>
      <p className="notice">按生效区间维护月薪，系统按当月天数分摊到每一天，不需要每天重复录入。</p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await api.createSalary({
              userId: form.userId,
              monthlyAmount: form.monthlyAmount,
              effectiveFrom: form.effectiveFrom,
              effectiveTo: form.effectiveTo || null
            });
            setSalaries((await api.salaries()).salaries);
            onError("");
          } catch (err) {
            onError(err instanceof Error ? err.message : "保存失败");
          }
        }}
      >
        <div className="grid two">
          <Field label="员工">
            <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
              <option value="">请选择</option>
              {users.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </select>
          </Field>
          <Field label="月基本工资"><input value={form.monthlyAmount} onChange={(e) => setForm({ ...form, monthlyAmount: e.target.value })} /></Field>
          <Field label="生效开始日"><input type="date" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} /></Field>
          <Field label="生效结束日（可空）"><input type="date" value={form.effectiveTo} onChange={(e) => setForm({ ...form, effectiveTo: e.target.value })} /></Field>
        </div>
        <button type="submit">保存工资</button>
      </form>
      <div className="table-wrap">
        <table>
          <thead><tr><th>员工</th><th>月薪</th><th>开始</th><th>结束</th></tr></thead>
          <tbody>
            {salaries.map((item) => (
              <tr key={item.id}>
                <td>{item.displayName}</td>
                <td>{item.monthlyAmount}</td>
                <td>{item.effectiveFrom}</td>
                <td>{item.effectiveTo ?? "长期"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
