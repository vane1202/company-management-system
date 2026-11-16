import BossReceivables from "./BossReceivables";
import {useState} from 'react';
import type {LiveBusinessData,LivePaymentProgress,LivePaymentStatus} from '../api';
import type {LiveView} from '../liveBusinessNavigation';
import {InfoTip} from '../InfoTip';
import {yuan,signedCents} from '../dashboardDisplay';
import './live-room-board.css';
import { CustomerPaymentSummary } from './CustomerPaymentSummary';
import { seriesColor } from './AnalysisChart';
import { RoomTrend } from './RoomTrend';

const statusNames:Record<LivePaymentStatus,string>={unpaid:'未收款',partial:'部分收款',settled:'已结清',unknown:'待核对'};
const empty:LivePaymentProgress={unpaid:0,partial:0,settled:0,unknown:0,total:0,followupCount:0};
const progressTip='本期开单的有效订单，按所选结束日之前已登记的客户付款逐单判断，含同单追加应收。使用客户约定币种的抵扣金额；第三方是否结汇不影响客户结清。跑单与退款源单排除。历史简版或资料不全列为待核对。不是开单营业额减去当日收款。';
const costTip='所选区间按费用发生日汇总已登记的供货、加工、接待、配件、证书、包装和发货等售后费用，不是财务实际付款，也不是完整经营成本。人员提成与演员费用在成本与收益中单独查看，不重复并入这里。';
function pending(value:string|null|undefined,status?:string){return status==='unsupported_scope'?'当前维度不分摊':value==null?'待财务录入':yuan(value);}
type Props={today:string;data:LiveBusinessData|null;loading:boolean;failed:boolean;onOpen:(view:LiveView['view'],roomKey?:string)=>void;onOpenOrder?:(id:string)=>void;onOpenOrders?:()=>void};

/* Demo-only operating view. Financial detail is retained behind disclosures.
 * Cohort payment progress and all-age follow-ups deliberately have separate scopes. */
