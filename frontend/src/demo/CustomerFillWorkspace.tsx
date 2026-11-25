import ReimbursementWorkspace from "./ReimbursementWorkspace";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { CreateOrder, Field } from "../OrderWorkspace";
import { cents, currencies, expenseLabels } from "../commerceUi";
import { toErrorMessage } from "../errors";
import { DashboardIcon } from "../DashboardIcon";
import { InfoTip } from "../InfoTip";
import ReportTextImport from "./ReportTextImport";
import { afterSaleTotals, emptyAfterSale, parseAfterSaleText, signedMoney, type AfterSaleExpense, type AfterSaleFields } from "./afterSalesText";
import FanFillForm from "./FanFillForm";
import { loadServiceDirectory, type FillAccount } from "./serviceDirectory";
import { orderFunds, effectiveOrderCents, type CrmOrderDraft, centsToYuan, customerTags, invalidReasons, personalPerformance, useCustomerCrm, type CrmActor, type CrmCustomer, type SpendTier } from "./customerCrm";
import CrmOrderHistory from "./CrmOrderHistory";
import "./customer-fill.css";
import "../fill-ui.css";
import "./role-workbenches.css";

const modules = [
  { id: "leads", title: "新增客资登记", shortTitle: "客资", detail: "加粉详情·需求记录", icon: "fans" },
  { id: "library", title: "开单与售后", shortTitle: "开单", detail: "客户开单/售后记录", icon: "orders" },
  { id: "performance", title: "个人业绩查询", shortTitle: "业绩", detail: "直播间/私推业绩", icon: "summary" },
  { id: "reimbursements", title: "售后垫付报销", shortTitle: "报销", detail: "上传凭证并提交主管", icon: "teamReimbursements" }
] as const;
type ModuleId = typeof modules[number]["id"];
type FillPage = "home" | ModuleId;
const pathPage = (): FillPage => {
  const key = window.location.pathname.replace(/\/$/, "").split("/").pop();
  if (key === "fans") return "leads";
  if (key === "orders" || key === "after-sales") return "library";
  if (key === "performance") return "performance";
  if (key === "reimbursements") return "reimbursements";
  return "home";
};
const titles: Record<FillPage, string> = { home: "客服工作台", leads: "新增客资登记", library: "开单与售后", performance: "个人业绩查询", reimbursements: "售后垫付报销" };

