import {useEffect,useRef,useState} from 'react';
import {requestInner, type CompanyExpense} from '../api';
import {newRequestKey} from '../commerceUi';
import {toErrorMessage} from '../errors';
import {createRequestGate} from '../requestGate';
import {demoOrderRooms} from './orderIdentity';
import './warehouse-workspace.css';

type Bill={id:string;orderId:string;expenseId:string;afterSaleChargeId?:string;createdById?:string;category:string;label:string;counterparty:string;amount:string;date:string;materialRef:string;proof:string;note:string;status:'submitted'|'approved'|'rejected';version:number;createdBy:string;createdAt:string;reviewNote?:string;reviewedBy?:string};
type Payment={id:string;billId:string;amount:string;date:string;payee:string;account:string;reference:string};
type Data={state:{bills:Bill[];payments:Payment[]};expenses:CompanyExpense[];orders:{id:string;orderRef:string;customerLabel:string;liveRoomCode:string;hostName:string;operatorName:string;personaName:string;customerCode:string;canCreate?:boolean}[];charges?:{id:string;orderId:string;label:string}[];kinds:Record<string,string>};
const demo=import.meta.env.MODE==='demo';
const roomLabel=(code?:string)=>demo?(demoOrderRooms.find(room=>room.code===code)?.name||'客服私推'):(code||'未登记直播间');
const c=(value:string)=>{const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
const m=(value:bigint)=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
const yuan=(value:string)=>'¥'+Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
async function call(finance:boolean,input?:object):Promise<Data>{
 const endpoint=demo?'/api/demo/warehouse':finance?'/api/finance/warehouse':'/api/warehouse';
 if(!demo)return requestInner<Data>(endpoint,input?{method:'POST',body:JSON.stringify(input)}:{cache:'no-store'});
 const r=await fetch(endpoint,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'结账台账读取失败');return d;
}
const labels={submitted:'待财务审核',approved:'已审核',rejected:'已退回'};
export default function WarehouseWorkspace({today,finance=false,onBack,userId}:{today:string;finance?:boolean;onBack?:()=>void;userId?:string}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 const [view,setView]=useState<'ledger'|'create'>('ledger'),[query,setQuery]=useState(''),[status,setStatus]=useState('');
 const requests=useRef(new Map<string,string>()),[revision,setRevision]=useState<Bill|null>(null);
 const gate=useRef(createRequestGate());
 const blank=()=>({orderId:'',expenseId:'',afterSaleChargeId:'',category:'goods',label:'',counterparty:'',amount:'',date:today,materialRef:'',proof:'',note:'',requestKey:newRequestKey()});
 const [form,setForm]=useState(blank),[selected,setSelected]=useState<Bill|null>(null),[review,setReview]=useState('');
 const [withdraw,setWithdraw]=useState(false);
 useEffect(()=>{if(selected)document.querySelector('.warehouse-workspace > form.warehouse-form')?.scrollIntoView({block:'start'});},[selected,withdraw]);
 const [payment,setPayment]=useState({amount:'',date:today,payee:'',account:'',reference:''});
 async function refresh(){const ticket=gate.current.next();setError('');try{const next=await call(finance);if(ticket.isCurrent())setData(next);}catch(e){if(ticket.isCurrent())setError(toErrorMessage(e));}}
 useEffect(()=>{void refresh();return()=>{gate.current.next();};},[finance]);
 async function act(input:object,success:string){if(busy)return;setBusy(true);setError('');setMessage('');const signature=JSON.stringify(input);const key=requests.current.get(signature)||newRequestKey();requests.current.set(signature,key);try{setData(await call(finance,{...input,requestKey:key}));requests.current.delete(signature);setSelected(null);setMessage(success);return true;}catch(e){setError(toErrorMessage(e));return false;}finally{setBusy(false);}}
 const paid=(b:Bill)=>(data?.state.payments||[]).filter(p=>p.billId===b.id).reduce((n,p)=>n+c(p.amount),0n);
 const remaining=(b:Bill)=>c(b.amount)-paid(b);
 const state=(b:Bill)=>b.status==='approved'?(remaining(b)===0n?'已结清':paid(b)>0n?'部分付款':'待付款'):labels[b.status];
 const order=data?.orders.find(o=>o.id===form.orderId);
 const rows=data?.state.bills.filter(b=>{const o=data.orders.find(o=>o.id===b.orderId);return(!status||state(b)===status)&&`${o?.orderRef} ${o?.customerLabel} ${o?.operatorName} ${b.counterparty} ${b.materialRef} ${b.label}`.toLowerCase().includes(query.trim().toLowerCase());})||[];
 const expenses=data?.expenses.filter(e=>e.order_id===form.orderId&&e.category===form.category&&!e.voided_at&&e.pending_cny!==null&&c(e.pending_cny)>0n)||[];
 const approved=data?.state.bills.filter(b=>b.status==='approved')||[];
 function start(category:string){setRevision(null);setForm({...blank(),category});setSelected(null);setView('create');setMessage('');}
 return <div className="warehouse-workspace" aria-busy={busy}>
  <header className="commerce-heading"><div><h1>{finance?'库房结账':'库房工作台'}</h1><small>{finance?'核对账单 · 登记实际付款':'出库结账 · 售后接待 · 对外结账'}</small></div><div className="actions">{onBack&&<button type="button" className="secondary" onClick={onBack}>返回</button>}<button type="button" className="secondary" disabled={busy} onClick={refresh}>刷新</button></div></header>
  {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="ok" role="status">{message}</p>}
  {!data?(error?<div className="overview-error" role="alert"><p>台账加载失败，请重试。</p><button type="button" className="secondary" disabled={busy} onClick={()=>void refresh()}>重新读取</button></div>:<p role="status">正在读取结账台账…</p>):<>
  <div className="wh-kpis"><article><span>待审核</span><b>{data.state.bills.filter(b=>b.status==='submitted').length} 单</b></article><article><span>已审核待付</span><b>{yuan(m(approved.reduce((n,b)=>n+remaining(b),0n)))}</b></article><article><span>实际已付</span><b>{yuan(m(data.state.payments.reduce((n,p)=>n+c(p.amount),0n)))}</b></article></div>
  {!finance && <section aria-labelledby="warehouse-new-bill">
    <h2 className="wh-entry-heading" id="warehouse-new-bill">新建结账</h2>
    <div className="wh-entry">
      {[
        ['goods', '原石出库结账'],
        ['sourcing', '售后接待结账'],
        ['other', '其他对外结账']
      ].map(([key, label]) => (
        <button key={key} type="button" className="wh-entry-action" onClick={() => start(key)}>
          <span className="wh-entry-icon" aria-hidden="true">+</span>
          {label}
        </button>
      ))}
    </div>
  </section>}
  {view==='create'&&!finance?<section className="card"><header className="commerce-line"><h2>{revision?'修改退回账单':'登记待结账单'}</h2><button type="button" className="text-action" onClick={()=>setView('ledger')}>返回台账</button></header><form className="warehouse-form" onSubmit={async e=>{e.preventDefault();if(await act({action:revision?'resubmit':'create',...(revision?{id:revision.id,version:revision.version}:{}),...form},'结账单已提交，等待财务审核')){setRevision(null);setForm(blank());setView('ledger');}}}>
   <div className="wh-fields"><label>关联订单<select required disabled={!!revision} aria-label="库房关联订单" value={form.orderId} onChange={e=>setForm({...form,orderId:e.target.value,expenseId:'',afterSaleChargeId:'',label:'',counterparty:'',amount:'',materialRef:''})}><option value="">选择订单／客户</option>{data.orders.filter(o=>o.canCreate!==false||o.id===form.orderId).map(o=><option key={o.id} value={o.id}>{o.orderRef} · {o.customerLabel}</option>)}</select></label><label>结账类别<select aria-label="库房结账类别" value={form.category} onChange={e=>setForm({...form,category:e.target.value,expenseId:'',amount:''})}>{Object.entries(data.kinds).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
   {order&&<p className="wh-order-context">{roomLabel(order.liveRoomCode)} · 主播 {order.hostName||'—'} · 客服 {order.operatorName||'待补'} · 人设 {order.personaName||'待补'} · 客户 {order.customerLabel}（{order.customerCode||'ID待补'}）</p>}
   <label className="wh-full">关联已登记成本<select aria-label="库房关联成本" value={form.expenseId} onChange={e=>{const source=expenses.find(x=>x.id===e.target.value);setForm({...form,expenseId:e.target.value,...(source?{label:source.label,counterparty:source.counterparty||'',amount:source.pending_cny||'',materialRef:source.material_ref||'',date:source.business_date,afterSaleChargeId:source.after_sale_charge_id||''}:{amount:'',afterSaleChargeId:''})});}}><option value="">新增成本账单（财务审核后纳入成本）</option>{expenses.map(e=><option key={e.id} value={e.id}>{e.label} · 待付 {yuan(e.pending_cny!)}</option>)}</select><small>已由客服登记的同项成本，请选择关联，避免重复入账。</small></label>
   {!demo&&<label className="wh-full">关联售后收费<select aria-label="关联售后收费" disabled={!!form.expenseId} value={form.afterSaleChargeId} onChange={e=>setForm({...form,afterSaleChargeId:e.target.value})}><option value="">不关联售后收费</option>{data.charges?.filter(charge=>charge.orderId===form.orderId).map(charge=><option key={charge.id} value={charge.id}>{charge.label}</option>)}</select></label>}
   {([['label','结账项目'],['counterparty','供货／服务方'],['materialRef','商品编号／料号'],['proof','单据／成本留底凭证编号'],['amount','待结账金额 · ¥'],['date','费用发生日期']] as const).map(([key,label])=><label key={key}>{label}<input required aria-label={'库房'+label} type={key==='date'?'date':'text'} max={key==='date'?today:undefined} maxLength={128} inputMode={key==='amount'?'decimal':undefined} value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})}/></label>)}
   <label className="wh-full">备注<textarea maxLength={1000} value={form.note} onChange={e=>setForm({...form,note:e.target.value})}/></label></div><button type="submit" disabled={busy}>提交待结账单</button>
  </form></section>:<section className="card"><h2>结账台账</h2><div className="wh-filters"><label>查找账单<input type="search" aria-label="库房查找账单" placeholder="订单、客户、客服、供货方或料号" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>状态<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">全部状态</option>{['待财务审核','待付款','部分付款','已结清','已退回'].map(s=><option key={s}>{s}</option>)}</select></label></div>
   {!rows.length&&<p className="empty-state">当前没有符合条件的结账单</p>}
   {rows.slice().reverse().map(b=>{const o=data.orders.find(o=>o.id===b.orderId);return <details className="wh-bill" key={b.id}><summary><span>{b.label}<small>{o?.orderRef} · {o?.customerLabel} · {b.counterparty}</small></span><span><b>{yuan(b.amount)}</b><small>{state(b)}</small></span></summary><p>{data.kinds[b.category]} · {b.date} · 料号 {b.materialRef}</p><p>凭证：{b.proof} · 登记人：{b.createdBy}</p><p>{roomLabel(o?.liveRoomCode)} · {o?.personaName||'人设待补'} · 客服 {o?.operatorName||'待补'}</p>{b.note&&<p>{b.note}</p>}{b.reviewNote&&<p>财务核对：{b.reviewNote} · {b.reviewedBy}</p>}
    <p>实际已付 {yuan(m(paid(b)))} · {b.status==='approved'?`剩余待付 ${yuan(m(remaining(b)))}`:'审核通过后进入应付'}</p>
    {finance&&b.status==='submitted'&&<button type="button" className="secondary" onClick={()=>{setWithdraw(false);setSelected(b);setReview('');}}>核对账单</button>}
    {!demo&&!finance&&b.status==='rejected'&&b.createdById===userId&&<button type="button" className="secondary" onClick={()=>{setRevision(b);setForm({...blank(),orderId:b.orderId,expenseId:b.expenseId||'',afterSaleChargeId:b.afterSaleChargeId||'',category:b.category,label:b.label,counterparty:b.counterparty,amount:b.amount,date:b.date,materialRef:b.materialRef,proof:b.proof,note:b.note});setView('create');}}>修改并重新提交</button>}
    {finance&&b.status==='approved'&&remaining(b)>0n&&<button type="button" className="secondary" onClick={()=>{setWithdraw(false);setSelected(b);setPayment({amount:m(remaining(b)),date:today,payee:b.counterparty,account:'',reference:''});}}>登记实际付款</button>}
    {!demo&&finance&&b.status==='approved'&&paid(b)===0n&&<button type="button" className="secondary" onClick={()=>{setWithdraw(true);setSelected(b);setReview('');}}>撤回审核</button>}
    {data.state.payments.filter(p=>p.billId===b.id).map(p=><p key={p.id}>{p.date} · {p.payee} · {yuan(p.amount)} · {p.account} · 流水 {p.reference}</p>)}
   </details>;})}
  </section>}
  {selected&&finance&&withdraw&&<form className="card warehouse-form" onSubmit={e=>{e.preventDefault();void act({action:'withdraw',id:selected.id,version:selected.version,reason:review},'已撤回审核并退回库房');}}><h2>撤回审核 · {selected.label}</h2><label>撤回说明<textarea required maxLength={500} value={review} onChange={e=>setReview(e.target.value)}/></label><div className="actions"><button disabled={busy||!review.trim()}>撤回并退回库房</button><button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消</button></div></form>}
  {selected&&finance&&!withdraw&&<form className="card warehouse-form" onSubmit={e=>{e.preventDefault();void act({action:'pay',id:selected.id,version:selected.version,...payment},'实际付款已登记，结账台账已更新');}}><h2>{selected.status==='submitted'?'核对账单':'登记实际付款'} · {selected.label}</h2>{selected.status==='submitted'?<><label>审核说明<textarea required maxLength={500} aria-label="库房审核说明" value={review} onChange={e=>setReview(e.target.value)}/></label><div className="actions"><button type="button" disabled={busy||!review.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'approved',reason:review},'审核通过，已进入待付款')}>审核通过</button><button type="button" className="secondary" disabled={busy||!review.trim()} onClick={()=>void act({action:'review',id:selected.id,version:selected.version,decision:'rejected',reason:review},'已退回库房')}>退回</button></div></>:<><div className="wh-fields">{([['amount','实际付款金额 · ¥'],['date','付款日期'],['payee','实际收款方'],['account','公司付款账户'],['reference','付款流水号']] as const).map(([key,label])=><label key={key}>{label}<input required aria-label={'库房'+label} type={key==='date'?'date':'text'} max={key==='date'?today:undefined} value={payment[key]} onChange={e=>setPayment({...payment,[key]:e.target.value})}/></label>)}</div><button type="submit" disabled={busy}>保存实际付款</button></>}<button type="button" className="secondary" disabled={busy} onClick={()=>setSelected(null)}>取消</button></form>}
  <p className="wh-caption">库房提交账单，财务审核并登记实际付款。{demo?'演示试填仅保留在当前浏览器会话。':'正式账单与付款记录保存在服务器。'}</p>
  </>}
 </div>;
}
