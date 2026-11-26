import ReimbursementWorkspace from "./demo/ReimbursementWorkspace";
import { useEffect, useState } from "react";
import { api, type CsAccount, type Order, type User } from "./api";
import { cents, money } from "./commerceUi";
import { yuan } from "./dashboardDisplay";
import { csFillPageFromPath, csFillPageIds, csFillPages, type CsFillPage } from "./fillEntries";
import { DashboardIcon } from "./DashboardIcon";
import { dashboardPresetRange } from "./dates";
import { toErrorMessage } from "./errors";
import { labelOrderStatus } from "./labels";
import { LeadWorkspace } from "./LeadWorkspace";
import { Field, OrderWorkspace } from "./OrderWorkspace";
import { PeriodToolbar, type StandardPreset } from "./PeriodToolbar";
import { RequestCsBinding } from "./CsBindingControls";
import { isServiceAccount } from "./serviceAccounts";
import "./demo/customer-fill.css";
import "./fill-ui.css";
import "./demo/role-workbenches.css";

export function CsWorkbench({
  today,
  user,
  onLogout,
  onDeviceActivated
}: {
  today: string;
  user: User;
  onLogout: () => void;
  onDeviceActivated: (user: User) => void | Promise<void>;
}) {
  const isEmployeeAccount = !isServiceAccount(user.accountKind);
  const [page, setPage] = useState<CsFillPage>(() => csFillPageFromPath(window.location.pathname, isEmployeeAccount));
  const [accounts, setAccounts] = useState<CsAccount[]>([]);
  const [accountId, setAccountId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [accountError, setAccountError] = useState("");
  const [quickCreate,setQuickCreate]=useState(false);
  const [customerName,setCustomerName]=useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");

  useEffect(() => {
    let active = true;
    setLoadingAccounts(isEmployeeAccount);
    setAccounts([]);
    setAccountId("");
    setAccountError("");
    if (isEmployeeAccount) api
      .csAccounts()
      .then(data => {
        if (!active) return;
        setAccounts(data.accounts.filter(item => item.isActive));
        setAccountError("");
      })
      .catch(cause => {
        if (active) setAccountError(toErrorMessage(cause));
      })
      .finally(() => {
        if (active) setLoadingAccounts(false);
      });
    const onPop = () => {
      setPage(csFillPageFromPath(window.location.pathname, isEmployeeAccount));
      setQuickCreate(false);
      setCustomerName("");
      setSelectedOrderId("");
    };
    window.addEventListener("popstate", onPop);
    return () => {
      active = false;
      window.removeEventListener("popstate", onPop);
    };
  }, [today, user.id, isEmployeeAccount]);

  const selectedAccount = accounts.find(item => item.id === accountId) ?? null;

  function navigate(next: CsFillPage, create = false, name = "") {
    setQuickCreate(create);
    setCustomerName(name);
    const path = csFillPages[next].path;
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setPage(next);
    if (next !== "library") setSelectedOrderId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return (
    <main className="customer-fill role-desk">
      <header className="desk-heading">
        <div>
          <p className="eyebrow">日常填报</p>
          <h1>{csFillPages[page].title}</h1>
        </div>
        <div className="actions">
          <button type="button" className="secondary" onClick={onLogout}>
            退出
          </button>
        </div>
      </header>

      <section className="card fill-account fill-account-bar" aria-label="填报身份">
        <div className="fill-identity-fields">
          <div className="fill-identity-summary">
            <div>
              <span className="fill-avatar" aria-hidden="true">
                {(user.displayName || "客").slice(0, 1)}
              </span>
              <span className="fill-identity-text">
                <strong>{user.displayName}</strong>
                <span>
                  {isEmployeeAccount ? "已登录客服账号" : "已绑定接待账号"}
                  {isEmployeeAccount && (selectedAccount
                    ? ` · ${selectedAccount.wechatId}`
                    : accounts.length
                      ? ` · 本组可用接待账号 ${accounts.length} 个`
                      : " · 暂未绑定接待账号")}
                </span>
              </span>
            </div>
          </div>
          {isEmployeeAccount && accounts.length > 0 && <Field label="接待账号">
            <select
              aria-label="选择接待账号"
              value={accountId}
              disabled={loadingAccounts}
              onChange={event => setAccountId(event.target.value)}
            >
              <option value="">
                {loadingAccounts
                  ? "正在读取接待账号…"
                  : accounts.length
                    ? "全部接待账号"
                    : "暂无已登记接待账号"}
              </option>
              {accounts.map(account => (
                <option key={account.id} value={account.id}>
                  {account.wechatId}
                  {account.phoneLabel ? ` · ${account.phoneLabel}` : ""}
                </option>
              ))}
            </select>
          </Field>}
        </div>
        {page === "leads" && isEmployeeAccount && selectedAccount &&
          <RequestCsBinding key={selectedAccount.id} accountId={selectedAccount.id} onActivate={onDeviceActivated} />}
        {accountError && (
          <p className="error" role="alert">
            {accountError}
          </p>
        )}
      </section>

      <nav className="fill-nav" aria-label="客服工作台导航">
        {csFillPageIds.filter(id => isEmployeeAccount || id !== "reimbursements").map(id => {
          const item = csFillPages[id];
          return <button key={id} type="button" className="secondary" aria-pressed={page === id} aria-label={item.title} onClick={() => { setSelectedOrderId(""); navigate(id); }}>
            <span className="fill-nav-icon" aria-hidden="true"><DashboardIcon name={item.icon} /></span>
            <span className="fill-nav-full">{item.title}</span><span className="fill-nav-short">{item.shortTitle}</span>
          </button>;
        })}
      </nav>

      {page === "leads" && (
        <LeadWorkspace
          today={today}
          onOpenOrder={(_,name)=>navigate("library",true,name)}
          editable
          platform={selectedAccount?.platform ?? user.servicePlatform}
          defaultOperatorName={user.displayName}
        />
      )}

      {page === "library" && (
        <OrderWorkspace
          today={today}
          user={user}
          selectedId={selectedOrderId}
          onSelectOrder={setSelectedOrderId}
          createOnMount={quickCreate}
          customerName={customerName}
        />
      )}

      {isEmployeeAccount && page === "reimbursements" && <ReimbursementWorkspace today={today} mode="staff" />}
      {page === "performance" && (
        <CsPersonalPerformance
          today={today}
          onOpenOrder={id => {
            setSelectedOrderId(id);
            navigate("library");
          }}
        />
      )}
    </main>
  );
}

function CsPersonalPerformance({
  today,
  onOpenOrder
}: {
  today: string;
  onOpenOrder: (id: string) => void;
}) {
  const [preset, setPreset] = useState<StandardPreset>("month");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const range = customRange ?? dashboardPresetRange(today, preset);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await api.orders("", { from: range.from, to: range.to });
      setOrders(data.orders);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [range.from, range.to]);

  const validOrders = orders.filter(o => !o.cancelled && o.status !== "refunded");
  const liveOrders = validOrders.filter(o => o.dealChannel !== "private");
  const privateOrders = validOrders.filter(o => o.dealChannel === "private");
  const excludedOrders = orders.filter(o => o.cancelled || o.status === "refunded");

  const sumAmount = (list: Order[]) =>
    money(list.reduce((total, o) => total + (cents(o.bookingAmount ?? o.amount) ?? 0n), 0n));

  return (
    <section className="card">
      <div className="commerce-line">
        <h2>个人业绩</h2>
        <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
          刷新
        </button>
      </div>
      <PeriodToolbar
        today={today}
        preset={preset}
        custom={customRange}
        onPreset={next => {
          setPreset(next);
          setCustomRange(null);
        }}
        onCustom={next => setCustomRange(next)}
      />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="fill-page-count" role="status">{!customRange && preset === "month" ? "本月有效开单" : "区间有效开单"} <strong>{loading || error ? "—" : validOrders.length}</strong> 单</p>
      <div className="commerce-kpis fill-performance-kpis">
        <div className="fill-hero"><small>直播间成交（{liveOrders.length} 单）</small><strong>{yuan(sumAmount(liveOrders))}</strong></div>
        <div><small>客服私推（{privateOrders.length} 单）</small><strong>{yuan(sumAmount(privateOrders))}</strong></div>
        <div><small>跑单／退款冲抵（{excludedOrders.length} 单）</small><strong>{yuan(sumAmount(excludedOrders))}</strong></div>
      </div>
      <p className="notice">
        口径：按开单卡料价＋代购费统计，排除跑单与退款订单（当前区间已排除 {excludedOrders.length} 笔，合计{" "}
        {yuan(sumAmount(excludedOrders))}）。
      </p>
      <div className="commerce-list">
        {!loading && !orders.length && (
          <div className="empty-state">
            <strong>当前区间暂无订单</strong>
            <p>可切换日期区间，或返回「开单与售后」登记成交。</p>
          </div>
        )}
        {orders.map(o => (
          <button
            key={o.id}
            type="button"
            className="commerce-record secondary"
            onClick={() => onOpenOrder(o.id)}
          >
            <span>
              <strong>{o.customerLabel || "未登记称呼"}</strong>
              <small>
                {o.orderRef} · {o.businessDate}
                {o.projectLine ? ` · ${o.projectLine}` : ""}
                {o.hasSourcingNoSettle ? " · 含接待（PH）" : ""}
              </small>
              <small>
                {o.dealChannel === "private" ? "客服私推" : "直播间开单"} ·{" "}
                {o.cancelled ? "已跑单" : labelOrderStatus(o.status)}
              </small>
            </span>
            <span className="commerce-amount">
              {yuan(o.bookingAmount ?? o.amount)}
              <small>查看档案 ›</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