export default function CustomerFillWorkspace({ today }: { today: string }) {
  const crm = useCustomerCrm(today);
  const [page, setPage] = useState<FillPage>(pathPage);
  const [accounts, setAccounts] = useState<FillAccount[]>([]);
  const [personId, setPersonId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [identityExpanded, setIdentityExpanded] = useState(true);
  const [customerId, setCustomerId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([api.csAccounts(), loadServiceDirectory()]).then(([data, directory]) => {
      if (!live) return;
      const rows: FillAccount[] = (directory.enabled ? directory.accounts : data.accounts).filter(item => item.isActive);
      setAccounts(rows);
      const firstPerson = rows[0] ? (rows[0].registeredHolderId || rows[0].holderName || rows[0].id) : "";
      setPersonId(current => current || firstPerson);
      setError("");
    }).catch(cause => { if (live) setError(toErrorMessage(cause)); }).finally(() => { if (live) setLoading(false); });
    const onPop = () => { setPage(pathPage()); setCustomerId(""); };
    window.addEventListener("popstate", onPop);
    return () => { live = false; window.removeEventListener("popstate", onPop); };
  }, [today]);
  const people = [...new Map(accounts.map(account => {
    const id = account.registeredHolderId || account.holderName || account.id;
    return [id, { id, name: account.holderName || account.wechatId }];
  })).values()];
  const selectedPerson = people.find(person => person.id === personId);
  const personAccounts = accounts.filter(account => (account.registeredHolderId || account.holderName || account.id) === personId);
  const selected = personAccounts.find(account => account.id === accountId);
  const actor: CrmActor | null = selectedPerson ? { role: "cs", employeeId: selectedPerson.id, employeeName: selectedPerson.name, teamIds: [selected?.teamId || personAccounts[0]?.teamId || ""] } : null;
  const mine = actor ? crm.state.customers.filter(customer => customer.employeeId === actor.employeeId) : [];
  const customer = mine.find(item => item.id === customerId);
  const leadDrawer=useRef<HTMLDialogElement>(null);
  function navigate(next: FillPage) {
    const path = next === "leads" ? "/fill/fans" : next === "library" ? "/fill/orders" : next === "performance" ? "/fill/performance" : next === "reimbursements" ? "/fill/reimbursements" : "/fill";
    window.history.pushState({}, "", path + "?role=cs");
    setPage(next); setCustomerId("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  return <main className="customer-fill role-desk">
    <header className="desk-heading"><div><p className="eyebrow">日常填报</p><h1>{customer ? customer.name : titles[page]}</h1></div>{page !== "home" && <button type="button" className="secondary" onClick={() => customer ? setCustomerId("") : navigate("home")}>{customer ? "返回客资库" : "返回工作台"}</button>}</header>
    <section className="card fill-account fill-account-bar" aria-label="填报身份">
      {selected && !identityExpanded ? <div className="fill-identity-summary"><div><span className="fill-avatar" aria-hidden="true">{(selectedPerson?.name || "客").slice(0, 1)}</span><span className="fill-identity-text"><strong>{selectedPerson?.name}</strong><span>{selected.platform === "whatsapp" ? "WhatsApp" : selected.platform === "messenger" ? "Messenger" : "接待账号"} · 尾号{(selected.accountIdentifier || selected.wechatId).slice(-4)}</span></span></div><button type="button" className="secondary" aria-expanded={false} onClick={() => setIdentityExpanded(true)}>更换</button></div> : <div id="fill-identity-fields" className="fill-identity-fields">
      {selectedPerson && <div className="fill-identity-summary"><div><span className="fill-avatar" aria-hidden="true">{(selectedPerson.name || "客").slice(0, 1)}</span><span className="fill-identity-text"><strong>{selectedPerson.name}</strong><span>当前登录客服 · 演示模式</span></span></div></div>}
      <div className="fill-identity-selectors">
        <Field label="接待账号"><select aria-label="选择接待账号" value={accountId} disabled={loading || !personId} onChange={event => { setAccountId(event.target.value); setCustomerId(""); if (event.target.value) setIdentityExpanded(false); }}><option value="">{loading ? "正在读取接待账号…" : "请选择 WhatsApp 或 Messenger"}</option>{personAccounts.map(account => <option key={account.id} value={account.id}>{account.wechatId}</option>)}</select></Field>
      </div>
      {selected && <div className="fill-identity-context"><span>{selected.teamName || "未分组"} · {selectedPerson?.name}</span><button type="button" className="text-action" onClick={() => setIdentityExpanded(false)}>收起</button></div>}
      <details className="fill-login-help"><summary>登录说明</summary><p className="hint">个人登录将在服务器部署后启用，首次登录须改密。演示阶段按所选客服区分数据。</p></details></div>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
    </section>
    <nav className="fill-nav" aria-label="客服工作台导航">
      <button className="secondary" type="button" aria-pressed={page==="home"} onClick={()=>navigate("home")}><span className="fill-nav-icon"><DashboardIcon name="home" /></span><span className="fill-nav-full">工作台首页</span><span className="fill-nav-short">首页</span></button>
      {modules.map(item=><button className="secondary" type="button" key={item.id} aria-pressed={page===item.id} onClick={()=>navigate(item.id)}><span className="fill-nav-icon"><DashboardIcon name={item.icon} /></span><span className="fill-nav-full">{item.title}</span><span className="fill-nav-short">{item.shortTitle}</span></button>)}
    </nav>
    {page === "home" && <DemoFillHome today={today} mine={mine} employeeId={actor?.employeeId} state={crm.state} navigate={navigate} openLead={()=>{navigate("leads");requestAnimationFrame(()=>leadDrawer.current?.showModal());}}/>}

    {page !== "home" && !actor && <section className="card"><h2>{loading ? "正在读取客服" : "先选择客服"}</h2><p>第一行选择客服，第二行选择该客服当前负责的接待账号。</p></section>}
    {actor && page === "leads" && (selected ? <section className="card"><div className="commerce-line"><h2>新增客资登记</h2><button type="button" onClick={()=>leadDrawer.current?.showModal()}>＋ 登记新客资</button></div>
      <dialog className="fill-drawer" ref={leadDrawer} aria-label="登记新客资"><div className="fill-drawer-body"><header className="commerce-line"><h2>登记新客资</h2><button type="button" className="secondary" onClick={()=>leadDrawer.current?.close()}>关闭</button></header><FanFillForm key={selected.id} today={today} account={selected} employees={[]} tenures={[]} onRegister={(leads, source) => {
      try {
        if (selected.holderSince && source.businessDate < selected.holderSince) throw Error("该填报日期早于当前客服接手日期，请由主管核对历史归属");
        crm.dispatch({ type: "registerLeads", leads: leads.filter(lead => lead.customer.trim()).map(lead => ({ name: lead.customer, accountId: selected.id, employeeId: actor.employeeId, employeeName: actor.employeeName, teamId: selected.teamId || actor.teamIds[0], teamName: selected.teamName || "", source: source.pageName, createdOn: source.businessDate, adAccountId: source.adAccountId, need: lead.summary, contact: lead.contact, invalidReason: lead.invalidReason, invalidNote: lead.invalidNote })) });
        setNotice("已登记到本次客资库。无效申请要等主管确认后，才标记为无效。");
        leadDrawer.current?.close();
        navigate("library");
      } catch (cause) { setNotice(""); setError(toErrorMessage(cause)); }
    }} />{error&&<p role="alert" className="error">{error}</p>}</div></dialog></section> : <section className="card"><h2>再选择接待账号</h2><p>新客资要记在具体的 WhatsApp 或 Messenger 账号上。</p></section>)}
    {actor && page === "library" && (customer ? <CustomerDetail today={today} customer={customer} actor={actor} crm={crm} account={selected} onMessage={setNotice} /> : <CustomerLibrary people={mine} state={crm.state} onOpen={setCustomerId} />)}
    {page === "reimbursements" && <ReimbursementWorkspace today={today} mode="staff" />}
    {actor && page === "performance" && <Performance employeeId={actor.employeeId} state={crm.state} onOpen={id=>{navigate("library");setCustomerId(id);}} />}
  </main>;
}

function DemoFillHome({today,mine,employeeId,state,navigate,openLead}:{openLead:()=>void;today:string;mine:CrmCustomer[];employeeId?:string;state:ReturnType<typeof useCustomerCrm>["state"];navigate:(page:FillPage)=>void}){
  const [checked,setChecked]=useState(false);
  useEffect(()=>setChecked(false),[employeeId,today]);
  const leads=mine.filter(row=>row.createdOn===today).length;
  const validOrders=state.orders.filter(row=>row.employeeId===employeeId&&!row.cancelled);
  const orders=validOrders.filter(row=>row.businessDate.startsWith(today.slice(0,7))).length;
  const tails=validOrders.filter(row=>orderFunds(row).balance>0).length;
  return <>
    <section className="card fill-progress" aria-label="今日填报进度">
      <div><small>今日已登记客资</small><strong>{employeeId?leads:"—"}</strong></div>
      <div><small>本月有效开单</small><strong>{employeeId?orders:"—"}</strong></div>
      <div><small>待收尾款单数</small><strong>{employeeId?tails:"—"}</strong></div>
      <button className="secondary" type="button" disabled={!employeeId||leads>0||checked} onClick={()=>setChecked(true)}>{checked?"今日已打卡（演练）":"今日 0 粉打卡"}</button>
    </section>
    <div className="fill-home-grid">{modules.map((item,index)=><article key={item.id} className={`card fill-home-card ${index===1?"fill-hero":""}`}>
      <h2><DashboardIcon name={item.icon}/>{item.title}</h2><strong>{item.id==="reimbursements"?"报销":(employeeId?[leads,orders,tails][index]:"—")}</strong><small>{item.detail}</small>
      <button className="secondary" type="button" onClick={()=>item.id==="leads"?openLead():navigate(item.id)}>{["+ 登记新客资","打开开单与售后 →","查看个人业绩 →","+ 申请售后报销"][index]}</button>
    </article>)}</div>
  </>;
}

function CustomerLibrary({ people, state, onOpen }: { people: CrmCustomer[]; state: ReturnType<typeof useCustomerCrm>["state"]; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [tier, setTier] = useState("");
  const [addedFrom, setAddedFrom] = useState("");
  const [addedTo, setAddedTo] = useState("");
  const [query, setQuery] = useState("");
  const rows = people.filter(customer => {
    const tags = customerTags(state, customer).join(" ");
    const tierLabel = customer.spendTier ? customer.spendTier + "档" : "未分档";
    return (!status || tags.includes(status))
      && (!tier || tierLabel === tier)
      && (!addedFrom || customer.createdOn >= addedFrom)
      && (!addedTo || customer.createdOn <= addedTo)
      && (customer.name + customer.need + (customer.adAccountId || "")).toLowerCase().includes(query.trim().toLowerCase());
  }).sort((a, b) => b.createdOn.localeCompare(a.createdOn) || a.name.localeCompare(b.name, "zh"));
  return <section className="card" aria-label="开单与售后"><h2>开单与售后</h2><p className="notice">开单和售后进客户档案。带“演练样本”的记录只供本次浏览器演练，不是正式业绩。当前 {rows.length} 位。</p><div className="grid two fill-filter-grid"><label className="row fill-search">搜索<input aria-label="搜索客户" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="客户名、需求或广告户" /></label><Field label="标签"><select aria-label="客户标签筛选" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部标签</option>{["有效", "已成交", "无效", "待复核", "尝试沟通", "复购"].map(tag => <option key={tag}>{tag}</option>)}</select></Field><Field label="消费档位"><select aria-label="消费档位筛选" value={tier} onChange={event => setTier(event.target.value)}><option value="">全部档位</option>{["A档", "B档", "C档"].map(tag => <option key={tag}>{tag}</option>)}<option value="未分档">未分档</option></select></Field><Field label="添加开始"><input aria-label="添加开始日期" type="date" max={addedTo || undefined} value={addedFrom} onChange={event => setAddedFrom(event.target.value)} /></Field><Field label="添加结束"><input aria-label="添加结束日期" type="date" min={addedFrom || undefined} value={addedTo} onChange={event => setAddedTo(event.target.value)} /></Field></div>{rows.length ? <div className="crm-list">{rows.map(customer => <button type="button" key={customer.id} onClick={() => onOpen(customer.id)}><span><strong>{customer.name}</strong><small>{customer.createdOn} · 下粉广告户 {customer.adAccountId || "来源待补"} · {customer.need || "未填写需求"}</small></span><span className="crm-tags">{customerTags(state, customer).map(tag => <em key={tag} className={tag === "无效" ? "is-invalid" : tag === "待复核" ? "is-pending" : ""}>{tag}</em>)}{customer.sample && <em>演练样本</em>}</span></button>)}</div> : <p className="empty-state">没有符合条件的客户。可先做新增客资登记。</p>}</section>;
}

function CustomerDetail({ today, customer, actor, crm, account, onMessage }: { today: string; customer: CrmCustomer; actor: CrmActor; crm: ReturnType<typeof useCustomerCrm>; account?: FillAccount; onMessage: (value: string) => void }) {
  const tags = customerTags(crm.state, customer);
  const pending = crm.state.reviews.some(review => review.customerId === customer.id && review.status === "pending");
  return <div>
    <section className="card"><h2>客户档案</h2><p className="crm-tags">{tags.map(tag => <em key={tag} className={tag === "无效" ? "is-invalid" : tag === "待复核" ? "is-pending" : ""}>{tag}</em>)}</p><dl className="fill-preview-fields"><div><dt>客服</dt><dd>{customer.employeeName}</dd></div><div><dt>来源</dt><dd>{customer.source || "未填写"}</dd></div><div><dt>下粉广告户ID</dt><dd>{customer.adAccountId || "来源待补"}</dd></div><div><dt>登记日期</dt><dd>{customer.createdOn}</dd></div><div><dt>需求</dt><dd>{customer.need || "未填写"}</dd></div></dl>
      <Field label="消费能力"><select aria-label="消费能力" value={customer.spendTier} onChange={event => { try { crm.dispatch({ type: "setTier", actor, customerId: customer.id, tier: event.target.value as SpendTier }); } catch (cause) { onMessage(toErrorMessage(cause)); } }}><option value="">未分档</option><option value="A">A档</option><option value="B">B档</option><option value="C">C档</option></select></Field>
      <p className="hint">有效、已成交、无效由订单和复核结果决定。复购在有效订单超过两笔时自动出现。消费能力由客服手工选择。</p>
    </section>
    <section className="card"><h2>开单记录</h2><CrmOrderHistory state={crm.state} customerId={customer.id} today={today} actor={actor} dispatch={crm.dispatch} room={account?.registeredRoomName ? {name:account.registeredRoomName,host:account.registeredHostName||""}:undefined} onMessage={onMessage}/><OrderPractice customerName={customer.name} today={today} operator={actor.employeeName} room={account?.registeredRoomName ? { name: account.registeredRoomName, host: account.registeredHostName || "" } : undefined} onPractice={values => { crm.dispatch({ type: "addOrder", actor, customerId: customer.id, ...values }); onMessage("已按开单卡记入本次演练业绩。正式收款仍由财务登记。"); }} /></section>
    {!pending && !tags.includes("无效") && <InvalidRequest onSubmit={(reason, note) => { crm.dispatch({ type: "requestInvalid", actor, customerId: customer.id, reason, note }); onMessage(reason === "custom" ? "已提交主管复核。确认前客户仍不是无效客资；若驳回会自动打上「尝试沟通」标识。" : "已按预设规则标记为无效客资。"); }} />}
    <details className="card"><summary>售后费用试填</summary><AfterSalesFill today={today} operator={actor.employeeName} registeredRoom={account?.registeredRoomName ? { name: account.registeredRoomName, host: account.registeredHostName || "" } : undefined} /></details>
  </div>;
}

const demoPerformanceTeams = [
  {id:"practice-team-2", name:"客服二组"},
  {id:"practice-team-zw", name:"志伟组"}
];

function OrderPractice({ today, operator, room, onPractice, customerName }: { customerName:string; today: string; operator: string; room?: { name: string; host: string }; onPractice: (value: CrmOrderDraft) => void }) {
  const drawer=useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<"live" | "private">("live");
  const [error, setError] = useState("");
  return <div>
    <button type="button" onClick={()=>drawer.current?.showModal()}>＋ 登记一笔成交</button>
    <dialog className="fill-drawer fill-order-drawer" ref={drawer} aria-label="登记一笔成交"><div className="fill-drawer-body">
    <header className="commerce-line"><h2>登记一笔成交</h2><button type="button" className="secondary" onClick={()=>drawer.current?.close()}>关闭</button></header>
    <div className="fill-history-mode" role="group" aria-label="成交渠道"><button type="button" aria-pressed={channel === "live"} onClick={() => setChannel("live")}>直播间开单</button><button type="button" aria-pressed={channel === "private"} onClick={() => setChannel("private")}>私推成交</button></div>
    {error && <p className="error" role="alert">{error}</p>}
    <CreateOrder customerName={customerName} practiceTeams={demoPerformanceTeams} key={channel} channel={channel} today={today} operator={operator} registeredRoom={channel === "live" ? room : undefined} previewOnly onSaved={() => {}} onPractice={draft => { try { onPractice({ ...draft, channel }); setError(""); drawer.current?.close(); } catch (cause) { setError(toErrorMessage(cause)); } }} />
    </div></dialog>
  </div>;
}

function InvalidRequest({ onSubmit }: { onSubmit: (reason: keyof typeof invalidReasons, note: string) => void }) {
  const [reason, setReason] = useState<keyof typeof invalidReasons | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const isCustom = reason === "custom";
  return <form className="card" onSubmit={event => { event.preventDefault(); if (!reason) return; try { onSubmit(reason, note); setNote(""); setError(""); } catch (cause) { setError(toErrorMessage(cause)); } }}><h2>标记无效客资</h2><p className="notice">选择语言不通、误点咨询/不感兴趣、色粉三类预设原因可直接计入无效客资；其他情况请填写判定原因提交客服主管复核（驳回后自动打上「尝试沟通」标识）。</p><Field label="无效原因"><select required aria-label="无效原因" value={reason} onChange={event => setReason(event.target.value as keyof typeof invalidReasons)}><option value="">请选择</option>{Object.entries(invalidReasons).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label={isCustom ? "判定原因（必填）" : "补充说明（可选）"}><textarea required={isCustom} maxLength={1000} value={note} onChange={event => setNote(event.target.value)} placeholder={isCustom ? "请填写具体无效判定原因，提交给客服主管复核" : "补充具体情况，可选"} /></Field>{error && <p className="error" role="alert">{error}</p>}<button type="submit">{isCustom ? "提交主管复核" : "确认标记无效"}</button></form>;
}

function Performance({ employeeId, state, onOpen }: { employeeId: string; onOpen:(id:string)=>void; state: ReturnType<typeof useCustomerCrm>["state"] }) {
  const result = personalPerformance(state, employeeId);
  const rows = state.orders.filter(order => order.employeeId === employeeId);
  return <section className="card" aria-label="个人业绩"><h2>个人业绩 <InfoTip label="个人业绩口径" text="合计等于直播间料价加代购费，再加私推料价。跑单和换料取消的旧单不计入，换料新单归新开单日。业绩跟开单时的客服，换账号不改旧单。" /></h2>
    <div className="commerce-kpis fill-performance-kpis">
      <div className="fill-hero"><small>直播间成交</small><strong>¥{centsToYuan(result.liveCents)}</strong></div>
      <div><small>客服私推</small><strong>¥{centsToYuan(result.privateCents)}</strong></div>
      <div><small>跑单／换料冲抵</small><strong>¥{centsToYuan(rows.filter(order=>order.cancelled).reduce((total,order)=>total+order.materialCents+order.feeCents,0))}</strong></div>
    </div>
    <div className="commerce-list">{rows.map(order=>{
      const customer=state.customers.find(item=>item.id===order.customerId);
      return <button type="button" key={order.id} className="commerce-record secondary" onClick={()=>onOpen(order.customerId)}>
        <span><strong>{customer?.name||"客户"}</strong><small>{order.businessDate} · {order.id}</small><small>{order.channel==="private"?"客服私推":"直播间开单"}{order.performanceTeamName?` · ${order.performanceTeamName}`:""}{order.cancelled?" · 已冲抵":""}</small></span>
        <span className="commerce-amount">¥{centsToYuan(effectiveOrderCents(order))}<small>查看档案 →</small></span>
      </button>;
    })}</div>
    {!rows.length && <p className="notice">还没有记在这位客服名下的开单。</p>}
  </section>;
}

const afterLabels: Record<keyof AfterSaleFields, string> = { orderRef: "关联订单编号", customerCode: "客户ID", personaName: "人设 / 主页", personaCode: "人设ID", liveRoomCode: "直播间编号", hostName: "对应主播", operatorName: "经办客服姓名", note: "备注", chargeLabel: "客户收费名称", chargeCny: "客户收费 · 人民币", paidAmount: "本次实收", paidCurrency: "实收币种", channel: "收款账户 / 付款方式", paymentDate: "付款日期", shippedOn: "发货日期", businessDate: "费用发生日期" };
const freshExpense = (): AfterSaleExpense => ({ label: "", category: "", amountCny: "", counterparty: "" });
function PreviewFields({ fields, labels }: { fields: Record<string, string | undefined>; labels: Record<string, string> }) {
  return <dl className="fill-preview-fields">{Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{value}</dd></div>)}</dl>;
}


function AfterSalesFill({ today, operator, registeredRoom }: { today: string; operator: string; registeredRoom?: { name: string; host: string } }) {
  const [form, setForm] = useState(() => ({...emptyAfterSale(), operatorName:operator})), [expenses, setExpenses] = useState<AfterSaleExpense[]>([]), [reviewed, setReviewed] = useState(false);
  const dirty = Object.entries(form).some(([key, value]) => !!value && (key !== "operatorName" || value !== operator)) || expenses.length > 0, totals = afterSaleTotals(form, expenses);
  const example = `人设：演示主页甲\n客服：演示客服甲\n客户：demo_customer_A\n卖价：600人民币\n实收：600人民币\n付款方式：演示支付宝账户\n付款日期：${today}\n备注：直播间\n发货日期：${today}\n关公：400人民币\n证书支出：6元\n盒子支出：9元\n运费支出：30元\n合计：445元`;
  const patchExpense = (index: number, patch: Partial<AfterSaleExpense>) => setExpenses(expenses.map((e, i) => i === index ? { ...e, ...patch } : e));
  const input = (key: keyof AfterSaleFields, type = "text", required = true) => <Field key={key} label={afterLabels[key]}><input required={required} type={type} max={type === "date" ? today : undefined} inputMode={key === "chargeCny" || key === "paidAmount" ? "decimal" : undefined} pattern={key === "chargeCny" || key === "paidAmount" ? "[0-9]{1,12}(\\.[0-9]{1,2})?" : undefined} maxLength={128} value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>;
  return <div className="card"><h2>售后费用填报</h2><ReportTextImport name="售后费用" example={example} dirty={dirty} parse={text => parseAfterSaleText(text, today)} preview={r => <><PreviewFields fields={r.fields} labels={afterLabels} /><ul>{r.expenses.map((e, i) => <li key={i}>{e.label}：¥{e.amountCny} · {expenseLabels[e.category] || "费用类别待确认"}</li>)}</ul><p>成本合计 ¥{afterSaleTotals(r.fields, r.expenses).cost === null ? "—" : signedMoney(afterSaleTotals(r.fields, r.expenses).cost!)}{afterSaleTotals(r.fields, r.expenses).difference !== null ? ` · 本笔差额 ¥${signedMoney(afterSaleTotals(r.fields, r.expenses).difference!)}` : ""}</p></>} onApply={r => { setForm(f => ({ ...f, ...r.fields })); setExpenses(r.expenses); setReviewed(false); }} />
    <form onSubmit={e => { e.preventDefault(); setReviewed(true); }} onChange={() => setReviewed(false)}><h3>关联客户与订单</h3><p className="notice">填写原订单编号，避免同一客户多笔订单串单；演示不自动匹配或生成原订单。人设与直播间不作固定搭配。</p><div className="grid two">{(["orderRef", "customerCode", "personaName", "personaCode", "liveRoomCode", "hostName", "operatorName"] as const).filter(key => !registeredRoom || key !== "liveRoomCode" && key !== "hostName").map(k => input(k))}{registeredRoom && <Field label="主播 / 直播间"><input readOnly value={registeredRoom.host + " · " + registeredRoom.name} /><small className="hint">按接待小组绑定；正式编号待补，当前仅试填。</small></Field>}{input("businessDate", "date")}</div>
      <h3>客户收费与本次收款</h3><p className="notice">客户收费与公司实际成本分别录入。此处新增售后应收，不重复计入原开单营业额。实收不代表第三方已结算给公司。</p><div className="grid two">{input("chargeLabel")}{input("chargeCny")}{input("paidAmount", "text", false)}<Field label="实收币种"><select required={!!form.paidAmount} value={form.paidCurrency} onChange={e => setForm({ ...form, paidCurrency: e.target.value as AfterSaleFields["paidCurrency"] })}><option value="">请选择币种</option>{Object.entries(currencies).map(([key, label]) => <option key={key} value={key}>{label}（{key}）</option>)}</select></Field>{input("channel", "text", !!form.paidAmount)}{input("paymentDate", "date", !!form.paidAmount)}</div>
      <h3>公司成本</h3><p className="notice">客服登记业务费用；实际付款、扣点及第三方结汇由财务登记。商品名「关公」无法决定费用类型，请选择真实类别。</p>{expenses.map((expense, index) => <fieldset key={index} className="fill-line"><legend>费用 {index + 1}</legend><div className="grid two"><Field label="商品 / 费用名称"><input required maxLength={128} value={expense.label} onChange={e => patchExpense(index, { label: e.target.value })} /></Field><Field label="费用类别"><select required value={expense.category} onChange={e => patchExpense(index, { category: e.target.value })}><option value="">请确认真实费用类别</option>{Object.entries(expenseLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field><Field label="成本 · 人民币"><input required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" value={expense.amountCny} onChange={e => patchExpense(index, { amountCny: e.target.value })} /></Field><Field label="服务提供方 / 商家（可后补）"><input maxLength={128} value={expense.counterparty} onChange={e => patchExpense(index, { counterparty: e.target.value })} /></Field></div><button type="button" className="secondary" onClick={() => setExpenses(expenses.filter((_, i) => i !== index))}>移除此项</button></fieldset>)}
      <button type="button" className="secondary" disabled={expenses.length >= 50} onClick={() => setExpenses([...expenses, freshExpense()])}>＋ 添加费用</button><div className="fill-totals"><span>客户收费 <strong>{cents(form.chargeCny) !== null ? `¥${form.chargeCny}` : "—"}</strong></span><span>公司成本 <strong>{totals.cost !== null ? `¥${signedMoney(totals.cost)}` : "—"}</strong></span><span>本笔差额 <strong>{totals.difference !== null ? `¥${signedMoney(totals.difference)}` : "—"}</strong></span></div><p className="notice">差额＝客户收费－已填公司成本，仅供本笔业务核对；费用未补齐时不是最终利润，也不反映实际付款状态。</p>
      <h3>发货信息</h3><div className="grid two">{input("shippedOn", "date", false)}</div><Field label="备注"><textarea maxLength={500} value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></Field><button type="button" onClick={e => { if (e.currentTarget.form?.reportValidity()) setReviewed(true); }}>检查试填内容（不保存）</button>{reviewed && <p role="status">基础必填项已填写，请核对订单关联和各项金额；演示未保存。</p>}
    </form></div>;
}
