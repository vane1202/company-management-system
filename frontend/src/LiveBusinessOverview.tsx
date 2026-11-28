import {lazy,Suspense,useEffect,useState} from 'react';
import {api,type LiveBusinessFilters,type LiveBusinessEvent} from './api';
import {InfoTip} from './InfoTip';
import {DashboardIcon} from './DashboardIcon';
import {expenseLabels} from './commerceUi';
import {yuan} from './dashboardDisplay';
import {toErrorMessage} from './errors';
import {defaultLiveView,liveViewLabel,type LiveView} from './liveBusinessNavigation';
import {dashboardPresetRange} from './dates';
import {PeriodToolbar} from './PeriodToolbar';
import './live-business-tabs.css';
import {demoOrderRooms} from './demo/orderIdentity';
import {OrderStatusTags,StatusFilterBar} from './OrderStatusTagView';
import {classifyOrderStatus,matchesStatusFilter,type StatusFilter} from './orderStatusTags';

const kinds={sale:'开单卡',charge:'追加收费',expense:'业务费用',receipt:'客户付款',company:'公司到账',supplier:'公司付款'};
const scopeNote='营业额只计开单卡的料价和代购费，按开单卡日期归属；客户延后付款不影响原日营业额，收款不重复计入。跑单回冲原开单日，原始记录保留。设计雕刻等追加收费按发生日单列，不计入营业额。';
const LiveRoomBoard=lazy(()=>import('./demo/LiveRoomBoard'));
const MATERIAL_EXPENSE_CATEGORIES = new Set(['goods','sourcing','material']);
const cleanRoomName=(name:string)=>name.replace(/\s*[（(][^）)]*[）)]\s*$/,'').trim()||name;

type Props={preset?:string;range?:{from:string;to:string};tick?:number;today?:string;context?:LiveView;onOpenBusiness:(next:LiveView)=>void;onOpenOrder?:(id:string)=>void;onOpenOrders?:()=>void};

