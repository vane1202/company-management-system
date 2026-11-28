import { PaymentReview } from "./PaymentReview";
import ReimbursementWorkspace from "./demo/ReimbursementWorkspace";
import WarehouseWorkspace from "./demo/WarehouseWorkspace";
import DailyOperatingExpenses from "./demo/DailyOperatingExpenses";
import { useEffect, useState, type ReactNode } from "react";
import { api, type FinancePayment } from "./api";
import { CompanyPayments } from "./CompanyPayments";
import { PaidPerformance } from "./PaidPerformance";
import { AdAccountsWorkspace } from "./AdAccountsWorkspace";
import { purposeLabels } from "./commerceUi";
import { DashboardIcon } from "./DashboardIcon";
import { toErrorMessage } from "./errors";
import { FinanceLedgerWorkspace } from "./FinanceWorkspace";
import { InfoTip } from "./InfoTip";

import CommissionPanel from "./demo/CommissionPanel";
import { useFinanceBadges, type FinanceBadges } from "./demo/financeBadges";
import {FinanceWorkbenchHome} from "./demo/RoleWorkbenches";
import "./finance-menu.css";

type Work = "reimbursement" | "warehouse" | "home" | "receipts" | "settlement" | "later" | "material" | "other" | "commission" | "dailyExpenses" | "ads" | "paidVerification";
const demo = import.meta.env.MODE === "demo";

const workLabels: Record<Exclude<Work, "home">, string> = {
  receipts: "收款到账核对",
  settlement: "第三方结算",
  later: demo ? "售后费用收款" : "后续费用核对",
  paidVerification: "已付款业绩核定",
  warehouse: "库房结账",
  reimbursement: "费用报销",
  material: demo ? "料子货款台账" : "料子货款结算",
  other: demo ? "加工与发货台账" : "其他财务事项",
  ads: "广告充值",
  dailyExpenses: "日常运营费用",
  commission: "业绩提成"
};

function formatMoneyWithCurrency(amount: string, currency: string): string {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `${amount} ${currency}`;
  const formatted = num.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency === "CNY" ? `¥${formatted}` : `${formatted} ${currency}`;
}

