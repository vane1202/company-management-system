import ReimbursementWorkspace from "./demo/ReimbursementWorkspace";
import WarehouseWorkspace from "./demo/WarehouseWorkspace";
import DailyOperatingExpenses from "./demo/DailyOperatingExpenses";
import { useEffect, useState, type ReactNode } from "react";
import { api, type FinancePayment } from "./api";
import { CompanyPayments } from "./CompanyPayments";
import { PaidPerformance } from "./PaidPerformance";
import { AdAccountsWorkspace } from "./AdAccountsWorkspace";
import { currencies, purposeLabels } from "./commerceUi";
import { DashboardIcon } from "./DashboardIcon";
import { toErrorMessage } from "./errors";
import { FinanceLedgerWorkspace } from "./FinanceWorkspace";
import { CurrencySelect, Field } from "./OrderWorkspace";

import CommissionPanel from "./demo/CommissionPanel";
import {FinanceWorkbenchHome} from "./demo/RoleWorkbenches";
import "./finance-menu.css";

type Work = "reimbursement" | "warehouse" | "home" | "receipts" | "settlement" | "later" | "material" | "other" | "commission" | "dailyExpenses" | "ads" | "paidVerification";
const demo = import.meta.env.MODE === "demo";

export function FinanceDesk({ today, onOpenSalary, section, active:isActive=true }: { today: string; onOpenSalary?: () => void; section?: 'finance'|'financeOut'; active?:boolean }) {
  const [work, setWork] = useState<Work>("home");
  useEffect(()=>{if(!section||!isActive)return;const requested=sessionStorage.getItem('cms-demo-finance-task');sessionStorage.removeItem('cms-demo-finance-task');const allowed=section==='finance'?['receipts','settlement','later','paidVerification']:['reimbursement','warehouse','material','other','commission','dailyExpenses','ads'];setWork(allowed.includes(requested||'')?requested as Work:'home');},[section,isActive]);
  const [payments, setPayments] = useState<FinancePayment[] | null>(null);
  const [error, setError] = useState("");
  const [refreshTick,setRefreshTick]=useState(0);
  useEffect(() => {
    let live = true;
    setPayments(null);setError("");
    api.finance().then(data => { if (live) setPayments(data.payments); }).catch(err => { if (live) setError(toErrorMessage(err)); });
    return () => { live = false; };
  }, [refreshTick]);
  const active = payments?.filter(payment => !payment.voided_at) ?? [];
  const immediate = active.filter(payment => !payment.after_sale_charge_id && payment.purpose !== "balance");
  const balances = active.filter(payment => !payment.after_sale_charge_id && payment.purpose === "balance");
  const later = active.filter(payment => !!payment.after_sale_charge_id);
  if (demo && work === "reimbursement") return <ReimbursementWorkspace today={today} onBack={()=>setWork("home")}/>;
  if (work === "warehouse") return <WarehouseWorkspace today={today} finance onBack={()=>setWork("home")}/>;
  if (work === "settlement") return <WorkFrame title="第三方结算" onBack={() => setWork("home")}><FinanceLedgerWorkspace today={today} heading="第三方结算" hideCompanions /></WorkFrame>;
  if (work === "material") return <WorkFrame title="料子货款结算" onBack={() => setWork("home")}><p className="notice">此处查看料子供货成本与原付款台账；新结账单由库房提交，在「库房结账」中审核和登记付款。客户已付款不在这里抵扣。</p><CompanyPayments today={today} readOnly={demo} categories={["goods", "sourcing"]} heading="翡翠料子货款" /></WorkFrame>;
  if (demo && work === "ads") return <WorkFrame title="广告充值" onBack={() => setWork("home")}><AdAccountsWorkspace today={today} readOnly={false} /></WorkFrame>;
  if (work === "other") return <WorkFrame title={demo?"加工与发货台账":"其他财务事项"} onBack={() => setWork("home")}><CompanyPayments today={today} readOnly={demo} excludeCategories={["goods", "sourcing"]} heading="加工、证书、包装和运费" />{!demo&&<><PaidPerformance today={today} readOnly={false} /><AdAccountsWorkspace today={today} readOnly={false} /></>}</WorkFrame>;
  if (work === "receipts") return <WorkFrame title={demo ? "订单收款" : "订单收款核对"} onBack={() => setWork("home")}><p className="notice">实时收款指开单当时收到的定金或全款。尾款按约定日后另记。客户付给公司或第三方后，都减少客户欠款；第三方扣点和汇差不向客户追收。</p><ReceiptLists error={error} groups={[{ title: "实时收款", rows: immediate }, { title: "尾款", rows: balances }]} /><ReceiptDraft today={today} mode="order" /></WorkFrame>;
  if (work === "later") return <WorkFrame title={demo ? "后续费用收款" : "后续费用核对"} onBack={() => setWork("home")}><p className="notice">设计、雕刻、配货等费用向客户另收，不计入原开单营业额。公司支付给加工方或商家的成本在料子货款和其他付款里登记。</p><ReceiptLists error={error} groups={[{ title: "已登记的后续收款", rows: later }]} /><ReceiptDraft today={today} mode="later" /></WorkFrame>;
  if (demo && work === "commission") return <WorkFrame title="业绩提成" onBack={() => setWork("home")}><CommissionPanel today={today} /></WorkFrame>;
  if (demo && work === "paidVerification") return <WorkFrame title="已付款业绩核定" onBack={() => setWork("home")}><PaidPerformance today={today} readOnly={false} /></WorkFrame>;
  if (demo && work === "dailyExpenses") return <WorkFrame title="日常运营费用" onBack={() => setWork("home")}><DailyOperatingExpenses today={today}/></WorkFrame>;
  if(demo&&section) {
    const groups: {title: string; items: [Work|'salary',string,string,Parameters<typeof DashboardIcon>[0]['name']][]}[] = section==='finance'
      ? [{title:'收款业务',items:[['receipts','订单收款','定金、全款与尾款','finance'],['settlement','第三方结算','代收扣点、结汇与到账','refresh'],['later','售后费用收款','设计、雕刻与接待收费','orders'],['paidVerification','已付款业绩核定','核定客户已付款业绩','assessment']]}]
      : [{title:'待付款处理',items:[['warehouse','库房结账','账单审核与实际付款','financeOut'],['reimbursement','费用报销','员工报销核对与付款（不计入运营成本）','orders']]},
         {title:'业务成本与广告',items:[['material','料子货款台账','供货成本与付款记录','modules'],['other','加工与发货台账','加工、证书、包装与运费','reportHistory'],['ads','广告充值','预存充值、实际付款与余额','ops']]},
         {title:'日常费用与薪酬',items:[['dailyExpenses','日常运营费用','房租、水电、接待与其他（BOSS 运营成本来源）','home'],['salary','员工工资核算','基本工资、提成、奖金与扣款','salaries'],['commission','业绩提成','按订单净利润核算，结果登记到工资','assessment']]}];
    return <div className="finance-desk fh-section finance-menu"><header className="commerce-heading"><h1>{section==='finance'?'收款与结算':'付款与工资'}</h1></header>
      {groups.map(group=><section className="finance-menu-group" key={group.title} aria-label={group.title}>
        {section==='financeOut'&&<h2>{group.title}</h2>}
        <div className={`finance-menu-grid${group.items.length===4?' finance-menu-grid-four':''}`}>{group.items.map(([key,title,note,icon])=><button className="finance-menu-item" type="button" key={key} onClick={()=>key==='salary'?onOpenSalary?.():setWork(key)}>
          <span className="finance-menu-icon"><DashboardIcon name={icon}/></span><span className="finance-menu-copy"><strong>{title}</strong><small>{note}</small></span><span className="finance-menu-arrow" aria-hidden="true">›</span>
        </button>)}</div>
      </section>)}
    </div>;
  }
  if(demo) return <FinanceWorkbenchHome today={today} payments={payments} error={error} onOpen={setWork} onSalary={()=>onOpenSalary?.()} onRetry={()=>setRefreshTick(t=>t+1)}/>;
  return <div className="role-home finance-desk"><header className="role-home-heading"><div><p className="eyebrow">录入与核对</p><h1>财务工作台</h1><p>先处理待登记的款项，再核对已经入账的记录。</p></div><button type="button" className="secondary overview-refresh" onClick={() => setRefreshTick(t => t + 1)}>刷新</button></header>
    {error && <div className="overview-error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => setRefreshTick(t => t + 1)}>重新读取</button></div>}
    <section className="role-home-panel"><div className="role-action-list finance-work-list">
      <button type="button" className="role-home-action" onClick={() => onOpenSalary?.()}><span><strong>基本工资</strong><small>按客服、拍剪、运营等工种维护月基本工资，并核对提成、奖金和扣款。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("receipts")}><span><strong>订单收款核对</strong><small>实时收款 {payments ? immediate.length : "—"} 笔 · 尾款 {payments ? balances.length : "—"} 笔。核对客服已登记的定金、全款和尾款。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("settlement")}><span><strong>第三方结算</strong><small>核对代收货款，登记扣点、结汇和人民币到账。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("later")}><span><strong>后续费用核对</strong><small>已登记 {payments ? later.length : "—"} 笔。核对设计、雕刻、配货等后续费用记录。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("warehouse")}><span><strong>库房结账</strong><small>审核库房账单，登记分次付款与结清。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("material")}><span><strong>料子货款结算</strong><small>核对直播间售出翡翠的供货款，登记付给供货方的付款。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("other")}><span><strong>其他财务事项</strong><small>加工、证书、包装、运费，以及广告预存和提成核定。</small></span><DashboardIcon name="arrow" /></button>
    </div></section>
  </div>;
}

