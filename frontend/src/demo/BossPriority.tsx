import { useEffect, useState, type ReactNode } from "react";
import { InfoTip } from "../InfoTip";
import "./boss-priority.css";

type Stats={live:string;private:string;total:string;count:number;privateShare:number|null};
type Member=Stats&{id:string;name:string;team:string;sample:boolean;fans:number|null;effective:number|null;invalid:number|null;pendingInvalid:number};
type Room=Stats&{id:string;name:string;team:string|null;status:string;members:Member[]};
export type DailyExpense={id:string;date:string;category:string;amount:string;purpose:string;operator:string;proof:string};
type Data={version:string;period:{from:string;to:string};performance:Stats;rooms:Room[];expenses:{registered:string|null;status:string;categories:{key:string;label:string;amount:string|null;count:number;status:string}[];records:DailyExpense[]};definitions:{performance:string;fans:string;expenses:string}};
export const expenseLabels:Record<string,string>={rent:"房租",utilities:"水电",salary:"员工工资",hospitality:"接待费用",other:"其他费用"};
const yuan=(v:string|null)=>v===null?"—":"¥"+Number(v).toLocaleString("zh-CN",{minimumFractionDigits:2,maximumFractionDigits:2});
const share=(v:number|null)=>v===null?"—":v.toLocaleString("zh-CN",{maximumFractionDigits:2})+"%";

const bossPriorityApi = import.meta.env.MODE === "demo" ? "/api/demo/boss-priority" : "/api/dashboard/boss-priority";