export function FinanceDesk({ today, onOpenSalary, section, active:isActive=true, onSubViewChange }: { today: string; onOpenSalary?: () => void; section?: 'finance'|'financeOut'; active?:boolean; onSubViewChange?: (sub: { label: string; onBack?: () => void } | null) => void }) {
  const defaultWork: Work = section ? (section === "finance" ? "receipts" : "warehouse") : "home";
  const [work, setWork] = useState<Work>(defaultWork);
  useEffect(()=>{
    if(!section||!isActive)return;
    const requested=sessionStorage.getItem('cms-demo-finance-task');
    sessionStorage.removeItem('cms-demo-finance-task');
    const allowed=section==='finance'?['receipts','settlement','later','paidVerification']:['reimbursement','warehouse','material','other','commission','dailyExpenses','ads'];
    if (requested && allowed.includes(requested)) {
      setWork(requested as Work);
    } else if (section) {
      setWork(prev => allowed.includes(prev) ? prev : (section === 'finance' ? 'receipts' : 'warehouse'));
    } else {
      setWork('home');
    }
  },[section,isActive]);
  useEffect(() => {
    if (!onSubViewChange) return;
    if (!isActive || work === "home") {
      onSubViewChange(null);
      return;
    }
    onSubViewChange({ label: workLabels[work], onBack: section ? undefined : () => setWork("home") });
    return () => onSubViewChange(null);
  }, [isActive, work, onSubViewChange, section]);
  const inlineBack = onSubViewChange || section ? undefined : () => setWork("home");
  const [payments, setPayments] = useState<FinancePayment[] | null>(null);
  const [error, setError] = useState("");
  const [refreshTick,setRefreshTick]=useState(0);
  const badges=useFinanceBadges(isActive&&(section==="financeOut"||!section),today.slice(0,7),refreshTick);
  useEffect(() => {
    let live = true;
    setPayments(null);setError("");
    api.finance().then(data => { if (live) setPayments(data.payments); }).catch(err => { if (live) setError(toErrorMessage(err)); });
    return () => { live = false; };
  }, [refreshTick]);
  const active = payments?.filter(payment => !payment.voided_at) ?? [];
  const later = active.filter(payment => !!payment.after_sale_charge_id);
  const sectionTabs: { id: Work | "salary"; label: string }[] = section === "finance"
    ? [
        { id: "receipts", label: "收款到账核对" },
        { id: "settlement", label: "第三方结算" },
        { id: "later", label: "售后费用收款" },
        { id: "paidVerification", label: "已付款业绩核定" }
      ]
    : [
        { id: "warehouse", label: "库房结账" },
        { id: "reimbursement", label: "费用报销" },
        { id: "material", label: "料子货款台账" },
        { id: "other", label: "加工与发货台账" },
        { id: "ads", label: "广告充值" },
        { id: "dailyExpenses", label: "日常运营费用" },
        { id: "commission", label: "业绩提成" },
        { id: "salary", label: "员工工资核算" }
      ];
  function selectProject(id: Work | "salary") {
    if (id === "salary") {
      onOpenSalary?.();
      return;
    }
    setWork(id);
  }

  const wrapWithTabs = (content: ReactNode) => {
    if (!section) return content;
    return <div className="finance-tabbed-shell">
      <nav className="finance-section-tabs" role="tablist" aria-label={section === "finance" ? "收款与结算模块" : "付款与工资模块"}>
        {sectionTabs.map(tab => {
          const activeTab = work === tab.id;
          const badge = badges[tab.id as keyof FinanceBadges];
          return <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab} aria-pressed={activeTab}
            className={activeTab ? "selected" : ""}
            onClick={() => selectProject(tab.id)}
          >
            <span>{tab.label}</span>
            {badge?.attention && <em className="finance-tab-badge">{badge.text}</em>}
          </button>;
        })}
      </nav>
      {content}
    </div>;
  };
  if (work === "reimbursement") return wrapWithTabs(<ReimbursementWorkspace today={today} onBack={inlineBack}/>);
  if (work === "warehouse") return wrapWithTabs(<WarehouseWorkspace today={today} finance onBack={inlineBack}/>);
  if (work === "settlement") return wrapWithTabs(<FinanceLedgerWorkspace today={today} heading="收款与结算" hideCompanions onBack={inlineBack} />);
  if (work === "material") return wrapWithTabs(<WorkFrame title="料子货款结算" tip="此处查看料子供货成本与原付款台账；新结账单由库房提交，在「库房结账」中审核和登记付款。客户已付款不在这里抵扣。" onBack={inlineBack}><CompanyPayments today={today} readOnly={demo} categories={["goods", "sourcing"]} heading="翡翠料子货款" /></WorkFrame>);
  if (work === "ads") return wrapWithTabs(<WorkFrame title="广告充值" onBack={inlineBack}><AdAccountsWorkspace today={today} readOnly={false} /></WorkFrame>);
  if (work === "other") return wrapWithTabs(<WorkFrame title={demo?"加工与发货台账":"其他财务事项"} onBack={inlineBack}><CompanyPayments today={today} readOnly={demo} excludeCategories={["goods", "sourcing"]} heading="加工、证书、包装和运费" />{!demo&&<><PaidPerformance today={today} readOnly={false} /></>}</WorkFrame>);
  if (work === "receipts") return wrapWithTabs(<WorkFrame title="收款到账核对" tip="客服登记收款并上传付款凭证。财务核对流水后填实际到账人民币；未到账则退回客服。" onBack={inlineBack}>
    <PaymentReview today={today} payments={payments} error={error} onChanged={() => setRefreshTick(tick => tick + 1)} />
  </WorkFrame>);
  if (work === "later") return wrapWithTabs(<WorkFrame title="后续费用记录" tip="售后收款也由客服登记。这里只查看已登记的售后款，核对请回「收款到账核对」。" onBack={inlineBack}>
    <ReceiptLists error={error} groups={[{ title: "已登记的后续收款", rows: later }]} />
  </WorkFrame>);
  if (work === "commission") return wrapWithTabs(<WorkFrame title="业绩提成" tip="按订单净利润核算，结果登记到月度工资单。" onBack={inlineBack}><CommissionPanel today={today} /></WorkFrame>);
  if (work === "paidVerification") return wrapWithTabs(<WorkFrame title="已付款业绩核定" onBack={inlineBack}><PaidPerformance today={today} readOnly={false} /></WorkFrame>);
  if (work === "dailyExpenses") return wrapWithTabs(<WorkFrame title="日常运营费用" tip="登记房租、水电、接待与其他日常开支，作为 BOSS 端运营成本数据来源。" onBack={inlineBack}><DailyOperatingExpenses today={today}/></WorkFrame>);
  if(demo) return <FinanceWorkbenchHome today={today} payments={payments} error={error} onOpen={setWork} onSalary={()=>onOpenSalary?.()} badges={badges} onRetry={()=>setRefreshTick(t=>t+1)}/>;
  return <div className="role-home finance-desk"><header className="role-home-heading"><div><p className="eyebrow">录入与核对</p><h1>财务工作台</h1><p>先处理待登记的款项，再核对已经入账的记录。</p></div><button type="button" className="secondary overview-refresh" onClick={() => setRefreshTick(t => t + 1)}>刷新</button></header>
    {error && <div className="overview-error" role="alert"><p>{error}</p><button type="button" className="secondary" onClick={() => setRefreshTick(t => t + 1)}>重新读取</button></div>}
    <section className="role-home-panel"><div className="role-action-list finance-work-list">
      <button type="button" className="role-home-action" onClick={() => onOpenSalary?.()}><span><strong>基本工资</strong><small>按客服、拍剪、运营等工种维护月基本工资，并核对提成、奖金和扣款。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("receipts")}><span><strong>收款到账核对</strong><small>待确认 {payments ? payments.filter(payment => !payment.voided_at && payment.verify_status === "pending").length : "—"} 笔。看凭证核流水，确认实际到账或退回客服。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("settlement")}><span><strong>第三方结算</strong><small>核对代收货款，登记扣点、结汇和人民币到账。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("later")}><span><strong>后续费用核对</strong><small>已登记 {payments ? later.length : "—"} 笔。核对设计、雕刻、配货等后续费用记录。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("warehouse")}><span><strong>库房结账</strong><small>审核库房账单，登记分次付款与结清。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("material")}><span><strong>料子货款结算</strong><small>核对直播间售出翡翠的供货款，登记付给供货方的付款。</small></span><DashboardIcon name="arrow" /></button>
      <button type="button" className="role-home-action" onClick={() => setWork("other")}><span><strong>其他财务事项</strong><small>加工、证书、包装、运费，以及广告预存和提成核定。</small></span><DashboardIcon name="arrow" /></button>
    </div></section>
  </div>;
}

