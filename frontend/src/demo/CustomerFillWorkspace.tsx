import ReimbursementWorkspace from "./ReimbursementWorkspace";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CreateOrder, Field } from "../OrderWorkspace";
import { toErrorMessage } from "../errors";
import { csFillPageFromPath, csFillPageIds, csFillPages, type CsFillPage } from "../fillEntries";
import { DashboardIcon } from "../DashboardIcon";
import { centsOf, commissionLine, estimateCsCommission, type WelfareDeduction } from "./commissionCalc";
import { dashboardPresetRange } from "../dates";
import { PeriodToolbar, type StandardPreset } from "../PeriodToolbar";
import type { PersonalFanPreset } from "../leadApi";
import { yuan } from "../dashboardDisplay";
import { OrderStatusTags, StatusFilterBar } from "../OrderStatusTagView";
import { classifyOrderStatus, factsFromCrm, matchesStatusFilter, type StatusFilter } from "../orderStatusTags";
import { CsFillOverview } from "../CsFillOverview";
import OrderAfterSalesFill from "./OrderAfterSalesFill";
import FanFillForm from "./FanFillForm";
import { loadServiceDirectory, type FillAccount } from "./serviceDirectory";
import { effectiveOrderCents, type CrmOrder, type CrmOrderDraft, centsToYuan, customerStatus, customerTags, invalidReasons, latestCustomerReview, useCustomerCrm, type CrmActor, type CrmCustomer, type SpendTier } from "./customerCrm";
import CrmOrderHistory from "./CrmOrderHistory";
import "./customer-fill.css";
import "../fill-ui.css";
import "./role-workbenches.css";

function personKey(account: FillAccount) {
  return account.registeredHolderId || (account.id==="demo-wechat-1"?"demo-cs-a":account.holderName || account.id);
}
// These costs belong only to the seeded fictional orders.
const sampleCommissionCosts = new Map([
  ["sample-o1", { material: "760.00", shipping: "28.00" }],
  ["sample-o6", { material: "400.00", shipping: "20.00" }]
]);
function demoWelfareDeductions(month: string, employeeName: string): WelfareDeduction[] {
  try {
    const raw = window.sessionStorage.getItem("cms-demo-reimbursements-v1");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { claims?: { id: string; claimant: string; claimType?: string; welfareCustomer?: string; orderId?: string; status: string; expenseDate: string; purpose: string; amount: string }[] };
    return (parsed.claims ?? []).flatMap((c) => {
      if (c.claimType !== "welfare" || c.orderId || c.status !== "approved" || !c.expenseDate.startsWith(month) || c.claimant !== employeeName) return [];
      const amountCents = centsOf(c.amount);
      if (amountCents == null || amountCents <= 0) return [];
      return [{ id: c.id, expenseDate: c.expenseDate, operator: c.claimant, customer: c.welfareCustomer || "", purpose: c.purpose, amountCents }];
    });
  } catch {
    return [];
  }
}
function demoCommissionEstimate(orders: CrmOrder[], month: string, employeeName: string) {
  const estimate = estimateCsCommission(orders.map(row => {
    const costs = sampleCommissionCosts.get(row.id);
    return commissionLine({
      order: {id:row.id, business_date:row.businessDate, order_ref:row.id, status:"placed", material_cost_cny:costs?.material},
      details: {operatorName:row.employeeName},
      items: row.items?.map(item=>({price_cny:item.priceCny,buying_fee_cny:item.buyingFeeCny}))
        ?? [{price_cny:(row.materialCents/100).toFixed(2),buying_fee_cny:(row.feeCents/100).toFixed(2)}],
      expenses: costs ? [{category:"shipping",amount_cny:costs.shipping}] : []
    }, row.channel);
  }), demoWelfareDeductions(month, employeeName));
  return { amount: estimate.cents === null ? null : (estimate.cents/100).toFixed(2), pendingCount: estimate.pendingCount, welfareCents: estimate.welfareCents };
}

