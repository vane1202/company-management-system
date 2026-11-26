import BossReceivables from "./BossReceivables";
import {useState} from 'react';
import type {LiveBusinessData,LivePaymentProgress,LivePaymentStatus} from '../api';
import type {LiveView} from '../liveBusinessNavigation';
import {InfoTip} from '../InfoTip';
import {yuan,signedCents} from '../dashboardDisplay';
import './live-room-board.css';
import { CustomerPaymentSummary } from './CustomerPaymentSummary';
import { RoomTrend } from './RoomTrend';

const statusNames:Record<LivePaymentStatus,string>={unpaid:'未收款',partial:'部分收款',settled:'已结清',unknown:'待核对'};
const statuses = ['settled', 'partial', 'unpaid', 'unknown'] as const;
const roomSorts = [['room','按房号'],['performance','按业绩'],['orders','按新单'],['followup','按跟进'],['expense','按售后费']] as const;
const roomNumber = new Map([['一号直播间',1],['二号直播间',2]]);
function compareRoomNumbers(a: string, b: string) {
  return (roomNumber.get(a) ?? 3) - (roomNumber.get(b) ?? 3) || a.localeCompare(b, 'zh-CN', {numeric:true});
}
const empty:LivePaymentProgress={unpaid:0,partial:0,settled:0,unknown:0,total:0,followupCount:0};
const progressTip='本期开单的有效订单，按所选结束日之前已登记的客户付款逐单判断，含同单追加应收。使用客户约定币种的抵扣金额；第三方是否结汇不影响客户结清。跑单与退款源单排除。历史简版或资料不全列为待核对。不是开单营业额减去当日收款。';
const costTip='所选区间按费用发生日汇总已登记的供货、加工、接待、配件、证书、包装和发货等售后费用，不是财务实际付款，也不是完整经营成本。人员提成与演员费用在成本与收益中单独查看，不重复并入这里。';
function pending(value:string|null|undefined,status?:string){return status==='unsupported_scope'?'当前维度不分摊':value==null?'待财务录入':yuan(value);}
type Props={today:string;data:LiveBusinessData|null;loading:boolean;failed:boolean;onOpen:(view:LiveView['view'],roomKey?:string)=>void;onOpenOrders?:()=>void};

