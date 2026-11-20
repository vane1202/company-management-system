import {useEffect,useState} from 'react';
import {requestInner, type CompanyExpense} from '../api';
import {InfoTip} from '../InfoTip';
import {toErrorMessage} from '../errors';
import './warehouse-workspace.css';
import './reimbursement-workspace.css';

type Claim={id:string;claimant:string;department:string;category:string;purpose:string;amount:string;expenseDate:string;claimDate:string;expenseId:string;receiptRef:string;note:string;status:'pending'|'approved'|'rejected';version:number;createdBy:string;reviewNote?:string;reviewedBy?:string};
type Payment={id:string;claimId:string;amount:string;date:string;payee:string;account:string;reference:string};
type Data={state:{claims:Claim[];payments:Payment[]};categories:Record<string,string>;expenses:CompanyExpense[]};
const cents=(value:string)=>{const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
const amount=(v:bigint)=>`${v/100n}.${String(v%100n).padStart(2,'0')}`;
const yuan=(v:bigint)=>'¥'+Number(amount(v)).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const reimbursementUrl = import.meta.env.MODE === 'demo' ? '/api/demo/reimbursements' : '/api/finance/reimbursements';
async function request(body?:object):Promise<Data>{
 if(import.meta.env.MODE!=='demo') return requestInner<Data>(reimbursementUrl, body?{method:'POST',body:JSON.stringify(body)}:{cache:'no-store'});
 const r=await fetch(reimbursementUrl,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});const data=await r.json();if(!r.ok)throw Error(data.error||'报销数据读取失败');return data;}

