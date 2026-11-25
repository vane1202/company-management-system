import { CompanyPayments } from "./CompanyPayments";
import {PaidPerformance} from './PaidPerformance';
import { AdAccountsWorkspace } from "./AdAccountsWorkspace";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api, type Currency, type FinanceData } from "./api";
import { currencies, cents, money, submissionKey } from "./commerceUi";
import { CurrencySelect, Field } from "./OrderWorkspace";
import { toErrorMessage } from "./errors";
import { InfoTip } from "./InfoTip";
import { toast } from "./Toast";
import type { CashView } from "./cashNavigation";
import "./finance-menu.css";

const REFRESH_AFTER_SAVE_FAILED="已保存，但列表刷新失败，请点刷新";
const DemoBossCashBoard=import.meta.env.MODE==='demo'?lazy(()=>import('./demo/BossCashBoard')):null;

export function FinanceWorkspace({today,readOnly=false,cashView}:{today:string;readOnly?:boolean;cashView?:CashView}) {
  return readOnly&&DemoBossCashBoard?<Suspense fallback={<p role="status">正在读取收款与到账…</p>}><DemoBossCashBoard today={today} context={cashView} financialDetail={(query,range)=><FinanceLedgerWorkspace today={today} readOnly initialQuery={query} initialRange={range} initialPendingOnly={false}/>} /></Suspense>:<FinanceLedgerWorkspace today={today} readOnly={readOnly}/>;
}

