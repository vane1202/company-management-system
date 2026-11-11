import {useEffect,useRef,useState} from 'react';
import type {Currency,LiveBusinessData,LivePaymentProgress,LivePaymentStatus} from '../api';
import type {LiveView} from '../liveBusinessNavigation';
import {InfoTip} from '../InfoTip';
import {yuan,signedCents} from '../dashboardDisplay';
import './live-room-board.css';

const statusNames:Record<LivePaymentStatus,string>={unpaid:'未收款',partial:'部分收款',settled:'已结清',unknown:'待核对'};
const empty:LivePaymentProgress={unpaid:0,partial:0,settled:0,unknown:0,total:0,followupCount:0};
const progressTip='本期开单的有效订单，按所选结束日之前已登记的客户付款逐单判断，含同单追加应收。使用客户约定币种的抵扣金额；第三方是否结汇不影响客户结清。跑单与退款源单排除。历史简版或资料不全列为待核对。不是开单营业额减去当日收款。';
const followupTip='截至所选结束日，仍未收款或仅部分收款的有效订单，包含以前日期开出的订单。没有约定付款日期，不判为逾期。不包括付款资料待核对的订单。';
const costTip='所选区间按费用发生日汇总已登记的供货、加工、配货、配件、证书、包装和发货等业务费用，不是财务实际付款，也不是完整经营成本。人员提成与演员费用在成本与收益中单独查看，不重复并入这里。';
function cashRows(values?:Record<Currency,string>){
  if(!values)return [];
  const rows=Object.entries(values).filter(([,v])=>Number(v)!==0);
  return rows.length?rows:[['CNY','0.00']];
}
function pending(value:string|null|undefined,status?:string){return status==='unsupported_scope'?'当前维度不分摊':value==null?'待财务录入':yuan(value);}
type Props={data:LiveBusinessData|null;loading:boolean;failed:boolean;onOpen:(view:LiveView['view'],roomKey?:string)=>void;onOpenOrder?:(id:string)=>void};

/* Demo-only operating view. Financial detail is retained behind disclosures.
 * Cohort payment progress and all-age follow-ups deliberately have separate scopes. */