export default function LiveRoomBoard({today,data,loading,failed,onOpen,onOpenOrders}:Props){
  const [sort,setSort]=useState('performance'),[expanded,setExpanded]=useState('');
  const op=data?.operations,t=data?.totals;
  const rooms=(data?.rooms??[]).filter(room=>room.key!=='__unassigned__').sort((a,b)=>{
    if(sort==='followup')return (op?.rooms[b.key]?.followupCount??0)-(op?.rooms[a.key]?.followupCount??0)||a.roomCode.localeCompare(b.roomCode);
    if(sort==='orders')return b.totals.newOrderCount-a.totals.newOrderCount||a.roomCode.localeCompare(b.roomCode);
    const field=sort==='expense'?'expenseCny':'performanceCny',x=signedCents(a.totals[field])??0n,y=signedCents(b.totals[field])??0n;
    return x===y?a.roomCode.localeCompare(b.roomCode):x>y?-1:1;
  });
  const maximum=Math.max(0,...rooms.map(r=>Number(r.totals.performanceCny)||0));
  return <div className="lr-board" aria-label="直播间经营看板" aria-busy={loading}>
    <section className="lr-summary" aria-label="直播间经营汇总">
      <button type="button" disabled={!data} onClick={()=>onOpen('income')}><span>开单营业额</span><strong>{loading?'…':yuan(t?.performanceCny)}</strong><small>料价＋代购费 · 按开单日</small></button>
      <button type="button" disabled={!op} onClick={()=>onOpen('income')}><span>有效开单</span><strong>{loading?'…':t?.newOrderCount??'—'}<small> 笔</small></strong><small>已排除跑单及退款源单</small></button>
      <article><CustomerPaymentSummary compact interactive={false} loading={loading} records={data?.events.filter(e=>e.kind==='receipt')??[]} totals={data?.totals.customerReceipts} onOpen={()=>onOpen('income')} detailLabel="客户付款明细"/></article>
      <article><span>已登记售后费用 <InfoTip label="经营看板售后费用口径" text={costTip}/></span><button type="button" className="lr-summary-value" disabled={!data} onClick={()=>onOpen('expenses')}><strong>{loading?'…':yuan(t?.expenseCny)}</strong></button><small>按费用发生日</small></article>
    </section>
    {data&&<BossReceivables data={data} onOpen={()=>onOpenOrders?.()}/>}
    <section className="lr-room-section" aria-label="直播间表现">
      <header className="lr-section-heading"><h2>直播间表现</h2><label>排序<select aria-label="经营表现排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="performance">营业额从高到低</option><option value="orders">开单笔数从高到低</option><option value="followup">待收款订单优先</option><option value="expense">售后费用从高到低</option></select></label></header>
      {loading?<p role="status">正在读取经营数据…</p>:failed?<p className="notice">数据读取失败，请重试后查看。</p>:!rooms.length?<p className="notice">所选范围暂无直播间经营记录。</p>:<div className="lr-rooms">{rooms.map((r,index)=>{
        const p=op?.rooms[r.key]??empty,profit=r.profit;
        return <details className="lr-room lr-room-compact" key={r.key} open={expanded===r.key} onToggle={e=>{if(e.currentTarget.open)setExpanded(r.key);else setExpanded(current=>current===r.key?'':current);}} aria-label={`${r.roomCode}经营表现`}>
          <summary className="lr-rank-row"><span className="lr-rank-name"><small>{index+1}</small><strong>{r.roomCode}</strong><small>{r.hosts.join('、')||'主播待补'}</small></span><span className="lr-rank-value"><b>{yuan(r.totals.performanceCny)}</b><small>有效开单 {r.totals.newOrderCount} 笔{p.followupCount?` · 待收款 ${p.followupCount}`:''}</small></span><span className="ar-track" aria-hidden="true"><i style={{width:`${maximum&&r.totals.performanceCny!==null?Number(r.totals.performanceCny)/maximum*100:0}%`,background:seriesColor(r.key)}}/></span><small className="lr-expand-label">{expanded===r.key?'收起详情 ↑':'付款进展与明细 ↓'}</small></summary>
          <div className="lr-room-expanded">
          <header><div><h3>{r.roomCode}</h3><p>{r.hosts.join('、')||'主播待补'}</p></div>{p.followupCount>0&&<span className="lr-attention">待收款 {p.followupCount} 单</span>}</header>
          <div className="lr-booking"><button type="button" onClick={()=>onOpen('income',r.key)}><small>开单营业额</small><strong>{yuan(r.totals.performanceCny)}</strong></button><button type="button" onClick={()=>onOpen('income',r.key)}><small>有效开单</small><b>{r.totals.newOrderCount} 笔</b></button></div>
          <div className="lr-progress"><span>付款进展 <InfoTip label={`${r.roomCode}付款进展口径`} text={progressTip}/></span>{!op?<p>付款资料待接入</p>:!p.total?<p>本期无有效开单</p>:<><div className="lr-status-track" aria-label={`付款状态：未收${p.unpaid}，部分${p.partial}，结清${p.settled}，待核对${p.unknown}`}>{(['unpaid','partial','settled','unknown'] as const).map(s=><i key={s} className={`lr-status-${s}`} style={{width:`${p[s]/p.total*100}%`}}/>)}</div><div className="lr-status-buttons">{(['unpaid','partial','settled','unknown'] as const).filter(s=>s!=='unknown'||p.unknown>0).map(s=><span key={s} className={p[s]>0&&s!=='settled'?'lr-has-open':''}>{statusNames[s]} <b>{p[s]}</b></span>)}</div></>}</div>
          <div className="lr-expense"><span>已登记售后费用</span><button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>{yuan(r.totals.expenseCny)} →</button></div>
          {(r.totals.cancelledOrderCount>0||Number(r.totals.excludedSourceCny)>0)&&<p className="lr-note">{r.totals.cancelledOrderCount?`跑单 ${r.totals.cancelledOrderCount} 单 · `:''}原开单已冲抵 {yuan(r.totals.excludedSourceCny)}</p>}
          <details className="lr-finance"><summary>成本与收益</summary>
            <dl><div><dt>料子本钱 <InfoTip label={`${r.roomCode}料本来源`} text="优先用开单卡料子本钱（按开单日），该字段缺省时回退供货／接待款（按费用发生日）；跑单料本排除。不与售后费用合计重复相加。"/></dt><dd>{yuan(profit?.materialCostCny)}</dd></div>
              {profit?.materialCostSources&&<div><dt>开单卡／回退供货款</dt><dd>{profit.materialCostSources.orderCardCny}／{profit.materialCostSources.expenseFallbackCny}</dd></div>}
              <div><dt>人员费用</dt><dd>{pending(profit?.staff.totalCny,profit?.staff.status)}</dd></div>
              <div><dt>主播提成</dt><dd>{pending(profit?.staff.hostCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>助理提成</dt><dd>{pending(profit?.staff.assistantCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>货主演员费用</dt><dd>{pending(profit?.staff.actorSessionFee.value,profit?.staff.status)}</dd></div>
              <div><dt>直播间毛利 <InfoTip label={`${r.roomCode}毛利口径`} text="沿用原口径：开单营业额－料子本钱－主播提成－助理提成－货主演员费用，不是公司净利润，不包含全部售后费用。缺提成时待核算；按主播、人设或客服筛选时不推测分摊。"/></dt><dd>{profit?.status==='unsupported_scope'?'当前维度不分摊':profit?.liveRoomProfitCny==null?'待核算':yuan(profit.liveRoomProfitCny)}</dd></div></dl>
            {profit?.staff.actorSessionFee.records.map(x=><p className="lr-note" key={x.id}>{x.date} · {x.session_label||'场次'} · ¥{x.amount_cny}</p>)}
            <button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>查看费用与付款明细 →</button>
          </details>
          {expanded===r.key&&data&&<RoomTrend room={r.key} to={data.period.to} today={today} filters={data.selected}/>}
          </div>
        </details>;
      })}</div>}
    </section>
    <details className="lr-more boss-panel"><summary>资金与历史核对</summary><div className="lr-more-actions"><button type="button" className="secondary" onClick={()=>onOpen('ads')}>全公司广告消耗</button></div><p className="lr-note">广告费用仍按全公司汇总，不按引流人设推测分摊到直播间。</p><details><summary>公司到账与历史费用核对</summary><div className="live-cash-grid"><div><small>公司人民币净到账</small><strong>{yuan(t?.companyReceivedCny)}</strong></div><div><small>财务实际付款</small><strong>{yuan(t?.supplierPaidCny)}</strong></div></div>{!!data?.legacyCost.count&&<p className="lr-note">{data.legacyCost.count} 笔历史成本日期待核对，未加入本期售后费用。</p>}</details></details>
  </div>;
}