export function LiveBusinessOverview({preset='day',range,tick=0,today='',context,onOpenBusiness,onOpenOrder,onOpenOrders}:Props){
 const workspace=!!context;
 const compactRoomFilter=workspace;
 const [homeFilters,setHomeFilters]=useState<LiveBusinessFilters>(defaultLiveView().filters);
 const current:LiveView=context??{view:'rooms',preset:preset as LiveView['preset'],range,filters:homeFilters};
 const filters=current.filters,period=current.range,periodPreset=current.preset;
 const [data,setData]=useState<Awaited<ReturnType<typeof api.liveBusiness>>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [statusFilter,setStatusFilter]=useState<StatusFilter>('all');
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');api.liveBusiness(periodPreset,period,filters).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[periodPreset,period?.from,period?.to,filters.room,filters.host,filters.persona,filters.operator,tick,retry]);
 const label=period?'区间':periodPreset==='week'?'本周':periodPreset==='month'?'本月':'当日';
 const activeFilters=Object.values(filters).some(Boolean),t=data?.totals;
 const options=(key:keyof LiveBusinessFilters)=>[...new Set(data?.options.map(o=>o[key]).filter(Boolean)??[])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 function changeFilters(next:LiveBusinessFilters){if(workspace)onOpenBusiness({...current,view:'rooms',roomKey:undefined,filters:next});else setHomeFilters(next);}
 function open(view:LiveView['view'],roomKey?:string){onOpenBusiness({...current,view,roomKey});}

 const activeTab = current.view === 'expenses' ? 'expenses' : (current.view === 'income' || current.view === 'afterSales' || current.view === 'paid') ? 'income' : current.view === 'ads' ? 'ads' : 'rooms';
 const roomMatched = (roomCode?: string) => !current.roomKey || (roomCode || '__unassigned__') === current.roomKey;
 const events=data?.events.filter(e=>roomMatched(e.order.live_room_code)&&(activeTab==='income'?['sale','charge'].includes(e.kind):activeTab==='expenses'?['expense','supplier'].includes(e.kind):false))??[];
 const room=data?.rooms.find(r=>r.key===current.roomKey);
 const detailTotals=current.roomKey?room?.totals:t;

 const statusOrders=(data?.orderStatusList??[])
  .filter(o=>roomMatched(o.roomKey==='__unassigned__'?'':o.roomKey))
  .filter(o=>matchesStatusFilter(classifyOrderStatus(o),statusFilter));

 const roomReimbursements=(data?.roomSummary?.roomReimbursements??[]).filter(r=>{
  if(!current.roomKey)return true;
  const target=data?.rooms.find(rm=>rm.key===current.roomKey);
  return r.live_room_name===current.roomKey||(target&&r.live_room_name===cleanRoomName(target.roomCode));
 });

 const renderEvent=(e:LiveBusinessEvent)=><article className="live-event-row" key={`${e.kind}:${e.id}`}><span><strong>{kinds[e.kind]} · {e.label}</strong><small>{e.date} · {e.order.order_ref} · {e.order.customer_label||'客户待补'}</small><small>{cleanRoomName(e.order.live_room_code||'未归属直播间')} · {e.order.host_name||'主播待补'} · {e.order.persona_code||'人设ID待补'} · 客服 {e.order.operator_name||e.order.wechat_id||'待补'}</small>{e.category&&<small>{import.meta.env.MODE==='demo'&&e.category==='sourcing'?'接待':expenseLabels[e.category]??e.category}</small>}{['sale','charge'].includes(e.kind)&&(e.order.cancelled||e.order.status==='refunded')&&<small className="data-flag">{e.order.cancelled?'已跑单 · 回冲原开单日营业额':'历史退款标记 · 原开单已排除'}{e.kind==='charge'?' · 追加金额已排除':''}</small>}<button type="button" className="text-action" onClick={()=>onOpenOrder?.(e.order_id)}>查看订单档案 →</button></span><b>{e.amount} {e.currency}</b></article>;

 return <div className="live-business-overview" aria-busy={loading}>
  {workspace&&<header className="commerce-heading"><div><p className="eyebrow">直播间经营明细</p><div className="live-heading-title"><h1>{liveViewLabel(current)}</h1></div></div>{onOpenOrders&&<div className="actions"><button className="secondary" type="button" onClick={onOpenOrders}>订单档案</button></div>}</header>}
  {workspace&&<PeriodToolbar
    today={today}
    preset={periodPreset}
    custom={period}
    onPreset={key=>onOpenBusiness({...current,preset:key,range:undefined})}
    onCustom={next=>onOpenBusiness({...current,range:next})}
    filters={<>
      {compactRoomFilter&&<select className="live-room-select" aria-label="选择直播间" value={filters.room} onChange={e=>changeFilters({...defaultLiveView().filters,room:e.target.value})}><option value="">全部直播间</option>{demoOrderRooms.map(room=><option key={room.code} value={room.code}>{cleanRoomName(room.name)}</option>)}</select>}
      <details className={`pt-more-filters${activeFilters?' is-active':''}`}><summary>{compactRoomFilter?"更多筛选":"直播间筛选"}{activeFilters?' · 已选':''}</summary><div className="pt-more-filters-panel">{([['room','直播间'],['host','主播'],['persona','人设ID'],['operator','对接客服']] as const).filter(([key])=>!compactRoomFilter||key!=='room').map(([key,name])=><label key={key}>{name}<select aria-label={`经营总览${name}筛选`} value={filters[key]} disabled={loading} onChange={e=>changeFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{key==='room'&&<option value="__unassigned__">未归属直播间</option>}{[...new Set([...options(key),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{key==='room'?cleanRoomName(data?.rooms.find(room=>room.key===value)?.roomCode||value):value}{key==='persona'?' · '+(data?.options.find(o=>o.persona===value)?.persona_name||''):''}</option>)}</select></label>)}{activeFilters&&<button type="button" className="secondary pt-filter-clear" onClick={()=>changeFilters(defaultLiveView().filters)}>清除筛选</button>}</div></details>
    </>}
    actions={<button className="secondary" type="button" disabled={loading} onClick={()=>setRetry(v=>v+1)}>刷新</button>}
    ariaLabel="经营日期与筛选"
  />}
  {workspace&&<nav className="live-business-tabs" aria-label="直播间经营分类">{([['rooms','经营概况'],['income','订单与收款明细'],['expenses','费用与成本明细']] as const).map(([view,name])=><button type="button" key={view} aria-pressed={activeTab===view} onClick={()=>onOpenBusiness({...current,view,roomKey:undefined,filters:current.roomKey?{...filters,room:current.roomKey}:filters})}>{name}</button>)}</nav>}
  {!workspace&&<details className="live-filter-panel"><summary>直播间筛选{activeFilters?' · 已设置':' · 全部'}</summary><div className="live-filter-grid">{([['room','直播间'],['host','主播'],['persona','人设ID'],['operator','对接客服']] as const).map(([key,name])=><label key={key}>{name}<select aria-label={`经营总览${name}筛选`} value={filters[key]} disabled={loading} onChange={e=>changeFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{key==='room'&&<option value="__unassigned__">未归属直播间</option>}{[...new Set([...options(key),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{key==='room'?cleanRoomName(data?.rooms.find(room=>room.key===value)?.roomCode||value):value}{key==='persona'?' · '+(data?.options.find(o=>o.persona===value)?.persona_name||''):''}</option>)}</select></label>)}</div>{activeFilters&&<button type="button" className="secondary" onClick={()=>changeFilters(defaultLiveView().filters)}>清除直播间筛选</button>}</details>}
  {error&&<div className="overview-error" role="alert"><strong>直播间经营数据暂不可用</strong><p>{error}</p><button type="button" onClick={()=>setRetry(v=>v+1)}>重试经营数据</button></div>}
  {!workspace&&<><section className="live-primary" aria-label="经营核心数据">
   <button type="button" disabled={!data} onClick={()=>open('income')}><span><strong>直播间{label}营业额</strong><small>开单卡 · 料价＋代购费</small></span><span className="live-kpi-value">{yuan(t?.performanceCny)}<small>CNY</small></span><span className="live-kpi-extra">有效开单 {t?.newOrderCount??'—'} 笔 · 跑单冲抵 {yuan(t?.cancelledSalesCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open('expenses')}><span><strong>直播间{label}费用</strong><small>按费用发生日</small></span><span className="live-kpi-value">{yuan(t?.expenseCny)}<small>CNY</small></span><span className="live-kpi-extra">{label}实际付款 {yuan(t?.supplierPaidCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open('ads')}><span><strong>运营成本</strong><small>全公司 · {label}广告消耗</small></span><span className="live-kpi-value">{data?.ads.spendUsd??'—'}<small>USD</small></span><span className="live-kpi-extra">按实际投放消耗统计</span><DashboardIcon name="arrow"/></button>
  </section><section className="live-secondary-kpis" aria-label="独立业绩与售后收款"><button type="button" className="secondary" disabled={!data} onClick={()=>open('income')}><span>已付款业绩 · 财务核定</span><strong>{yuan(data?.paidPerformance?.amountCny)} <small>CNY</small></strong><small>{data?.paidPerformance?.recordCount?`已录入 ${data.paidPerformance.recordCount} 条`:'尚未录入核定结果'}</small></button><button type="button" className="secondary" disabled={!data} onClick={()=>open('income')}><span>售后收款 · 按付款日</span><strong>{data?.afterSales?.recordCount?yuan(data.afterSales.receipts.CNY):'—'} <small>CNY</small></strong><small>{data?.afterSales?.recordCount?`TWD ${data.afterSales.receipts.TWD} · USD ${data.afterSales.receipts.USD}`:'尚无明确归类的售后收款'}</small></button></section><div className="live-summary-link"><button type="button" className="text-action" onClick={()=>open('rooms')}>查看直播间经营明细 <DashboardIcon name="arrow"/></button></div></>}

  {workspace&&activeTab==='rooms'&&<Suspense fallback={<p role="status">正在读取经营看板…</p>}><LiveRoomBoard today={today} data={data} loading={loading} failed={!!error} onOpen={open} onOpenOrders={onOpenOrders}/></Suspense>}

  {workspace&&activeTab==='ads'&&<section className="boss-panel live-event-panel" aria-label="广告消耗明细">
    <div className="panel-heading"><h2>广告消耗明细</h2>{data&&<strong className="live-detail-total">{data.ads.spendUsd} USD</strong>}</div>
    <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · 全公司 · USD</p>
    {!!data?.ads.unknownCount&&<p className="data-flag">{data.ads.unknownCount} 条历史日报未记录美元消耗，未推测为0。</p>}
    {!data?.ads.records.length&&<p>当前范围暂无已登记的广告消耗。</p>}
    {data?.ads.records.map(a=><article className="live-event-row" key={a.id}><span><strong>{a.persona||'人设待补'}</strong><small>{a.date} · {a.account}</small></span><b>{a.amount} USD</b></article>)}
  </section>}

  {workspace&&activeTab==='income'&&<div className="lr-merged-stack">
   <section className="boss-panel live-event-panel" aria-label="订单与收款明细">
    <div className="panel-heading">
     <h2>订单与收款明细<InfoTip label="收支统计口径" text={scopeNote}/></h2>
     <div className="lr-merged-actions">
      {data&&<strong className="live-detail-total">{yuan(detailTotals?.performanceCny)} CNY</strong>}
      {onOpenOrders&&<button type="button" className="secondary" onClick={onOpenOrders}>全部订单档案 →</button>}
     </div>
    </div>
    <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · {current.roomKey==='__unassigned__'?'未归属直播间':cleanRoomName(current.roomKey||'全部直播间')} · 原开单 {yuan(detailTotals?.grossSalesCny)} · 已冲抵 {yuan(detailTotals?.excludedSourceCny)}</p>
    <StatusFilterBar value={statusFilter} onChange={setStatusFilter}/>
    {loading?<p role="status">正在读取订单明细…</p>:!statusOrders.length?<p className="empty-state">当前筛选条件下暂无开单记录。</p>:<div className="lr-status-order-list">
     {statusOrders.map(o=>{
      const statusView=classifyOrderStatus(o);
      return <article className="live-event-row" key={o.id}>
       <span>
        <div className="lr-order-title-line">
         <strong>{o.customerLabel}</strong>
         <OrderStatusTags facts={o}/>
        </div>
        <small>{o.orderRef} · {o.businessDate} · {cleanRoomName(o.roomCode)} · 主播 {o.hostName} · 客服 {o.operatorName}</small>
        {statusView.followup&&<small className="lr-followup-line">{statusView.followup}</small>}
        <button type="button" className="text-action" onClick={()=>onOpenOrder?.(o.id)}>查看订单档案 →</button>
       </span>
       <b>{yuan(o.bookingAmount)} CNY</b>
      </article>;
     })}
    </div>}

    {events.some(e=>e.kind==='charge')&&<section className="live-additional-section" aria-label="追加收费（不计营业额）"><header className="panel-heading"><h3>追加收费（不计营业额）</h3><strong>{yuan(detailTotals?.additionalCny)} CNY</strong></header>{events.filter(e=>e.kind==='charge').map(renderEvent)}</section>}

    <details className="live-cash-details" open><summary>客户收款与公司到账</summary><div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>客户实际付款 · {cur}</small><strong>{detailTotals?.customerReceipts[cur]??'—'}</strong></div>)}<div><small>公司人民币净到账 · CNY</small><strong>{detailTotals?.companyReceivedCny??'—'}</strong></div></div>{data?.events.filter(e=>['receipt','company'].includes(e.kind)&&roomMatched(e.order.live_room_code)).map(e=><article className="live-event-row" key={`${e.kind}:${e.id}`}><span><strong>{kinds[e.kind]} · {e.label}</strong><small>{e.date} · {e.order.order_ref}</small><button type="button" className="text-action" onClick={()=>onOpenOrder?.(e.order_id)}>查看订单档案 →</button></span><b>{e.amount} {e.currency}</b></article>)}</details>
   </section>

   <section className="boss-panel">
    <div className="panel-heading"><h2>售后收款与业务毛利</h2><strong>{data?.afterSales?.recordCount?yuan(data.afterSales.receipts.CNY)+' CNY':'暂无明确售后收款'}</strong></div>
    <p className="live-scope">收款按实际付款日、币种分别汇总；业务毛利按同一售后收费单的人民币报价减去累计已录齐成本，不受跨日收款或发货影响。</p>
    <div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>售后实收 · {cur}</small><strong>{data?.afterSales?.receipts[cur]??'—'}</strong></div>)}</div>
    {!!data?.afterSales?.unclassifiedReceiptCount&&<p className="data-flag">另有 {data.afterSales.unclassifiedReceiptCount} 笔收款未明确关联售后业务，未推测归类。</p>}
    {data?.afterSales?.records.filter((r,i,all)=>all.findIndex(x=>x.charge_id===r.charge_id)===i).map(r=><article className="live-after-sale-record" key={r.charge_id}><div className="panel-heading"><h3>{r.label} · {r.customer_label}</h3><button className="text-action" type="button" onClick={()=>onOpenOrder?.(r.order_id)}>查看订单档案 →</button></div><p className="live-scope">{r.order_ref} · {cleanRoomName(r.live_room_code||'直播间待补')} · {r.host_name} · 客服 {r.operator_name}</p><div className="live-cash-grid"><div><small>售后人民币报价</small><strong>{r.quoted_cny}</strong></div><div><small>累计业务成本</small><strong>{r.cost_cny}</strong></div><div><small>业务毛利 · CNY</small><strong>{r.margin_cny??'成本待录齐'}</strong></div></div>{data.afterSales.records.filter(p=>p.charge_id===r.charge_id).map(p=><p className="live-scope" key={p.id}>{p.date} 实收 {p.amount} {p.currency}</p>)}</article>)}
   </section>

   <section className="boss-panel">
    <div className="panel-heading"><h2>财务核定的已付款业绩</h2><strong className="live-detail-total">{yuan(data?.paidPerformance?.amountCny)} CNY</strong></div>
    <p className="live-scope">按开单日、直播间和主播录入；不按人设／客服拆分，不计算主播提成。</p>
    {data&&!data.paidPerformance?.recordCount&&<p>当前范围尚未录入核定结果。</p>}
    {data?.paidPerformance?.records.map(r=><article key={r.id} className="live-event-row"><span><strong>{cleanRoomName(r.live_room_code)} · {r.host_name}</strong><small>{r.date}</small>{r.note&&<small>{r.note}</small>}</span><b>{r.amount_cny} CNY</b></article>)}
   </section>
  </div>}

  {workspace&&activeTab==='expenses'&&<div className="lr-merged-stack">
   <section className="boss-panel live-event-panel" aria-label="费用与成本明细">
    <div className="panel-heading">
     <h2>费用与成本明细<InfoTip label="费用与成本口径" text="统一归集直播间料子本钱、人员场次费、售后成本与主管关联直播间已核报销；不含全公司投流消耗。"/></h2>
     {data&&<strong className="live-detail-total">{yuan(data.roomSummary?.totalDirectExpenseCny??detailTotals?.expenseCny)} CNY</strong>}
    </div>
    <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · {current.roomKey==='__unassigned__'?'未归属直播间':cleanRoomName(current.roomKey||'全部直播间')}</p>
    <div className="live-cash-grid">
     <div><small>料子本钱（白条/供货）</small><strong>{yuan(data?.roomSummary?.totalMaterialCostCny)}</strong></div>
     <div><small>人员场次费</small><strong>{yuan(data?.roomSummary?.totalStaffCostCny)}</strong></div>
     <div><small>已登记售后成本</small><strong>{yuan(data?.roomSummary?.totalAfterSaleCostCny)}</strong></div>
     <div><small>主管直播间报销</small><strong>{yuan(data?.roomSummary?.totalRoomReimbursementCny)}</strong></div>
    </div>

    <h3 className="lr-sub-heading">主管关联直播间报销（已核）</h3>
    {!roomReimbursements.length?<p className="live-scope">当前范围暂无已核关联直播间报销。</p>:roomReimbursements.map(r=>(
     <article className="live-event-row" key={r.id}><span><strong>{cleanRoomName(r.live_room_name)} · {r.purpose}</strong><small>{r.expense_date} · 填报人 {r.claimant}</small></span><b>{r.amount} CNY</b></article>
    ))}

    <h3 className="lr-sub-heading">售后与业务成本明细（不含重复料本）</h3>
    {!events.filter(e=>e.kind==='expense'&&!MATERIAL_EXPENSE_CATEGORIES.has(e.category)).length?<p className="live-scope">当前范围暂无售后与加工费用明细。</p>:events.filter(e=>e.kind==='expense'&&!MATERIAL_EXPENSE_CATEGORIES.has(e.category)).map(renderEvent)}

    <h3 className="lr-sub-heading">料子本钱明细（供货/配货回退记录）</h3>
    {!events.filter(e=>e.kind==='expense'&&MATERIAL_EXPENSE_CATEGORIES.has(e.category)).length?<p className="live-scope">料本主要来自开单卡直接填报的料子本钱字段。</p>:events.filter(e=>e.kind==='expense'&&MATERIAL_EXPENSE_CATEGORIES.has(e.category)).map(renderEvent)}

    <details className="live-cash-details"><summary>公司实际付款流水（供应商结算）</summary>{!events.filter(e=>e.kind==='supplier').length?<p className="live-scope">当前范围暂无供应商付款流水。</p>:events.filter(e=>e.kind==='supplier').map(renderEvent)}</details>
   </section>
  </div>}
 </div>;
}