export function FinanceLedgerWorkspace({today,readOnly=false,initialQuery='',initialRange,initialPendingOnly=true,heading,hideCompanions=false,onBack}:{today:string;readOnly?:boolean;initialQuery?:string;initialRange?:{from:string;to:string};initialPendingOnly?:boolean;heading?:string;hideCompanions?:boolean;onBack?:()=>void}) {
  const [data,setData]=useState<FinanceData|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [filters,setFilters]=useState({from:initialRange?.from??"",to:initialRange?.to??"",query:initialQuery,currency:"",channel:"",pendingOnly:initialPendingOnly});
  const [selected,setSelected]=useState<Record<string,{foreignAmount:string;netCny:string}>>({});
  const [form,setForm]=useState({reference:"",channel:"",currency:"TWD" as Currency,settledOn:today,feeAmount:"0.00",feeCurrency:"TWD" as Currency,feePercent:"",fxRate:"",netCny:"",note:""});
  const [voidId,setVoidId]=useState(""),[reason,setReason]=useState("");
  const [settleOpen,setSettleOpen]=useState(false);
  const [ledgerTab,setLedgerTab]=useState<"payments"|"settlements">("payments");
  const key=useRef(submissionKey());
  useEffect(()=>{const close=(event:KeyboardEvent)=>{if(event.key==="Escape"&&!busy){setSettleOpen(false);setVoidId("");}};document.addEventListener("keydown",close);return()=>document.removeEventListener("keydown",close);},[busy]);
 async function load(){const d=await api.finance();setData(d);}
  useEffect(()=>{let active=true;api.finance().then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));});return()=>{active=false;};},[]);
  async function action(fn:()=>Promise<unknown>,msg:string){if(busy)return;setBusy(true);setError("");
    try{await fn();}catch(e){const text=toErrorMessage(e,"保存失败");setError(text);toast.error(`财务登记未保存：${text}`);setBusy(false);return;}
    toast.success(msg);
    // 保存已成功；刷新失败单独说明，不误报为保存失败。
    try{await load();}catch{setError(REFRESH_AFTER_SAVE_FAILED);toast.error(REFRESH_AFTER_SAVE_FAILED);}finally{setBusy(false);}}
  async function reload(){if(busy)return;setBusy(true);setError("");try{await load();}catch(e){setError(toErrorMessage(e));}finally{setBusy(false);}}
  const rows=data?.payments.filter(p=>(!filters.pendingOnly||(!p.voided_at&&p.third_party&&cents(p.pendingAmount)!==0n))&&(!filters.from||p.payment_date>=filters.from)&&(!filters.to||p.payment_date<=filters.to)&&(!filters.currency||p.currency===filters.currency)&&(!filters.channel||p.channel===filters.channel)&&`${p.order_ref} ${p.customer_label} ${p.reference} ${p.wechat_id??""} ${p.persona_code??""} ${p.live_room_code??""} ${p.host_name??""} ${p.customer_code??""} ${p.operator_name??""}`.toLowerCase().includes(filters.query.trim().toLowerCase()))??[];

  const candidates=data?.payments.filter(p=>!p.voided_at&&p.third_party&&p.currency===form.currency&&p.channel===form.channel&&cents(p.pendingAmount)!==0n)??[];
  const allocations=Object.entries(selected).map(([paymentId,a])=>({paymentId,...a}));
  const allocValid=allocations.every(a=>cents(a.netCny)!==null);
  const allocCents=allocValid?allocations.reduce((n,a)=>n+(cents(a.netCny)??0n),0n):null;
  const allocationTotal=allocCents!==null?money(allocCents):"—";
  const targetNetCents=cents(form.netCny);
  const diffCents=targetNetCents!==null&&allocCents!==null?targetNetCents-allocCents:null;
  const isBalanced=diffCents!==null&&diffCents===0n&&allocations.length>0;
  const pendingEntries = Object.keys(currencies).flatMap(currency => {
    const amount = data?.summary.pending[currency as Currency];
    return amount != null && cents(amount) !== 0n ? [[currency, amount] as const] : [];
  });
  return <div className="commerce-workspace"><header className="commerce-heading"><div><p className="eyebrow">客户付款 · 第三方结算</p><h1>{heading??(readOnly?"收款与结算":"财务工作台")}<InfoTip label="收款与结算说明" text={`${readOnly?"BOSS 只读查看。":"由财务登记扣点、结汇与人民币到账。"}客户付款已抵扣客户应收，结算扣费和汇差由公司承担。`}/></h1></div><div className="actions">{onBack&&<button type="button" className="secondary" onClick={onBack}>返回</button>}{!readOnly&&data&&<button type="button" disabled={busy} onClick={()=>setSettleOpen(true)}>＋ 登记第三方结算与到账</button>}<button className="secondary" disabled={busy} onClick={()=>void reload()}>{busy?"读取中…":"刷新"}</button></div></header>
    {error&&<p className="error" role="alert">{error}</p>}
    {!data?(error?<section className="card overview-error" role="alert"><p>未能读取财务数据，可点击重试。</p><button type="button" className="secondary" disabled={busy} onClick={()=>void reload()}>{busy?"读取中…":"重新读取"}</button></section>:<section className="card" role="status">正在读取财务数据…</section>):<>
    <div className="fin-kpis">
      <article className="fin-kpi fin-kpi-hero"><small>实际人民币累计流入 <InfoTip label="累计口径" text="人民币流入已扣除结算手续费，不再重复扣费。此处不含旧订单未知收款，也不计算退款流出与利润。"/></small><strong>¥ {data.summary.totalCny}</strong></article>
      <article className="fin-kpi fin-kpi-warn">
        <small>待第三方结算金额 · 原币</small>
        {pendingEntries.length ? <dl className="fin-pending-balances">{pendingEntries.map(([currency, amount]) =>
          <div key={currency}><dt>{currency}</dt><dd>{Number(amount).toLocaleString("zh-CN", {minimumFractionDigits: 2, maximumFractionDigits: 2})}</dd></div>
        )}</dl> : <span>暂无待结算</span>}
      </article>
      <article className="fin-kpi"><small>直接收款</small><strong>¥ {data.summary.directCny}</strong></article>
      <article className="fin-kpi"><small>第三方净到账</small><strong>¥ {data.summary.settledCny}</strong></article>
    </div>
    <div className="fin-tabs" role="tablist" aria-label="财务台账视图">
      <button type="button" role="tab" aria-pressed={ledgerTab==="payments"} onClick={()=>setLedgerTab("payments")}>客户收款流水（{rows.length}）</button>
      <button type="button" role="tab" aria-pressed={ledgerTab==="settlements"} onClick={()=>setLedgerTab("settlements")}>第三方结算记录（{data.settlements.length}）</button>
    </div>
    {ledgerTab==="payments"?<section className="card">
      <div className="fin-toolbar">
        <div className="fin-pills">
          <button type="button" className="fin-pill" aria-pressed={filters.pendingOnly} onClick={()=>setFilters(f=>({...f,pendingOnly:!f.pendingOnly}))}>仅看第三方待结算</button>
        </div>
        <input type="search" placeholder="查找客户 / 订单 / 接待账号 / 流水号" value={filters.query} onChange={e=>setFilters({...filters,query:e.target.value})} style={{maxWidth:280}}/>
      </div>
      <details className="commerce-filters"><summary>更多筛选（付款日期 / 币种 / 账户）</summary><div className="grid two"><Field label="开始日期"><input type="date" max={today} value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></Field><Field label="结束日期"><input type="date" min={filters.from} max={today} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></Field><Field label="币种"><select value={filters.currency} onChange={e=>setFilters({...filters,currency:e.target.value})}><option value="">全部币种</option>{Object.entries(currencies).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></Field><Field label="账户"><select value={filters.channel} onChange={e=>setFilters({...filters,channel:e.target.value})}><option value="">全部账户</option>{[...new Set(data.payments.map(p=>p.channel))].map(c=><option key={c}>{c}</option>)}</select></Field></div></details>
      {!rows.length?<p className="empty-state">当前范围暂无收款流水。</p>:<div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>客户 / 订单</th><th>付款日期 / 账户</th><th>归属信息</th><th>实收金额</th><th>结算状态</th></tr></thead><tbody>{rows.map(p=><tr key={p.id} className={p.voided_at?"is-void":undefined}><td><strong>{p.customer_label}</strong><span className="fin-cell-sub">{p.order_ref}{p.reference?` · ${p.reference}`:""}</span>{p.voided_at&&<span className="fin-cell-sub">已作废：{p.void_reason}</span>}</td><td><span className="fin-num">{p.payment_date}</span><span className="fin-cell-sub">{p.channel}</span></td><td>{p.operator_name||"客服待补"} · {p.live_room_code||"直播间待补"}<span className="fin-cell-sub">{p.wechat_id||"原员工账号"} · {p.persona_name}</span></td><td className="fin-num"><strong>{p.amount} {p.currency}</strong></td><td>{p.voided_at?<span className="fin-badge is-muted">已作废</span>:p.third_party?(cents(p.pendingAmount)===0n?<span className="fin-badge is-jade">已结清</span>:<span className="fin-badge is-gold">待结算 {p.pendingAmount}</span>):<span className="fin-badge is-jade">直接到账</span>}</td></tr>)}</tbody></table></div>}
    </section>:<section className="card">
      {!data.settlements.length?<p className="empty-state">尚未登记结算。</p>:<div className="fin-table-wrap"><table className="fin-table"><thead><tr><th>到账日期 / 流水</th><th>第三方账户 / 原币</th><th>扣费与汇率</th><th>人民币净到账</th><th>分摊明细</th><th>操作</th></tr></thead><tbody>{data.settlements.map(s=><tr key={s.id} className={s.voided_at?"is-void":undefined}><td><span className="fin-num">{s.settled_on}</span><span className="fin-cell-sub">{s.reference}</span></td><td><strong>{s.channel}</strong><span className="fin-cell-sub">原币 {s.currency}</span></td><td className="fin-num">{s.fee_amount} {s.fee_currency}{s.fee_percent!==null?<span className="fin-cell-sub">扣点 {s.fee_percent}%</span>:null}{s.fx_rate?<span className="fin-cell-sub">汇率 {s.fx_rate}</span>:null}</td><td className="fin-num"><strong>¥ {s.net_cny}</strong></td><td>{s.allocations.map(a=><span className="fin-cell-sub" key={a.paymentId}>{data.payments.find(p=>p.id===a.paymentId)?.order_ref??a.paymentId}：{a.foreignAmount} {s.currency} → ¥{a.netCny}</span>)}{s.note&&<span className="fin-cell-sub">备注：{s.note}</span>}</td><td>{s.voided_at?<span className="fin-badge is-muted">已作废：{s.void_reason}</span>:!readOnly&&<button type="button" className="secondary" disabled={busy} onClick={()=>{setVoidId(s.id);setReason("");}}>纠正</button>}</td></tr>)}</tbody></table></div>}
    </section>}
    {!readOnly&&settleOpen&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setSettleOpen(false);}}><div className="fin-drawer-panel fin-drawer-wide" role="dialog" aria-modal="true" aria-label="登记第三方结算与到账"><header className="fin-drawer-head"><h2>登记第三方结算与到账</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setSettleOpen(false)}>关闭</button></header><form className="fin-drawer-body" id="fin-settle-form" onSubmit={e=>{e.preventDefault();const body={...form,allocations};void action(async()=>{await api.financeAction("settlements",{...body,requestKey:key.current(body)});key.current=submissionKey();setSelected({});setForm(f=>({...f,reference:"",netCny:"",note:""}));setSettleOpen(false);},`结算已保存：${body.channel} · 流水 ${body.reference} · 净到账 ¥ ${body.netCny}（${allocations.length} 笔收款），客户已付款金额保持不变`);}}>
      <div className={`fin-reconcile-bar ${isBalanced?"is-balanced":"is-diff"}`} role="status">
        <div className="fin-reconcile-metrics">
          <span>目标净到账：<b>¥ {targetNetCents!==null?money(targetNetCents):"—"}</b></span>
          <span>已勾选分摊（{allocations.length} 笔）：<b>¥ {allocationTotal}</b></span>
          <span>差额：<b>{diffCents!==null?`${diffCents<0n?"-":""}¥ ${money(diffCents<0n?-diffCents:diffCents)}`:"—"}</b></span>
        </div>
        <span className="fin-reconcile-tag">{isBalanced?"已核平":allocations.length===0?"请勾选分摊收款":"尚有差额"}</span>
      </div>
      <p className="notice">先选择同一第三方账户与币种，再分配涉及的客户收款。支持部分结算；每笔分配金额须核对，系统不自动平均分摊。</p>
      <div className="grid two"><Field label="第三方账户"><select required value={form.channel} onChange={e=>{setForm({...form,channel:e.target.value});setSelected({});}}><option value="">请选择账户</option>{[...new Set(data.payments.filter(p=>p.third_party&&!p.voided_at).map(p=>p.channel))].map(c=><option key={c}>{c}</option>)}</select></Field><Field label="原币币种"><CurrencySelect value={form.currency} onChange={v=>{setForm({...form,currency:v,feeCurrency:v});setSelected({});}}/></Field><Field label="公司到账日期"><input required type="date" max={today} value={form.settledOn} onChange={e=>setForm({...form,settledOn:e.target.value})}/></Field><Field label="第三方 / 银行结算流水号"><input required maxLength={128} value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></Field><Field label="实际扣费币种"><CurrencySelect value={form.feeCurrency} onChange={v=>setForm({...form,feeCurrency:v})}/></Field>{([["feeAmount","实际扣费金额"],["feePercent","扣点百分比（选填）"],["fxRate","实际汇率（选填，1原币折人民币）"],["netCny","实际人民币净到账"]] as const).map(([k,l])=><Field key={k} label={l}><input required={k==="netCny"||k==="feeAmount"} inputMode="decimal" value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})}/></Field>)}</div>
      <h3>匹配客户收款</h3>{!candidates.length&&<p className="notice">请选账户与币种；当前没有对应待结算收款。</p>}{candidates.map(p=><fieldset key={p.id} className="commerce-item"><legend><label className="commerce-check"><input type="checkbox" checked={!!selected[p.id]} onChange={e=>setSelected(s=>{const next={...s};if(e.target.checked)next[p.id]={foreignAmount:p.pendingAmount,netCny:""};else delete next[p.id];return next;})}/>{p.customer_label} · {p.order_ref}</label></legend><p>{p.payment_date} · {p.reference||"无流水号"} · 待结算 {p.pendingAmount} {p.currency}</p>{selected[p.id]&&<div className="grid two"><Field label={`本次结算 ${p.currency}`}><input required inputMode="decimal" value={selected[p.id].foreignAmount} onChange={e=>setSelected({...selected,[p.id]:{...selected[p.id],foreignAmount:e.target.value}})}/></Field><Field label="分配人民币净到账"><input required inputMode="decimal" value={selected[p.id].netCny} onChange={e=>setSelected({...selected,[p.id]:{...selected[p.id],netCny:e.target.value}})}/></Field></div>}</fieldset>)}
      <Field label="结算备注"><textarea maxLength={500} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></Field>
    </form><footer className="fin-drawer-foot"><button type="button" className="secondary" disabled={busy} onClick={()=>setSettleOpen(false)}>取消</button><button type="submit" form="fin-settle-form" disabled={busy||!allocations.length}>{busy?"保存中…":"保存结算与到账"}</button></footer></div></div>}
    {voidId&&!readOnly&&<div className="fin-drawer-backdrop" onClick={e=>{if(e.target===e.currentTarget&&!busy)setVoidId("");}}><div className="fin-drawer-panel" role="dialog" aria-modal="true" aria-label="作废结算登记"><header className="fin-drawer-head"><h2>作废结算登记</h2><button type="button" className="secondary" disabled={busy} onClick={()=>setVoidId("")}>关闭</button></header><form className="fin-drawer-body" id="fin-void-settlement-form" onSubmit={e=>{e.preventDefault();void action(async()=>{await api.financeAction(`settlements/${voidId}/void`,{reason});setVoidId("");},`结算已作废（流水 ${data.settlements.find(x=>x.id===voidId)?.reference??""}），原记录保留`);}}><p className="notice">用于登记纠错，将恢复第三方待结金额并保留原记录；不会改变客户付款，也不表示资金已退款。</p><Field label="作废原因"><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field></form><footer className="fin-drawer-foot"><button className="secondary" type="button" disabled={busy} onClick={()=>setVoidId("")}>取消</button><button type="submit" form="fin-void-settlement-form" disabled={busy}>{busy?"保存中…":"确认作废"}</button></footer></div></div>}
    </>}
    {!hideCompanions&&<CompanyPayments today={today} readOnly={readOnly} />}
    {!hideCompanions&&<PaidPerformance today={today} readOnly={readOnly}/>}
    {!hideCompanions&&<AdAccountsWorkspace today={today} readOnly={readOnly} />}
  </div>;
}