function WorkFrame({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return <div className="commerce-workspace finance-desk"><header className="commerce-heading"><div><p className="eyebrow">财务工作台</p><h1>{title}</h1></div><button type="button" className="secondary" onClick={onBack}>返回</button></header>{children}</div>;
}

function ReceiptLists({ error, groups }: { error: string; groups: { title: string; rows: FinancePayment[] }[] }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  return <>{groups.map(group => <section className="card" key={group.title}><h2>{group.title}</h2>{!group.rows.length && <p>当前没有待核对的记录。</p>}{group.rows.map(payment => <article className="commerce-record" key={payment.id}><span><strong>{payment.customer_label} · {payment.order_ref}</strong><small>{payment.payment_date} · {purposeLabels[payment.purpose] || "收款"} · {payment.channel}</small><small>{payment.live_room_code || "直播间待补"} · {payment.operator_name || "客服待补"}</small></span><span className="commerce-amount">{payment.amount} {payment.currency}<small>{payment.third_party ? `待结算 ${payment.pendingAmount}` : "直接到账"}</small></span></article>)}</section>)}</>;
}

function ReceiptDraft({ today, mode }: { today: string; mode: "order" | "later" }) {
  const [form, setForm] = useState({ orderRef: "", customer: "", purpose: mode === "later" ? "full" : "deposit", amount: "", currency: "CNY" as "CNY" | "TWD" | "USD", channel: "", paymentDate: today, thirdParty: false, reference: "", chargeLabel: "" });
  const [checked, setChecked] = useState(false);
  if (!demo) return <p className="notice">正式后台里，这些收款仍写入原订单收款记录。财务账号的直接保存接口还没有切换，当前页先用于核对。</p>;
  return <form className="card" onChange={()=>setChecked(false)} onSubmit={event => { event.preventDefault(); setChecked(true); }}><h2>{mode === "later" ? "登记后续收款" : "登记实时收款或尾款"}</h2><p className="notice">演示只核对填写内容，刷新后清空，不写入正式账，也不改变上方已有流水。</p><div className="grid two"><Field label="订单编号"><input required maxLength={64} value={form.orderRef} onChange={event => { setForm({ ...form, orderRef: event.target.value }); setChecked(false); }} /></Field><Field label="客户"><input required maxLength={128} value={form.customer} onChange={event => { setForm({ ...form, customer: event.target.value }); setChecked(false); }} /></Field>{mode === "later" && <Field label="收费项目"><input required maxLength={128} placeholder="设计费、雕刻费或配货费" value={form.chargeLabel} onChange={event => { setForm({ ...form, chargeLabel: event.target.value }); setChecked(false); }} /></Field>}{mode === "order" && <Field label="收款性质"><select value={form.purpose} onChange={event => { setForm({ ...form, purpose: event.target.value }); setChecked(false); }}><option value="deposit">实时收款 · 定金</option><option value="full">实时收款 · 全款</option><option value="balance">尾款</option></select></Field>}<Field label="收款日期"><input required type="date" max={today} value={form.paymentDate} onChange={event => setForm({ ...form, paymentDate: event.target.value })} /></Field><Field label="币种"><CurrencySelect value={form.currency} onChange={currency => { setForm({ ...form, currency, thirdParty: currency !== "CNY" }); setChecked(false); }} /></Field><Field label={`本次收到 · ${currencies[form.currency]}`}><input required inputMode="decimal" value={form.amount} onChange={event => { setForm({ ...form, amount: event.target.value }); setChecked(false); }} /></Field><Field label="收款账户"><input required maxLength={128} value={form.channel} onChange={event => setForm({ ...form, channel: event.target.value })} /></Field><Field label="流水号"><input maxLength={128} value={form.reference} onChange={event => setForm({ ...form, reference: event.target.value })} /></Field></div><label className="commerce-check"><input type="checkbox" checked={form.thirdParty} onChange={event => setForm({ ...form, thirdParty: event.target.checked })} />由第三方代收，尚待结算</label><button type="button" onClick={event=>{if(event.currentTarget.form?.reportValidity())setChecked(true);}}>检查试填内容（不保存）</button>{checked && <p role="status">已核对：{form.orderRef} · {form.customer}{form.chargeLabel ? ` · ${form.chargeLabel}` : ""} · {purposeLabels[form.purpose] || "收款"} {form.amount} {form.currency}。演示未保存。</p>}</form>;
}