export default function LiveRoomBoard({data,loading,failed,onOpen,onOpenOrder}:Props){
  const [sort,setSort]=useState('performance'),[mode,setMode]=useState<'followups'|'cohort'>('followups');
  const [status,setStatus]=useState<LivePaymentStatus|'all'>('all'),[roomKey,setRoomKey]=useState('');
  const followup=useRef<HTMLElement>(null),op=data?.operations,t=data?.totals;
  useEffect(()=>{setRoomKey('');setStatus('all');setMode('followups');},[data?.period.from,data?.period.to,data?.selected.room,data?.selected.host,data?.selected.persona,data?.selected.operator]);
  function showOrders(nextMode:'followups'|'cohort',nextStatus:LivePaymentStatus|'all'='all',room=''){
    setMode(nextMode);setStatus(nextStatus);setRoomKey(room);
    followup.current?.scrollIntoView({block:'start'});
  }
  const rooms=[...(data?.rooms??[])].sort((a,b)=>{
    if(a.key==='__unassigned__'&&b.key!=='__unassigned__')return 1;
    if(b.key==='__unassigned__'&&a.key!=='__unassigned__')return -1;
    if(sort==='followup')return (op?.rooms[b.key]?.followupCount??0)-(op?.rooms[a.key]?.followupCount??0)||a.roomCode.localeCompare(b.roomCode);
    if(sort==='orders')return b.totals.newOrderCount-a.totals.newOrderCount||a.roomCode.localeCompare(b.roomCode);
    const field=sort==='expense'?'expenseCny':'performanceCny',x=signedCents(a.totals[field])??0n,y=signedCents(b.totals[field])??0n;
    return x===y?a.roomCode.localeCompare(b.roomCode):x>y?-1:1;
  });
  const listed=op?.orders.filter(o=>(mode==='cohort'?o.bookedInPeriod:['unpaid','partial'].includes(o.status))&&(!roomKey||o.roomKey===roomKey)&&(status==='all'||o.status===status))??[];
  return <div className="lr-board" aria-label="直播间经营看板" aria-busy={loading}>
    <section className="lr-summary" aria-label="直播间经营汇总">
      <button type="button" disabled={!data} onClick={()=>onOpen('income')}><span>开单营业额</span><strong>{loading?'…':yuan(t?.performanceCny)}</strong><small>料价＋代购费 · 按开单日</small></button>
      <button type="button" disabled={!op} onClick={()=>showOrders('cohort')}><span>有效开单</span><strong>{loading?'…':t?.newOrderCount??'—'}<small> 笔</small></strong><small>已排除跑单及退款源单</small></button>
      <article><span>客户收款 <InfoTip label="经营看板客户收款口径" text="按付款日汇总所选区间的实际收款，包含历史订单付款，原币分别列示，不与当期开单营业额直接相减。第三方结汇另列。"/></span><div className="lr-cash">{loading?'…':data?cashRows(t?.customerReceipts).map(([cur,amount])=><strong key={cur}>{amount}<small> {cur}</small></strong>):'—'}</div><small>按付款日 · 原币分别统计</small></article>
      <article><span>已登记业务费用 <InfoTip label="经营看板业务费用口径" text={costTip}/></span><button type="button" className="lr-summary-value" disabled={!data} onClick={()=>onOpen('expenses')}><strong>{loading?'…':yuan(t?.expenseCny)}</strong></button><small>按费用发生日</small></article>
    </section>
    <section className="lr-room-section" aria-label="直播间表现">
      <header className="lr-section-heading"><h2>直播间表现</h2><label>排序<select aria-label="经营表现排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="performance">营业额从高到低</option><option value="orders">开单笔数从高到低</option><option value="followup">待跟进订单优先</option><option value="expense">业务费用从高到低</option></select></label></header>
      {loading?<p role="status">正在读取经营数据…</p>:failed?<p className="notice">数据读取失败，请重试后查看。</p>:!rooms.length?<p className="notice">所选范围暂无直播间经营记录。</p>:<div className="lr-rooms">{rooms.map(r=>{
        const p=op?.rooms[r.key]??empty,profit=r.profit;
        return <article className="lr-room" key={r.key} aria-label={`${r.roomCode}经营表现`}>
          <header><div><h3>{r.roomCode}</h3><p>{r.hosts.join('、')||'主播待补'}</p></div>{p.followupCount>0&&<button type="button" className="lr-attention" onClick={()=>showOrders('followups','all',r.key)}>待跟进 {p.followupCount} 单</button>}</header>
          <div className="lr-booking"><button type="button" onClick={()=>onOpen('income',r.key)}><small>开单营业额</small><strong>{yuan(r.totals.performanceCny)}</strong></button><button type="button" onClick={()=>showOrders('cohort','all',r.key)}><small>有效开单</small><b>{r.totals.newOrderCount} 笔</b></button></div>
          <div className="lr-progress"><span>付款进展 <InfoTip label={`${r.roomCode}付款进展口径`} text={progressTip}/></span>{!op?<p>付款资料待接入</p>:!p.total?<p>本期无有效开单</p>:<div className="lr-status-buttons">{(['unpaid','partial','settled','unknown'] as const).filter(s=>s!=='unknown'||p.unknown>0).map(s=><button key={s} type="button" className={p[s]>0&&s!=='settled'?'lr-has-open':''} onClick={()=>showOrders('cohort',s,r.key)}>{statusNames[s]} <b>{p[s]}</b></button>)}</div>}</div>
          <div className="lr-expense"><span>已登记业务费用</span><button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>{yuan(r.totals.expenseCny)} →</button></div>
          {(r.totals.cancelledOrderCount>0||Number(r.totals.excludedSourceCny)>0)&&<p className="lr-note">{r.totals.cancelledOrderCount?`跑单 ${r.totals.cancelledOrderCount} 单 · `:''}原开单已冲抵 {yuan(r.totals.excludedSourceCny)}</p>}
          <details className="lr-finance"><summary>成本与收益</summary>
            <dl><div><dt>料子本钱 <InfoTip label={`${r.roomCode}料本来源`} text="优先用开单卡料子本钱（按开单日），该字段缺省时回退供货／配货款（按费用发生日）；跑单料本排除。不与业务费用合计重复相加。"/></dt><dd>{yuan(profit?.materialCostCny)}</dd></div>
              {profit?.materialCostSources&&<div><dt>开单卡／回退供货款</dt><dd>{profit.materialCostSources.orderCardCny}／{profit.materialCostSources.expenseFallbackCny}</dd></div>}
              <div><dt>人员费用</dt><dd>{pending(profit?.staff.totalCny,profit?.staff.status)}</dd></div>
              <div><dt>主播提成</dt><dd>{pending(profit?.staff.hostCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>助理提成</dt><dd>{pending(profit?.staff.assistantCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>货主演员费用</dt><dd>{pending(profit?.staff.actorSessionFee.value,profit?.staff.status)}</dd></div>
              <div><dt>直播间毛利 <InfoTip label={`${r.roomCode}毛利口径`} text="沿用原口径：开单营业额－料子本钱－主播提成－助理提成－货主演员费用，不是公司净利润，不包含全部业务费用。缺提成时待核算；按主播、人设或客服筛选时不推测分摊。"/></dt><dd>{profit?.status==='unsupported_scope'?'当前维度不分摊':profit?.liveRoomProfitCny==null?'待核算':yuan(profit.liveRoomProfitCny)}</dd></div></dl>
            {profit?.staff.actorSessionFee.records.map(x=><p className="lr-note" key={x.id}>{x.date} · {x.session_label||'场次'} · ¥{x.amount_cny}</p>)}
            <button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>查看费用与付款明细 →</button>
          </details>
        </article>;
      })}</div>}
    </section>
    <section ref={followup} className="lr-orders boss-panel" aria-label="订单跟进">
      <header className="lr-section-heading"><h2>订单跟进 <InfoTip label="待跟进订单范围" text={followupTip}/></h2><small>截至 {data?.period.to??'—'}</small></header>
      <div className="lr-order-controls"><div role="group" aria-label="跟进范围"><button type="button" className={mode==='followups'?'selected':'secondary'} aria-pressed={mode==='followups'} onClick={()=>{setMode('followups');setStatus('all');}}>待收款 {op?.summary.followupCount??'—'}</button><button type="button" className={mode==='cohort'?'selected':'secondary'} aria-pressed={mode==='cohort'} onClick={()=>{setMode('cohort');setStatus('all');}}>本期开单 {op?.summary.total??'—'}</button></div><label>直播间<select aria-label="跟进直播间" value={roomKey} onChange={e=>setRoomKey(e.target.value)}><option value="">全部</option>{rooms.map(r=><option key={r.key} value={r.key}>{r.roomCode}</option>)}</select></label><label>付款状态<select aria-label="跟进付款状态" value={status} onChange={e=>setStatus(e.target.value as typeof status)}><option value="all">全部</option>{(mode==='followups'?['unpaid','partial']:['unpaid','partial','settled','unknown']).map(s=><option value={s} key={s}>{statusNames[s as LivePaymentStatus]}</option>)}</select></label></div>
      {!op?<p className="notice">{loading?'正在读取付款进度…':'订单付款资料待接入。'}</p>:!listed.length?<p className="notice">{mode==='followups'?'所选范围没有待收款订单。':'所选范围没有符合条件的开单。'}</p>:<div className="lr-order-list">{listed.map(o=><article key={o.id} className="lr-order-row"><div><strong>{o.customerLabel} <small>{o.customerCode}</small></strong><p>{o.reference} · {o.bookingDate}{!o.bookedInPeriod?' · 历史开单':''}</p><p>{o.roomCode} · {o.hostName||'主播待补'} · 客服 {o.operatorName||'待补'}</p>{o.serviceAccount&&<p>{o.serviceAccount}</p>}</div><div className="lr-order-amount"><span className={o.status==='unpaid'||o.status==='partial'?'lr-open-label':''}>{statusNames[o.status]}</span>{o.balance==null?<strong>付款资料待核对</strong>:<><strong>{o.status==='settled'?'已结清':`待收 ${o.balance} ${o.currency}`}</strong><small>应收 {o.due} · 已收 {o.paid} {o.currency}</small></>}<button type="button" className="text-action" onClick={()=>onOpenOrder?.(o.id)}>查看订单 →</button></div></article>)}</div>}
    </section>
    <details className="lr-more boss-panel"><summary>更多经营记录</summary><div className="lr-more-actions"><button type="button" className="secondary" onClick={()=>onOpen('afterSales')}>售后收费与收款</button><button type="button" className="secondary" onClick={()=>onOpen('paid')}>财务核定业绩</button><button type="button" className="secondary" onClick={()=>onOpen('ads')}>全公司广告消耗</button></div><p className="lr-note">广告费用仍按全公司汇总，不按引流人设推测分摊到直播间。</p><details><summary>公司到账与历史费用核对</summary><div className="live-cash-grid"><div><small>公司人民币净到账</small><strong>{yuan(t?.companyReceivedCny)}</strong></div><div><small>财务实际付款</small><strong>{yuan(t?.supplierPaidCny)}</strong></div></div>{!!data?.legacyCost.count&&<p className="lr-note">{data.legacyCost.count} 笔历史成本日期待核对，未加入本期业务费用。</p>}</details></details>
  </div>;
}