export default function ReimbursementWorkspace({today,onBack}:{today:string;onBack?:()=>void}){
 const blank=()=>({claimant:'',department:'',category:'temporary',purpose:'',amount:'',expenseDate:today,claimDate:today,expenseId:'',receiptRef:'',note:'',requestKey:crypto.randomUUID()});
 const [data,setData]=useState<Data|null>(null),[form,setForm]=useState(blank),[creating,setCreating]=useState(false);
 const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState<Claim|null>(null),[reason,setReason]=useState('');
 const [payment,setPayment]=useState({amount:'',date:today,payee:'',account:'',reference:''});
 const [filters,setFilters]=useState({search:'',category:'',status:'',from:'',to:''});
 async function refresh(){setError('');try{setData(await request());}catch(e){setError(toErrorMessage(e));}}
 useEffect(()=>{void refresh();},[]);
 async function act(body:object,success:string){if(busy)return false;setBusy(true);setError('');setMessage('');try{setData(await request(body));setSelected(null);setMessage(success);return true;}catch(e){setError(toErrorMessage(e));return false;}finally{setBusy(false);}}
 const paid=(claim:Claim)=>(data?.state.payments||[]).filter(p=>p.claimId===claim.id).reduce((n,p)=>n+cents(p.amount),0n);
 const state=(claim:Claim)=>claim.status==='pending'?'待核对':claim.status==='rejected'?'已退回':paid(claim)===cents(claim.amount)?'已报销':paid(claim)>0n?'部分报销':'待报销';
 const validRange=!filters.from||!filters.to||filters.from<=filters.to;
 const rows=(data?.state.claims||[]).filter(c=>validRange&&(!filters.category||c.category===filters.category)&&(!filters.status||state(c)===filters.status)&&(!filters.from||c.expenseDate>=filters.from)&&(!filters.to||c.expenseDate<=filters.to)&&`${c.claimant} ${c.department} ${c.purpose} ${c.receiptRef}`.toLowerCase().includes(filters.search.trim().toLowerCase()));
 return <div className="warehouse-workspace reimbursement-workspace" aria-busy={busy}>
  <header className="commerce-heading"><div><h1>费用报销 <InfoTip label="报销统计口径" text="记录公司日常运营成本之外的费用报销。新增报销费用独立汇总，不自动计入运营成本；关联已有成本的报销仅跟踪待付和实际付款，不新增一笔成本。申请金额、核定待报销和实际报销分别统计，以下汇总跟随费用发生日期与筛选。"/></h1><small>费用登记 · 核对确认 · 报销付款</small></div><div className="actions">{onBack&&<button type="button" className="secondary" onClick={onBack}>返回</button>}<button type="button" className="secondary" disabled={busy} onClick={refresh}>刷新</button></div></header>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="ok" role="status">{message}</p>}
  {!data?<p role="status">正在读取报销台账…</p>:<>
  <div className="wh-kpis"><article><span>报销申请额</span><b>{yuan(rows.filter(c=>c.status!=='rejected').reduce((n,c)=>n+cents(c.amount),0n))}</b></article><article><span>已核对待报销</span><b>{yuan(rows.filter(c=>c.status==='approved').reduce((n,c)=>n+cents(c.amount)-paid(c),0n))}</b></article><article><span>实际已报销</span><b>{yuan(rows.reduce((n,c)=>n+paid(c),0n))}</b></article></div>
  {!creating&&<button type="button" className="reim-create" onClick={()=>{setCreating(true);setForm(blank());setSelected(null);setMessage('');}}>＋ 登记报销</button>}
  {creating?<section className="card"><header className="commerce-line"><h2>登记报销</h2><button type="button" className="text-action" onClick={()=>setCreating(false)}>返回台账</button></header><form className="reimbursement-form" onSubmit={async e=>{e.preventDefault();if(await act({action:'create',...form},'报销已登记，等待核对确认')){setCreating(false);setForm(blank());}}}>
   <div className="wh-fields">{([['claimant','报销人'],['department','部门／小组']] as const).map(([key,label])=><label key={key}>{label}<input aria-label={'报销'+label} required={key==='claimant'} maxLength={key==='department'?64:128} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label>费用类别<select aria-label="报销费用类别" value={form.category} onChange={e=>setForm({...form,category:e.target.value})}>{Object.entries(data.categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>关联已登记费用<select aria-label="报销关联费用" value={form.expenseId} onChange={e=>{const expense=data.expenses.find(x=>x.id===e.target.value);setForm({...form,expenseId:e.target.value,...(expense?{amount:expense.pending_cny!,purpose:expense.label,category:'advance'}:{amount:'',purpose:''})});}}><option value="">独立报销费用</option>{data.expenses.map(e=><option key={e.id} value={e.id}>{e.order_ref} · {e.label} · 待付 {e.pending_cny}</option>)}</select><small>原费用已经入账时，请关联原记录。</small></label>
   {([['amount','申请报销金额 · ¥'],['receiptRef','票据／凭证编号'],['expenseDate','费用发生日期'],['claimDate','报销登记日期']] as const).map(([key,label])=><label key={key}>{label}<input required aria-label={'报销'+label} maxLength={128} type={key.endsWith('Date')?'date':'text'} max={key.endsWith('Date')?today:undefined} inputMode={key==='amount'?'decimal':undefined} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label className="wh-full">报销事由<textarea aria-label="报销事由" required maxLength={500} value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})}/></label><label className="wh-full">备注<textarea maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label></div><button type="submit" disabled={busy}>保存报销登记</button>
  </form></section>:<section className="card"><h2>报销台账</h2><div className="reim-filters"><label>查找报销<input aria-label="查找报销" type="search" placeholder="报销人、部门、事由或凭证" value={filters.search} onChange={e=>setFilters({...filters,search:e.target.value})}/></label><label>状态<select aria-label="报销状态筛选" value={filters.status} onChange={e=>setFilters({...filters,status:e.target.value})}><option value="">全部状态</option>{['待核对','待报销','部分报销','已报销','已退回'].map(v=><option key={v}>{v}</option>)}</select></label><label>费用类别<select value={filters.category} onChange={e=>setFilters({...filters,category:e.target.value})}><option value="">全部类别</option>{Object.entries(data.categories).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>费用开始日期<input type="date" max={filters.to||today} value={filters.from} onChange={e=>setFilters({...filters,from:e.target.value})}/></label><label>费用结束日期<input type="date" min={filters.from} max={today} value={filters.to} onChange={e=>setFilters({...filters,to:e.target.value})}/></label></div>
   {!validRange&&<p className="error" role="alert">开始日期不能晚于结束日期。</p>}{!rows.length&&<p className="empty-state">当前没有符合条件的报销记录</p>}
   {rows.slice().reverse().map(c=><details className="wh-bill" key={c.id}><summary><span>{c.claimant} · {data.categories[c.category]}<small>{c.expenseDate} · {c.purpose}</small></span><span><b>{yuan(cents(c.amount))}</b><small>{state(c)}</small></span></summary><p>部门／小组：{c.department||'未填写'} · 登记日期：{c.claimDate}</p><p>凭证：{c.receiptRef} · 经办：{c.createdBy}</p><p>{c.expenseId?'关联原费用，不重复计入成本':'独立报销费用，不自动计入运营成本'}</p>{c.note&&<p>{c.note}</p>}{c.reviewNote&&<p>核对说明：{c.reviewNote} · {c.reviewedBy}</p>}<p>已报销 {yuan(paid(c))}{c.status==='approved'?` · 待报销 ${yuan(cents(c.amount)-paid(c))}`:''}</p>
    {c.status==='pending'&&<button type="button" className="secondary" onClick={()=>{setSelected(c);setReason('');}}>核对报销</button>}{c.status==='approved'&&paid(c)<cents(c.amount)&&<button type="button" className="secondary" onClick={()=>{setSelected(c);setPayment({amount:amount(cents(c.amount)-paid(c)),date:today,payee:c.claimant,account:'',reference:''});}}>登记报销付款</button>}
    {data.state.payments.filter(p=>p.claimId===c.id).map(p=><p key={p.id}>{p.date} · {p.payee} · {yuan(cents(p.amount))} · {p.account} · 流水 {p.reference}</p>)}
   </details>)}
  </section>}
  {selected&&<form className="card reimbursement-form" onSubmit={e=>{e.preventDefault();void act({action:'pay',id:selected.id,version:selected.version,...payment},'报销付款已登记');}}><h2>{selected.status==='pending'?'核对报销':'登记报销付款'} · {selected.claimant}</h2>{selected.status==='pending'?<><label>核对说明<textarea required maxLength={500} aria-label="报销核对说明" value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="actions"><button type="button" disabled={busy||!reason.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'approved',reason},'报销已确认，进入待报销')}>确认报销</button><button type="button" className="secondary" disabled={busy||!reason.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'rejected',reason},'报销已退回')}>退回</button></div></>:<><div className="wh-fields">{([['amount','实际报销金额 · ¥'],['date','报销付款日期'],['payee','实际收款人'],['account','公司付款账户'],['reference','付款流水号']] as const).map(([key,label])=><label key={key}>{label}<input required aria-label={'报销'+label} type={key==='date'?'date':'text'} max={key==='date'?today:undefined} value={payment[key]} onChange={e=>setPayment({...payment,[key]:e.target.value})}/></label>)}</div><button type="submit" disabled={busy}>保存报销付款</button></>}<button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消</button></form>}
  <p className="wh-caption">报销独立于日常运营成本汇总。演示试填仅保留在当前浏览器会话。</p>
  </>}
 </div>;
}