export default function CustomerFillWorkspace({ today }: { today: string }) {
  const crm = useCustomerCrm(today);
  const [page, setPage] = useState<CsFillPage>(() => csFillPageFromPath(window.location.pathname));
  const [accounts, setAccounts] = useState<FillAccount[]>([]);
  const [personId, setPersonId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [identityExpanded, setIdentityExpanded] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [checkins, setCheckins] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([api.csAccounts(), loadServiceDirectory()]).then(([data, directory]) => {
      if (!live) return;
      const rows: FillAccount[] = (directory.enabled ? directory.accounts : data.accounts).filter(item => item.isActive);
      setAccounts(rows);
      const firstPerson = rows[0] ? personKey(rows[0]) : "";
      setPersonId(current => current || firstPerson);
      setError("");
    }).catch(cause => { if (live) setError(toErrorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    const onPop = () => { setPage(csFillPageFromPath(window.location.pathname)); setCustomerId(""); };
    window.addEventListener("popstate", onPop);
    return () => { live = false; window.removeEventListener("popstate", onPop); };
  }, [today]);
  const people = [...new Map(accounts.map(account => {
    const id = personKey(account);
    return [id, { id, name: account.holderName || account.wechatId }];
  })).values()];
  const selectedPerson = people.find(person => person.id === personId);
  const personAccounts = accounts.filter(account => personKey(account) === personId);
  const selected = personAccounts.find(account => account.id === accountId);
  const actor: CrmActor | null = selectedPerson ? { role: "cs", employeeId: selectedPerson.id, employeeName: selectedPerson.name, teamIds: [selected?.teamId || personAccounts[0]?.teamId || ""] } : null;
  const mine = actor ? crm.state.customers.filter(customer => customer.employeeId === actor.employeeId) : [];
  const confirmed = new Map(mine.flatMap(item => {
    const review=latestCustomerReview(crm.state,item.id);
    return review?.status==="approved"&&review.reviewedAt&&review.reviewer&&review.reviewer!=="预设规则自动确认"
      ?[[item.id,review] as const]:[];
  }));
  const customer = mine.find(item => item.id === customerId);
  const monthOrders=crm.state.orders.filter(order=>order.employeeId===actor?.employeeId&&!order.cancelled&&order.businessDate<=today&&order.businessDate.startsWith(today.slice(0,7)));
  const [fanPreset,setFanPreset]=useState<PersonalFanPreset>("day");
  const fanRange=dashboardPresetRange(today,fanPreset);
  const fanCohort=mine.filter(row=>row.createdOn>=fanRange.from&&row.createdOn<=fanRange.to);
  const invalidFans=fanCohort.filter(row=>customerStatus(crm.state,row)==="invalid");
  const invalidIds=new Set(invalidFans.map(row=>row.id));
  const fanCounts={...fanRange,added:fanCohort.length,invalid:invalidFans.length,
    replied:fanCohort.filter(row=>row.contact==="replied"&&!invalidIds.has(row.id)).length};
  const liveOrders=monthOrders.filter(row=>row.channel==="live");
  const privateOrders=monthOrders.filter(row=>row.channel==="private");
  const monthAmount=(orders:CrmOrder[])=>centsToYuan(orders.reduce((sum,row)=>sum+effectiveOrderCents(row),0)).replaceAll(",","");
  const leadDrawer=useRef<HTMLDialogElement>(null);
  const leadCount = mine.filter(row => row.createdOn === today).length;
  const checkinKey = `${today}:${actor?.employeeId ?? ""}`;
  const checked = checkins.includes(checkinKey);
  function navigate(next: CsFillPage) {
    const path = csFillPages[next].path;
    if (window.location.pathname !== path) window.history.pushState({}, "", path + "?role=cs");
    setPage(next); setCustomerId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return <main className="customer-fill role-desk">
    <header className={`desk-heading${customer ? "" : " cs-mobile-hide-head"}`}><div><p className="eyebrow">日常填报</p><h1>{customer ? customer.name : csFillPages[page].title}</h1></div>{customer && <button type="button" className="secondary" onClick={() => setCustomerId("")}>返回客资库</button>}</header>
    <section className="card fill-account fill-account-bar" aria-label="填报身份">
      <div className="fill-identity-summary">
        <div><span className="fill-avatar" aria-hidden="true">{(selectedPerson?.name || "客").slice(0, 1)}</span>
          <span className="fill-identity-text"><strong>{selectedPerson?.name || "客服填报"}</strong>
            <span>{selected ? (selected.platform === "whatsapp" ? "WhatsApp" : selected.platform === "messenger" ? "Messenger" : "接待账号") + " · 尾号" + (selected.accountIdentifier || selected.wechatId).slice(-4) : loading ? "正在读取接待账号…" : "待选择接待账号"}</span>
          </span>
        </div>
        <button type="button" className="secondary" aria-expanded={identityExpanded} aria-controls="fill-identity-fields" disabled={loading || !personId} onClick={() => setIdentityExpanded(open => !open)}>
          {identityExpanded ? "收起" : selected ? "更换" : "选择接待账号"}
        </button>
      </div>
      <div id="fill-identity-fields" hidden={!identityExpanded}>
        <div className="fill-identity-selectors"><Field label="接待账号">
          <select aria-label="选择接待账号" value={accountId} onChange={event => { setAccountId(event.target.value); setCustomerId(""); if (event.target.value) setIdentityExpanded(false); }}>
            <option value="">请选择接待账号</option>{personAccounts.map(account => <option key={account.id} value={account.id}>{account.wechatId}</option>)}
          </select>
        </Field></div>
        <details className="fill-login-help"><summary aria-label="登录说明">ⓘ</summary><p className="hint">演示阶段按所选客服区分数据。</p>      
    </details>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
    <nav className="fill-nav" aria-label="客服工作台导航">
      {csFillPageIds.map(id => {
        const item = csFillPages[id];
        return <button className="secondary" type="button" key={id} aria-pressed={page === id} aria-label={item.title} onClick={() => navigate(id)}>
          <span className="fill-nav-icon" aria-hidden="true"><DashboardIcon name={item.icon} /></span>
          <span className="fill-nav-full">{item.title}</span><span className="fill-nav-short">{item.shortTitle}</span>
        </button>;
      })}
    </nav>

    {page==="home"&&<CsFillOverview data={actor?{orderCount:monthOrders.length,liveCount:liveOrders.length,privateCount:privateOrders.length,liveAmount:monthAmount(liveOrders),privateAmount:monthAmount(privateOrders),commission:null,commissionEstimate:demoCommissionEstimate(monthOrders, today.slice(0, 7), actor.employeeName)}:null}
      fans={actor?fanCounts:null} preset={fanPreset} onPreset={setFanPreset}/> }
    {!actor && page !== "reimbursements" && page !== "home" && <section className="card"><h2>{loading ? "正在读取客服" : "暂无可用客服"}</h2><p>请选择可用的接待账号。</p></section>}
    {actor && page === "leads" && !customer && <section className="card cs-leads-page">
      <div className="cs-page-head"><div className="cs-page-row"><h2>客户档案</h2><span className="cs-count-pill" role="status">今日 <strong>{leadCount}</strong> 条</span></div><div className="cs-split-actions"><button type="button" disabled={!selected} onClick={()=>leadDrawer.current?.showModal()}>＋ 登记新客资</button>{leadCount===0 && (checked ? <span className="cs-quiet-btn">今日已打卡</span> : <button className="secondary" type="button" onClick={()=>setCheckins(values=>[...values,checkinKey])}>今日 0 粉打卡</button>)}</div></div>
      {selected ? <dialog className="fill-drawer" ref={leadDrawer} aria-label="登记新客资"><div className="fill-drawer-body"><header className="commerce-line"><h2>登记新客资</h2><button type="button" className="secondary" onClick={()=>leadDrawer.current?.close()}>关闭</button></header><FanFillForm key={selected.id} today={today} account={selected} employees={[]} tenures={[]} onRegister={(leads, source) => {
      try {
        if (selected.holderSince && source.businessDate < selected.holderSince) throw Error("该填报日期早于当前客服接手日期，请由主管核对历史归属");
        crm.dispatch({ type: "registerLeads", leads: leads.filter(lead => lead.customer.trim()).map(lead => ({ name: lead.customer, accountId: selected.id, employeeId: actor.employeeId, employeeName: actor.employeeName, teamId: selected.teamId || actor.teamIds[0], teamName: selected.teamName || "", source: source.pageName, createdOn: source.businessDate, adAccountId: source.adAccountId, need: lead.summary, channel: lead.channel, contact: lead.contact, invalidReason: lead.invalidReason, invalidNote: lead.invalidNote })) });
        setNotice("已登记到本次客资库。无效申请要等主管确认后，才标记为无效。");
        leadDrawer.current?.close();

      } catch (cause) { setNotice(""); setError(toErrorMessage(cause)); }
    }} />{error&&<p role="alert" className="error">{error}</p>}</div></dialog> : <p className="notice">请先选择 WhatsApp 或 Messenger 接待账号，再登记客资。</p>}
      <DemoCustomerRows plain people={mine.filter(row=>!confirmed.has(row.id))} state={crm.state} onOpen={setCustomerId}/>
    </section>}
    {actor&&page==="leads"&&customer&&<CustomerDetail key={customer.id} today={today} customer={customer} actor={actor} crm={crm} account={selected} onMessage={setNotice}/>}
    {actor&&page==="invalid"&&<DemoCustomerRows people={mine.filter(row=>confirmed.has(row.id))} state={crm.state} invalid/>}
    {page === "reimbursements" && <ReimbursementWorkspace today={today} mode="staff" />}
    {actor && page === "performance" && <Performance today={today} employeeId={actor.employeeId} state={crm.state} onOpen={id=>{navigate("leads");setCustomerId(id);}} />}
  </main>;
}

function DemoCustomerRows({people,state,onOpen,invalid=false,plain=false}:{people:CrmCustomer[];state:ReturnType<typeof useCustomerCrm>["state"];onOpen?:(id:string)=>void;invalid?:boolean;plain?:boolean}) {
  const [search,setSearch]=useState("");
  const rows=people.filter(row=>row.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a,b)=>b.createdOn.localeCompare(a.createdOn)||a.name.localeCompare(b.name,"zh"));
  const Shell = plain ? "div" : "section";
  return <Shell className={plain ? "cs-customer-book" : "card cs-customer-book"}>
    {invalid && <div className="cs-page-row"><h2>已复核无效粉</h2></div>}
    <div className="cs-search-line"><input type="search" aria-label="查找客户" placeholder="输入客户称呼查找..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
    {!rows.length&&<p className="notice">{invalid?"没有符合条件的已复核无效粉。":"没有符合条件的客户。"}</p>}
    <div className="commerce-list cs-customer-rows">{rows.map(row=>{
      const review=latestCustomerReview(state,row.id);
      const latest=state.orders.filter(order=>order.customerId===row.id).sort((a,b)=>b.businessDate.localeCompare(a.businessDate))[0];
      const subtitle=[row.createdOn,row.channel==="ws"?"WhatsApp":row.channel==="ms"?"Messenger":row.source].filter(Boolean).join(" · ");
      if(invalid)return <article className="commerce-record" key={row.id}>
        <span><strong>{row.name}</strong><small>{subtitle}</small><small>{review?.note|| (review&&invalidReasons[review.reason])}</small></span>
        <small>复核 {review?.reviewedAt?.slice(0,10)}</small>
      </article>;
      return <button type="button" className="secondary commerce-record" key={row.id} onClick={()=>onOpen?.(row.id)}>
        <span><strong>{row.name}</strong><small>{subtitle} · {customerTags(state,row).join(" · ")}</small></span>
        <small>{latest?latest.cancelled?"最近订单已冲抵":"有历史订单":"暂无订单"} ›</small>
      </button>;
    })}</div>
  </Shell>;
}

function CustomerDetail({ today, customer, actor, crm, account, onMessage }: { today: string; customer: CrmCustomer; actor: CrmActor; crm: ReturnType<typeof useCustomerCrm>; account?: FillAccount; onMessage: (value: string) => void }) {
  const tags = customerTags(crm.state, customer);
  const pending = crm.state.reviews.some(review => review.customerId === customer.id && review.status === "pending");
  return <div>
    <details className="card customer-profile"><summary><span>客户档案</span><span className="crm-tags">{tags.map(tag => <em key={tag} className={tag === "无效" ? "is-invalid" : tag === "待复核" ? "is-pending" : ""}>{tag}</em>)}</span></summary><dl className="fill-preview-fields"><div><dt>客服</dt><dd>{customer.employeeName}</dd></div><div><dt>来源</dt><dd>{customer.source || "未填写"}</dd></div><div><dt>下粉广告户ID</dt><dd>{customer.adAccountId || "来源待补"}</dd></div><div><dt>登记日期</dt><dd>{customer.createdOn}</dd></div><div><dt>需求</dt><dd>{customer.need || "未填写"}</dd></div></dl>
      <Field label="消费能力"><select aria-label="消费能力" value={customer.spendTier} onChange={event => { try { crm.dispatch({ type: "setTier", actor, customerId: customer.id, tier: event.target.value as SpendTier }); } catch (cause) { onMessage(toErrorMessage(cause)); } }}><option value="">未分档</option><option value="A">A档</option><option value="B">B档</option><option value="C">C档</option></select></Field>
      <p className="hint">有效、已成交、无效由订单和复核结果决定。复购在有效订单超过两笔时自动出现。消费能力由客服手工选择。</p>
    
      {!pending && !tags.includes("无效") && <InvalidRequest hasDeal={customerStatus(crm.state, customer) === "dealt"} onSubmit={(reason, note) => { crm.dispatch({ type: "requestInvalid", actor, customerId: customer.id, reason, note }); onMessage(reason === "custom" ? "已提交主管复核。确认前客户仍不是无效客资；若驳回会自动打上「尝试沟通」标识。" : "已按预设规则标记为无效客资。"); }} />}
    </details>
    <section className="card"><h2>开单记录</h2><CrmOrderHistory state={crm.state} customerId={customer.id} today={today} actor={actor} dispatch={crm.dispatch} room={account?.registeredRoomName ? {name:account.registeredRoomName,host:account.registeredHostName||""}:undefined} onMessage={onMessage} onAfterSales={order=><details className="as-fold"><summary>办理售后</summary><OrderAfterSalesFill today={today} operator={actor.employeeName} customerName={customer.name} customerCode={customer.customerRef||customer.id} orderRef={order.id} orderDate={order.businessDate} currency={order.customerCurrency||"CNY"} room={account?.registeredRoomName?{name:account.registeredRoomName,host:account.registeredHostName||""}:undefined} /></details>}/><OrderPractice customerName={customer.name} today={today} operator={actor.employeeName} room={account?.registeredRoomName ? { name: account.registeredRoomName, host: account.registeredHostName || "" } : undefined} onPractice={values => { crm.dispatch({ type: "addOrder", actor, customerId: customer.id, ...values }); onMessage("已按开单卡记入本次演练业绩。正式收款仍由财务登记。"); }} /></section>
    
  </div>;
}

const demoPerformanceTeams = [
  {id:"practice-team-2", name:"客服二组"},
  {id:"practice-team-zw", name:"志伟组"}
];

function OrderPractice({ today, operator, room, onPractice, customerName }: { customerName:string; today: string; operator: string; room?: { name: string; host: string }; onPractice: (value: CrmOrderDraft) => void }) {
  const drawer=useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  return <div>
    <button type="button" onClick={()=>drawer.current?.showModal()}>＋ 登记一笔成交</button>
    <dialog className="fill-drawer fill-order-drawer" ref={drawer} aria-label="登记一笔成交"><div className="fill-drawer-body">
    <header className="commerce-line"><h2>登记一笔成交</h2><button type="button" className="secondary" onClick={()=>drawer.current?.close()}>关闭</button></header>
    {error && <p className="error" role="alert">{error}</p>}
    <CreateOrder customerName={customerName} practiceTeams={demoPerformanceTeams} today={today} operator={operator} registeredRoom={room} previewOnly onSaved={() => {}} onPractice={draft => { try { onPractice(draft); setError(""); drawer.current?.close(); } catch (cause) { setError(toErrorMessage(cause)); } }} />
    </div></dialog>
  </div>;
}

function InvalidRequest({ hasDeal, onSubmit }: { hasDeal: boolean; onSubmit: (reason: keyof typeof invalidReasons, note: string) => void }) {
  const drawer = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState<keyof typeof invalidReasons | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const isCustom = reason === "custom";
  return <>
    <button type="button" className="text-action invalid-entry" onClick={() => drawer.current?.showModal()}>标记无效客资 ›</button>
    <dialog className="fill-drawer invalid-lead-drawer" ref={drawer} aria-label="标记无效客资" onClose={() => setError("")}><div className="fill-drawer-body">
      <header className="commerce-line"><h2>标记无效客资</h2><button type="button" className="secondary" onClick={() => drawer.current?.close()}>关闭</button></header>
      <form onSubmit={event => { event.preventDefault(); if (!reason) return; try { onSubmit(reason, note); setNote(""); setError(""); drawer.current?.close(); } catch (cause) { setError(toErrorMessage(cause)); } }}>
        {hasDeal && <p className="notice">该客户已有成交记录，仅在整单跑单或误建档时标记无效</p>}
        <p className="hint">预设三类直接计入无效，其他提交主管复核。</p>
        <Field label="无效原因"><select required aria-label="无效原因" value={reason} onChange={event => setReason(event.target.value as keyof typeof invalidReasons)}><option value="">请选择</option>{Object.entries(invalidReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
        <Field label={isCustom ? "判定原因（必填）" : "补充说明（可选）"}><textarea required={isCustom} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder={isCustom ? "请填写具体无效判定原因，提交给客服主管复核" : "补充具体情况，可选"} /></Field>
        {error && <p className="error" role="alert">{error}</p>}
        <button type="submit">{isCustom ? "提交主管复核" : "确认标记无效"}</button>
      </form>
    </div></dialog>
  </>;
}

function Performance({ today, employeeId, state, onOpen }: { today:string; employeeId: string; onOpen:(id:string)=>void; state: ReturnType<typeof useCustomerCrm>["state"] }) {
  const [preset, setPreset] = useState<StandardPreset>("month");
  const [customRange, setCustomRange] = useState<{ from: string; to: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const range = customRange ?? dashboardPresetRange(today, preset);
  const rows = state.orders.filter(order => order.employeeId === employeeId && order.businessDate >= range.from && order.businessDate <= range.to);
  const valid = rows.filter(order => !order.cancelled);
  const live = valid.filter(order => order.channel !== "private");
  const priv = valid.filter(order => order.channel === "private");
  const excluded = rows.filter(order => order.cancelled);
  const visible = rows.filter(order => matchesStatusFilter(classifyOrderStatus(factsFromCrm(order)), statusFilter));
  const sum = (list: typeof rows) => list.reduce((total, order) => total + (order.cancelled ? order.materialCents + order.feeCents : effectiveOrderCents(order)), 0);
  return <section className="card cs-performance" aria-label="个人业绩">
    <div className="cs-page-row"><h2>个人业绩</h2><span className="cs-count-pill" role="status">有效 <strong>{valid.length}</strong> 单</span></div>
    <div className="cs-perf-toolbar"><PeriodToolbar today={today} preset={preset} custom={customRange} customLabel="自定义 ▾" onPreset={next => { setPreset(next); setCustomRange(null); }} onCustom={setCustomRange} /></div>
    <div className="commerce-kpis fill-performance-kpis">
      <div className="fill-hero"><small>直播间成交（{live.length} 单）</small><strong>{yuan(centsToYuan(sum(live)))}</strong></div>
      <div><small>客服私推</small><small>{priv.length} 单</small><strong>{yuan(centsToYuan(sum(priv)))}</strong></div>
      <div><small>跑单／换料冲抵</small><small>{excluded.length} 单</small><strong>{yuan(centsToYuan(sum(excluded)))}</strong></div>
    </div>
    <StatusFilterBar value={statusFilter} onChange={setStatusFilter} />
    <div className="commerce-list">{visible.map(order => {
      const customer = state.customers.find(item => item.id === order.customerId);
      const facts = factsFromCrm(order);
      const view = classifyOrderStatus(facts);
      const shown = order.materialCents + (order.channel === "private" ? 0 : order.feeCents);
      return <button type="button" key={order.id} className="commerce-record secondary order-history-card" onClick={() => onOpen(order.customerId)}>
        <span className="order-card-main">
          <span className="order-card-title"><strong>{customer?.name || "客户"}</strong><OrderStatusTags facts={facts} /></span>
          <small>{order.businessDate} · {order.id} · {order.channel === "private" ? "客服私推" : "直播间开单"}{order.performanceTeamName ? " · " + order.performanceTeamName : ""}</small>
          {view.followup && <small className="order-followup">{view.followup}</small>}
        </span>
        <span className="commerce-amount"><b className={view.voided ? "is-void" : ""}>{yuan(centsToYuan(shown))}</b><small>查看档案 →</small></span>
      </button>;
    })}</div>
    {!rows.length && <p>这个区间还没有开单。</p>}
    {!!rows.length && !visible.length && <p>这个筛选下没有开单。</p>}
  </section>;
}
