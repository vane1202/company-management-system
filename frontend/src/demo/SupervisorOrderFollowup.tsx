import {useEffect,useState} from 'react';
import {operatorOf,type Pending} from './supervisorPerformanceData';
import {demoOrderRooms} from './orderIdentity';
import {toErrorMessage} from '../errors';
import './supervisor-order-followup.css';

type Entry={orderId:string;note:string;nextContactOn:string;version:number;updatedBy:string;updatedAt:string};
const endpoint='/api/demo/order-followups';
async function request(input?:object):Promise<Entry[]>{
 const response=await fetch(endpoint,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{cache:'no-store'});
 const data=await response.json();if(!response.ok)throw Error(data.error||'跟进记录读取失败');return data.records;
}
export default function SupervisorOrderFollowup({pending,today,asOf,onOpen,onArchive}:{pending:Pending[];today:string;asOf:string;onOpen:(id:string)=>void;onArchive:()=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[error,setError]=useState(''),[ready,setReady]=useState(false);
 const [operator,setOperator]=useState(''),[kind,setKind]=useState(''),[search,setSearch]=useState('');
 const [editing,setEditing]=useState(''),[note,setNote]=useState(''),[next,setNext]=useState(''),[version,setVersion]=useState(0),[busy,setBusy]=useState(false);
 useEffect(()=>{let active=true;request().then(rows=>{if(active){setEntries(rows);setReady(true);}}).catch(e=>{if(active)setError(toErrorMessage(e));});return()=>{active=false;};},[]);
 const people=[...new Set(pending.map(p=>operatorOf(p.source)))].sort();
 const rows=pending.filter(p=>(!operator||operatorOf(p.source)===operator)&&(!kind||p.kind===kind)&&`${p.source.record.order.customer_label} ${p.source.identity.orderRef}`.toLowerCase().includes(search.trim().toLowerCase()));
 const orders=[...new Set(rows.map(p=>p.source.identity.id))].map(id=>rows.filter(p=>p.source.identity.id===id));
 function edit(orderId:string){const e=entries.find(row=>row.orderId===orderId);setEditing(orderId);setNote(e?.note||'');setNext(e?.nextContactOn||'');setVersion(e?.version||0);setError('');}
 async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{setEntries(await request({orderId:editing,note,nextContactOn:next,version}));setEditing('');}catch(cause){setError(toErrorMessage(cause));}finally{setBusy(false);}}
 return <section className="card so-followups" aria-label="本组订单跟进">
  <header className="sp-section-title"><h2>订单跟进 <small>{new Set(pending.map(p=>p.source.identity.id)).size} 单</small></h2><button type="button" className="text-action" onClick={onArchive}>查看全部订单 →</button></header>
  <p className="so-caption">截至 {asOf} 的本组未结订单，含历史欠款；备注不改变收款状态。</p>
  <div className="so-filters"><label>负责客服<select aria-label="跟进负责客服" value={operator} onChange={e=>setOperator(e.target.value)}><option value="">全部本组客服</option>{people.map(name=><option key={name}>{name}</option>)}</select></label><label>付款状态<select aria-label="跟进付款分类" value={kind} onChange={e=>setKind(e.target.value)}><option value="">全部待跟进</option>{['待付款','尾款待收','售后待收','资料待补'].map(value=><option key={value}>{value}</option>)}</select></label><label>客户／订单<input aria-label="跟进客户搜索" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索客户或订单号"/></label></div>
  {error&&<p className="error" role="alert">{error}</p>}
  {!orders.length&&<p className="empty-state">当前筛选下没有待跟进订单</p>}
  {orders.map(group=>{const first=group[0],s=first.source,id=s.identity.id,entry=entries.find(e=>e.orderId===id),room=demoOrderRooms.find(r=>r.code===s.identity.liveRoomCode);return <article className="so-order" key={id}>
   <header><div><strong>{s.record.order.customer_label||'客户待补'}</strong><small>{s.identity.orderRef} · 开单 {s.record.order.business_date}</small><small>负责客服：{operatorOf(s)} · {room?.name||'客服私推'}</small><small>接待账号：{s.identity.wechatId||'待补'} · 约定付款日期未登记</small></div><button type="button" className="text-action" onClick={()=>onOpen(id)}>查看订单 →</button></header>
   <div className="so-balances">{group.map((p,i)=><span key={i}>{p.kind} <b>{p.balance===null?'资料待核对':`${p.balance} ${p.currency}`}</b>{p.missing&&<small>{p.missing}</small>}</span>)}</div>
   {entry&&<div className="so-last-note"><p>{entry.note}</p><small>{entry.nextContactOn?`下次联系：${entry.nextContactOn}`:'未设下次联系日期'} · {entry.updatedBy} · {new Date(entry.updatedAt).toLocaleString('zh-CN')}</small></div>}
   {editing===id?<form className="so-note-form" onSubmit={save}><label>跟进备注<textarea aria-label="订单跟进备注" required maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label><label>下次联系日期<input aria-label="订单下次联系日期" type="date" min={today} value={next} onChange={e=>setNext(e.target.value)}/></label><div className="actions"><button type="submit" disabled={busy}>{busy?'保存中…':'保存跟进'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setEditing('')}>取消</button></div></form>:<button type="button" className="text-action" disabled={!ready} onClick={()=>edit(id)}>{entry?'更新跟进':'登记跟进'}</button>}
  </article>;})}
 </section>;
}