function WorkFrame({ title, tip, onBack, actions, children }: { title: string; tip?: string; onBack?: () => void; actions?: ReactNode; children: ReactNode }) {
  return <div className="commerce-workspace finance-desk"><header className="commerce-heading"><div><h1>{title}{tip && <InfoTip label={`${title}说明`} text={tip} />}</h1></div>{(actions || onBack) && <div className="actions">{actions}{onBack && <button type="button" className="secondary" onClick={onBack}>返回</button>}</div>}</header>{children}</div>;
}

function ReceiptLists({ error, groups }: { error: string; groups: { title: string; rows: FinancePayment[] }[] }) {
  if (error) return <p className="error" role="alert">{error}</p>;
  return <>{groups.map(group => <section className="card finance-receipt-card" key={group.title}>
    <header className="commerce-line"><h2>{group.title}</h2><span className="finance-receipt-count">{group.rows.length} 笔</span></header>
    {!group.rows.length ? <p>当前没有待核对的记录。</p> : <div className="finance-receipt-table">
      <div className="finance-receipt-head" aria-hidden="true"><span>客户 / 订单</span><span>日期 / 性质</span><span>收款渠道 / 归属</span><span>金额 / 结算状态</span></div>
      {group.rows.map(payment => <article className="finance-receipt-row" key={payment.id}>
        <div><strong>{payment.customer_label}</strong><small>{payment.order_ref}</small></div>
        <div><span>{payment.payment_date}</span><small>{purposeLabels[payment.purpose] || "收款"}</small></div>
        <div><span>{payment.channel}</span><small>{payment.live_room_code || "直播间待补"} · {payment.operator_name || "客服待补"}</small></div>
        <div className="finance-receipt-amount"><strong>{formatMoneyWithCurrency(payment.amount, payment.currency)}</strong><small>{payment.third_party ? `待结算 ${formatMoneyWithCurrency(payment.pendingAmount, payment.currency)}` : "直接到账"}</small></div>
      </article>)}
    </div>}
  </section>)}</>;
}