export default function BossPriority({from,to,tick,onSalary,receipts,ads}:{from:string;to:string;tick:number;onSalary?:()=>void;receipts?:ReactNode;ads?:(total:string|undefined)=>ReactNode}){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
 const [view,setView]=useState<"home"|"rooms"|"expenses">("home"),[roomId,setRoomId]=useState(""),[category,setCategory]=useState("");
 useEffect(()=>{const controller=new AbortController();setData(null);setError("");fetch(bossPriorityApi+'?'+new URLSearchParams({from,to}),{signal:controller.signal,cache:'no-store',credentials:'include'}).then(async r=>{const payload=await r.json();if(!r.ok||payload.version!=='boss-priority/v1')throw Error(payload.error||'首页数据读取失败');if(!controller.signal.aborted)setData(payload);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'读取失败');});return()=>controller.abort();},[from,to,tick,retry]);
 const needsReview=data?.rooms.find(item=>item.status==='unassigned'&&item.count>0);
 const listedRooms=data?.rooms.filter(item=>item.status!=='unassigned')??[];
 const room=listedRooms.find(item=>item.id===roomId);
 function open(next:typeof view){setView(next);setRoomId("");setCategory("");}
 if(error)return <section className="boss-priority"><p className="error" role="alert">{error}</p><button type="button" onClick={()=>setRetry(n=>n+1)}>重试主数据</button></section>;
 return <section className={'boss-priority'+(view!=='home'?' bp-detail':'')} aria-label="优先经营数据">
 {view==='home'?<div className="bp-primary-grid">
 <article className="bp-hero">
   <header><h2>总业绩</h2><InfoTip inline label="总业绩口径" text={data?.definitions.performance || '直播间开单与客服私推合计。'}/></header>
   <strong className="bp-main-number">{data ? yuan(data.performance.total) : '—'}</strong>
   <div className="bp-mini"><span>直播间 <b>{data ? yuan(data.performance.live) : '—'}</b></span><span>私推 <b>{data ? yuan(data.performance.private) : '—'}</b></span></div>
   {receipts}
   <button type="button" className="bp-link" disabled={!data} onClick={()=>open('rooms')}>按直播间与客服拆解业绩 →</button>
 </article>
 <article>
   <header><h2>运营成本</h2><InfoTip label="运营成本口径" text={data?.definitions.expenses || '按已登记费用汇总。'}/><span className="bp-chip bp-gold">工资待核算</span></header>
   <strong className="bp-main-number">{!data ? '—' : data.expenses.registered === null ? '待补齐' : yuan(data.expenses.registered)}</strong>
   <small>{data?.expenses.registered != null ? '已登记费用小计' : '费用资料待补'}</small>
   <button type="button" className="bp-link" disabled={!data} onClick={()=>open('expenses')}>查看运营费用明细 →</button>
 </article>
 {ads?.(data?.performance.total)}
 </div>:<>
 <div className="bp-backbar"><button type="button" className="secondary" onClick={()=>room?setRoomId(""):open('home')}>← {room?'返回直播间':'返回经营总览'}</button>{room&&<button type="button" className="text-action" onClick={()=>open('home')}>经营总览</button>}</div>
 <header className="bp-detail-heading">
  <h2>{view==='expenses' ? '运营成本' : room ? (room.team ? room.name+' · '+room.team : room.name) : <>总业绩<span className="bp-room-heading-qualifier"> · 按直播间</span></>}</h2>
  <span className="bp-detail-date">{from} 至 {to}</span>
 </header>
 {!data?<p role="status">正在读取…</p>:view==='rooms'?!room?<><div className="bp-room-list">{listedRooms.map(item=><button type="button" className="bp-room" key={item.id} onClick={()=>setRoomId(item.id)}>
  <span><strong>{item.name}</strong><small>{item.status==='pending'?'资料待补，暂不分配小组':item.team}</small></span>
  <span><b>{item.status==='pending'?'资料待补':yuan(item.total)}</b>{item.status!=='pending'&&<small>私推占比 {share(item.privateShare)} · {item.count}笔</small>}</span>
  <span aria-hidden="true">›</span>
  {item.status!=='pending'&&<span className="bp-room-split"><span>直播间 <b>{yuan(item.live)}</b></span><span>私推 <b>{yuan(item.private)}</b></span></span>}
 </button>)}</div>
 {needsReview&&<p className="bp-unassigned">
  全公司总业绩中有 {needsReview.count} 笔、{yuan(needsReview.total)} 待确认直播间。
 </p>}
 </>:room.status==='pending'?<p className="empty-state">二号直播间（海外三线，文强组）的客服小组和人员资料待补，不复制秋菊组数据。</p>:<>
 <div className="bp-room-totals"><span>开单合计 <b>{yuan(room.total)}</b></span><span>直播间 <b>{yuan(room.live)}</b></span><span>私推 <b>{yuan(room.private)}</b></span><span>私推占比 <b>{share(room.privateShare)}</b></span></div>
 <p className="hint">已登记人员没有业务记录时显示未填报；演练成员与实际人员分开标注。<InfoTip label="成员数据口径" text={data.definitions.fans+' 业绩按开单当时的经办人归属，换号不改旧单；私推占比＝私推金额÷开单合计。'}/></p>
 <div className="bp-members">{room.members.map(member=><article key={member.id}>
   <header><div><strong>{member.name}</strong><small>{member.sample ? '演练成员' : member.team}</small></div><span className="bp-chip">私推占比 {share(member.privateShare)}</span></header>
   <dl>{[
     ['加粉总数',member.fans ?? '未填报'],
     ['有效粉',member.effective ?? '未填报'],
     ['无效粉',member.invalid ?? (member.pendingInvalid ? '待复核' : '未填报')],
     ['直播间开单',member.count ? yuan(member.live) : '—'],
     ['私推开单',member.count ? yuan(member.private) : '—'],
     ['开单合计',member.count ? yuan(member.total) : '—'],
   ].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
 </article>)}</div>{!room.members.length&&<p className="empty-state">成员资料待补。</p>}
 </>:<>
 <p className="notice">工资待财务核算；以下为已登记费用，不能视为完整总支出。广告消耗、售后费用不重复计入。</p>
 <div className="bp-room-totals"><span>已登记费用 <b>{yuan(data.expenses.registered)}</b></span><span>费用记录 <b>{data.expenses.records.length} 笔</b></span>{onSalary && <button type="button" className="bp-link" onClick={onSalary}>查看工资汇总 →</button>}</div>
 <div className="bp-filters" role="group" aria-label="费用分类">
   {Object.entries({ '':'全部分类',rent:'房租',utilities:'水电',salary:'工资',hospitality:'招待',other:'其他' }).map(([key,label])=><button type="button" key={key} aria-pressed={category===key} onClick={()=>setCategory(key)}>{label}</button>)}
 </div>
 {data.expenses.records.filter(record=>!category||record.category===category).map(record=><article className="bp-expense-record" key={record.id}><div><strong>{expenseLabels[record.category]} · {record.purpose}</strong><small>{record.date} · 经办：{record.operator} · 凭证：{record.proof||'待补'}</small></div><b>{yuan(record.amount)}</b></article>)}{!data.expenses.records.some(record=>!category||record.category===category)&&<p className="empty-state">{category==='salary'?'员工工资待财务核算，不将月工资重复分摊到每日。':'该范围没有已登记费用，请由财务补录。'}</p>}
 </>}
 </>}
 </section>;
}