// Cohort payment progress and all-age follow-ups use separate scopes.
export default function LiveRoomBoard({today,data,loading,failed,onOpen,onOpenOrders}:Props){
  const [sort,setSort]=useState<(typeof roomSorts)[number][0]>('room'),[expanded,setExpanded]=useState('');
  const op=data?.operations,t=data?.totals;
  const rooms=(data?.rooms??[]).filter(room=>room.key!=='__unassigned__').sort((a,b)=>{
    const byRoom = compareRoomNumbers(a.roomCode, b.roomCode);
    if(sort==='room')return byRoom;
    if(sort==='followup')return (op?.rooms[b.key]?.followupCount??0)-(op?.rooms[a.key]?.followupCount??0)||byRoom;
    if(sort==='orders')return b.totals.newOrderCount-a.totals.newOrderCount||byRoom;
    const field=sort==='expense'?'expenseCny':'performanceCny',x=signedCents(a.totals[field])??0n,y=signedCents(b.totals[field])??0n;
    return x===y?byRoom:x>y?-1:1;
  });
  const maximum=Math.max(0,...rooms.map(r=>Number(r.totals.performanceCny)||0));
  return <div className="lr-board" aria-label="直播间经营看板" aria-busy={loading}>
    <section className="lr-summary" aria-label="直播间经营汇总">
      <button className="lr-summary-hero" type="button" disabled={!data} onClick={()=>onOpen('income')}><span>直播间开单营业额</span><strong>{loading?'…':yuan(t?.performanceCny)}</strong><small>料价＋代购费 · 按开单日</small></button>
      <button type="button" disabled={!op} onClick={()=>onOpen('income')}><span>有效开单</span><strong>{loading?'…':t?.newOrderCount??'—'}<small> 笔</small></strong><small>已排除跑单及退款源单</small></button>
      <article className="lr-summary-cash"><CustomerPaymentSummary compact interactive={false} loading={loading} records={data?.events.filter(e=>e.kind==='receipt')??[]} totals={data?.totals.customerReceipts} onOpen={()=>onOpen('income')} detailLabel="客户付款明细"/>{data && <BossReceivables data={data} onOpen={()=>onOpenOrders ? onOpenOrders() : onOpen('income')}/>}</article>
      <article><span>已登记售后费用 <InfoTip label="经营看板售后费用口径" text={costTip}/></span><button type="button" className="lr-summary-value" disabled={!data} onClick={()=>onOpen('expenses')}><strong>{loading?'…':yuan(t?.expenseCny)}</strong></button><small>按费用发生日</small></article>
    </section>
    <section className="lr-room-section" aria-label="直播间表现">
      <header className="lr-section-heading"><h2>直播间表现</h2><div className="lr-sort" role="group" aria-label="经营表现排序">
        {roomSorts.map(([key,label]) =>
          <button type="button" key={key} aria-pressed={sort===key} onClick={()=>setSort(key)}>{label}</button>)}
      </div></header>
      {loading?<p role="status">正在读取经营数据…</p>:failed?<p className="notice">数据读取失败，请重试后查看。</p>:!rooms.length?<p className="notice">所选范围暂无直播间经营记录。</p>:<div className="lr-rooms">{rooms.map((r,index)=>{
        const p=op?.rooms[r.key]??empty,profit=r.profit;
        const turnover=Number(r.totals.performanceCny);
        const margin=profit?.status==='ok'&&profit.liveRoomProfitCny!=null ? Number(profit.liveRoomProfitCny) : null;
        const marginRate=margin!==null&&Number.isFinite(margin)&&turnover>0 ? (margin/turnover*100).toFixed(1)+'%' : '—';
        const profitLabel=profit?.status==='unsupported_scope' ? '当前维度不分摊' : margin===null ? '待核算' : yuan(profit?.liveRoomProfitCny);
        return <details className="lr-room lr-room-compact" key={r.key} open={expanded===r.key} onToggle={e=>{if(e.currentTarget.open)setExpanded(r.key);else setExpanded(current=>current===r.key?'':current);}} aria-label={`${r.roomCode}经营表现`}>
          <summary className="lr-rank-row">
            <span className="lr-rank-name">
              <span className="lr-rank-badge" data-first={index===0}>{index+1}</span>
              <strong>{r.roomCode}</strong><span className="lr-chip">{r.hosts.join('、')||'主播待补'}</span>
              {p.followupCount>0 && <span className="lr-chip lr-chip-gold">待跟进 {p.followupCount} 单</span>}
            </span>
            <span className="lr-head-metrics">
              <span><small>直播间业绩</small><b>{yuan(r.totals.performanceCny)}</b></span>
              <span><small>有效新单</small><b>{r.totals.newOrderCount} 笔</b></span>
              <span><small>估算毛利</small><b>{profitLabel}</b></span>
            </span>
            <span className="lr-share-track" aria-hidden="true"><i style={{width:`${maximum>0 ? Math.max(0,turnover||0)/maximum*100 : 0}%`}}/></span>
            <small className="lr-expand-label">{expanded===r.key?'收起详情 ↑':'查看经营拆解 ↓'}</small>
          </summary>
          <div className="lr-room-expanded">
            <section className="lr-breakdown">
              <h3>收款状态分布 <InfoTip label={`${r.roomCode}付款进展口径`} text={progressTip}/></h3>
              {!op ? <p className="lr-note">付款资料待接入</p> : <>
                <div className="lr-status-track" aria-hidden="true">{statuses.map(status=><i key={status} className={`lr-status-${status}`} style={{width:`${p.total ? p[status]/p.total*100 : 0}%`}}/>)}</div>
                <div className="lr-status-legend">{statuses.map(status=><span key={status}><i className={`lr-status-${status}`}/>{statusNames[status]} <b>{p[status]} 笔</b></span>)}</div>
              </>}
              <div className="lr-room-links">
                <button type="button" className="text-action" onClick={()=>onOpen('income',r.key)}>开单与收款 {r.totals.newOrderCount} 笔 →</button>
                <button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>售后费用 {yuan(r.totals.expenseCny)} →</button>
              </div>
              {(r.totals.cancelledOrderCount>0||Number(r.totals.excludedSourceCny)>0)&&<p className="lr-note">{r.totals.cancelledOrderCount?`跑单 ${r.totals.cancelledOrderCount} 单 · `:''}原开单已冲抵 {yuan(r.totals.excludedSourceCny)}</p>}
              {expanded===r.key&&data&&<RoomTrend room={r.key} to={data.period.to} today={today} filters={data.selected}/>}
            </section>
            <section className="lr-breakdown lr-finance">
              <h3>成本与毛利拆解 <span className="lr-chip">毛利率 {marginRate}</span></h3>
            <dl><div><dt>料子本钱 <InfoTip label={`${r.roomCode}料本来源`} text="优先用开单卡料子本钱（按开单日），该字段缺省时回退供货／接待款（按费用发生日）；跑单料本排除。不与售后费用合计重复相加。"/></dt><dd>{yuan(profit?.materialCostCny)}</dd></div>
              {profit?.materialCostSources&&<div><dt>开单卡／回退供货款</dt><dd>{profit.materialCostSources.orderCardCny}／{profit.materialCostSources.expenseFallbackCny}</dd></div>}
              <div><dt>人员费用</dt><dd>{pending(profit?.staff.totalCny,profit?.staff.status)}</dd></div>
              <div><dt>主播提成</dt><dd>{pending(profit?.staff.hostCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>助理提成</dt><dd>{pending(profit?.staff.assistantCommission.value,profit?.staff.status)}</dd></div>
              <div><dt>货主演员费用</dt><dd>{pending(profit?.staff.actorSessionFee.value,profit?.staff.status)}</dd></div>
              <div><dt>已登记售后费用</dt><dd>{yuan(r.totals.expenseCny)}</dd></div>
              <div className="lr-profit-total"><dt>直播间毛利 <InfoTip label={`${r.roomCode}毛利口径`} text="沿用原口径：开单营业额－料子本钱－主播提成－助理提成－货主演员费用，不是公司净利润，不包含全部售后费用。缺提成时待核算；按主播、人设或客服筛选时不推测分摊。"/></dt><dd>{profitLabel}</dd></div></dl>
            {profit?.staff.actorSessionFee.records.map(x=><p className="lr-note" key={x.id}>{x.date} · {x.session_label||'场次'} · ¥{x.amount_cny}</p>)}
            <button type="button" className="text-action" onClick={()=>onOpen('expenses',r.key)}>查看费用与付款明细 →</button>
            </section>
          </div>
        </details>;
      })}</div>}
    </section>
    <details className="lr-more boss-panel"><summary>资金与历史核对</summary><div className="lr-more-actions">{onOpenOrders && <button type="button" className="secondary" onClick={onOpenOrders}>订单档案 →</button>}<button type="button" className="secondary" onClick={()=>onOpen('income')}>收款与到账 →</button><button type="button" className="secondary" onClick={()=>onOpen('ads')}>全公司广告消耗</button></div><p className="lr-note">广告费用仍按全公司汇总，不按引流人设推测分摊到直播间。</p><div className="live-cash-grid"><div><small>公司人民币净到账</small><strong>{yuan(t?.companyReceivedCny)}</strong></div><div><small>财务实际付款</small><strong>{yuan(t?.supplierPaidCny)}</strong></div></div>{!!data?.legacyCost.count&&<p className="lr-note">{data.legacyCost.count} 笔历史成本日期待核对，未加入本期售后费用。</p>}</details>
  </div>;
}
