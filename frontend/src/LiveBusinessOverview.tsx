import {lazy,Suspense,useEffect,useState} from 'react';
import {api,type LiveBusinessFilters,type LiveBusinessEvent} from './api';
import {InfoTip} from './InfoTip';
import {DashboardIcon} from './DashboardIcon';
import {expenseLabels} from './commerceUi';
import {signedCents,yuan} from './dashboardDisplay';
import {toErrorMessage} from './errors';
import {defaultLiveView,liveViewLabel,type LiveView} from './liveBusinessNavigation';
import {dashboardPresetRange} from './dates';
import {PeriodToolbar} from './PeriodToolbar';
import './live-business-tabs.css';
import {demoOrderRooms} from './demo/orderIdentity';

const kinds={sale:'开单卡',charge:'追加收费',expense:'业务费用',receipt:'客户付款',company:'公司到账',supplier:'公司付款'};
const scopeNote='营业额只计开单卡的料价和代购费，按开单卡日期归属；客户延后付款不影响原日营业额，收款不重复计入。跑单回冲原开单日，原始记录保留。设计雕刻等追加收费按发生日单列，不计入营业额；历史退款标记源单继续单列排除，不等于退款资金流水。费用按费用发生日，实际付款按财务付款日，分别列示。广告消耗为全公司所选日期范围，不随直播间筛选缩小。';
const profitTips={
  turnover:'开单卡成交价＋已登记代购费（默认 10%），按开单日归属；未付款也计入，延后收款不重复计入。追加收费另列，不计入。跑单回冲原开单日，原始记录保留。来源：开单卡。',
  material:'翡翠料子本钱。优先采用开单卡「料子本钱」字段（按开单日）。仅当该单没有此字段时，才回退该单已登记的供货款/配货款（费用发生日）。不含工费、运费、证书、包装等。跑单订单的料子本钱不计入成本（与营业额排除一致）；历史退款标记源单同样排除。明确登记 0 视为已录入，不作估算。',
  staff:'人员费用＝财务已录入的主播提成＋主播助理提成＋按次货主演员费用。金额由财务登记，系统不按比例计算。底薪走工资单，不计入本项。人员费用仅按日期、直播间汇总，按主播、人设或客服筛选时不分摊。主播或助理提成在本区间尚未录入时显示待财务录入（明确录入 0 为已录入）。当日无货主演员场次时该项默认为 0，不显示待录入。来源：财务录入（演示为虚构）。',
  profit:'直播间毛利＝营业额－料子本钱－主播提成－助理提成－货主演员费用。跑单订单的营业额与料子本钱均不计入。任一提成未录入则显示待核算，不作估算。无货主演员场次按 0。本项只用于直播间经营页。经营总览的「毛利（估）」不扣这些项；「实际毛利」仍待财务专项核算。'
};
const showLiveProfit=import.meta.env.MODE==='demo';
const DemoLiveRoomBoard=import.meta.env.MODE==='demo'?lazy(()=>import('./demo/LiveRoomBoard')):null;
function moneyOrPending(value:string|null|undefined,pending:string,status?:string){return status==='unsupported_scope'?'当前维度不分摊':value==null?pending:value;}
function materialSourceLabel(p?:{materialCostSources?:{orderCardCny:string;expenseFallbackCny:string}}){
  const s=p?.materialCostSources;if(!s)return '';
  const bits=[s.orderCardCny&&s.orderCardCny!=='0.00'?`开单卡 ${s.orderCardCny}`:'',s.expenseFallbackCny&&s.expenseFallbackCny!=='0.00'?`回退供货款 ${s.expenseFallbackCny}`:''].filter(Boolean);
  return bits.join(' · ');
}


type Props={preset?:string;range?:{from:string;to:string};tick?:number;today?:string;context?:LiveView;onOpenBusiness:(next:LiveView)=>void;onOpenOrder?:(id:string)=>void;onOpenOrders?:()=>void};

/* Existing light/jade palette is retained. The homepage answers today's totals;
 * room breakdowns and cash-date detail belong to the business workspace. */
export function LiveBusinessOverview({preset='day',range,tick=0,today='',context,onOpenBusiness,onOpenOrder,onOpenOrders}:Props){
 const workspace=!!context;
 const compactRoomFilter=workspace&&import.meta.env.MODE==='demo';
 const [homeFilters,setHomeFilters]=useState<LiveBusinessFilters>(defaultLiveView().filters);
 const current:LiveView=context??{view:'rooms',preset:preset as LiveView['preset'],range,filters:homeFilters};
 const filters=current.filters,period=current.range,periodPreset=current.preset;
 const [data,setData]=useState<Awaited<ReturnType<typeof api.liveBusiness>>|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [sort,setSort]=useState('performanceCny');
 const [draft,setDraft]=useState(()=>period??dashboardPresetRange(today,periodPreset)),[rangeError,setRangeError]=useState('');
 useEffect(()=>{if(workspace)setDraft(period??dashboardPresetRange(today,periodPreset));},[workspace,period?.from,period?.to,periodPreset,today]);
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');api.liveBusiness(periodPreset,period,filters).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[periodPreset,period?.from,period?.to,filters.room,filters.host,filters.persona,filters.operator,tick,retry]);
 const label=period?'区间':periodPreset==='week'?'本周':periodPreset==='month'?'本月':'当日';
 const activeFilters=Object.values(filters).some(Boolean),t=data?.totals;
 const options=(key:keyof LiveBusinessFilters)=>[...new Set(data?.options.map(o=>o[key]).filter(Boolean)??[])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 function changeFilters(next:LiveBusinessFilters){if(workspace)onOpenBusiness({...current,view:'rooms',roomKey:undefined,filters:next});else setHomeFilters(next);}
 function open(view:LiveView['view'],roomKey?:string){onOpenBusiness({...current,view,roomKey});}
 const rows=[...(data?.rooms??[])].sort((a,b)=>{
  const pick=(r:typeof a)=>{
    if(showLiveProfit&&sort==='materialCostCny')return signedCents(r.profit?.materialCostCny);
    if(showLiveProfit&&sort==='staffTotal')return signedCents(r.profit?.staff.totalCny);
    if(showLiveProfit&&sort==='liveRoomProfitCny')return signedCents(r.profit?.liveRoomProfitCny);
    return signedCents(r.totals[sort as 'performanceCny'|'expenseCny']);
  };
  const x=pick(a),y=pick(b);
  if(x==null&&y==null)return a.roomCode.localeCompare(b.roomCode);
  if(x==null)return 1;if(y==null)return -1;
  return x===y?a.roomCode.localeCompare(b.roomCode):x>y?-1:1;
 });
 const events=data?.events.filter(e=>(!current.roomKey||(e.order.live_room_code||'__unassigned__')===current.roomKey)&&(current.view==='income'?['sale','charge'].includes(e.kind):current.view==='expenses'?['expense','supplier'].includes(e.kind):false))??[];
 const room=data?.rooms.find(r=>r.key===current.roomKey);
 const detailTotals=current.roomKey?room?.totals:t;
 const renderEvent=(e:LiveBusinessEvent)=><article className="live-event-row" key={`${e.kind}:${e.id}`}><span><strong>{kinds[e.kind]} · {e.label}</strong><small>{e.date} · {e.order.order_ref} · {e.order.customer_label||'客户待补'}</small><small>{e.order.live_room_code||'未归属直播间'} · {e.order.host_name||'主播待补'} · {e.order.persona_code||'人设ID待补'} · 客服 {e.order.operator_name||e.order.wechat_id||'待补'}</small>{e.category&&<small>{import.meta.env.MODE==='demo'&&e.category==='sourcing'?'接待':expenseLabels[e.category]??e.category}</small>}{['sale','charge'].includes(e.kind)&&(e.order.cancelled||e.order.status==='refunded')&&<small className="data-flag">{e.order.cancelled?'已跑单 · 回冲原开单日营业额':'历史退款标记 · 原开单已排除'}{e.kind==='charge'?' · 追加金额已排除':''}</small>}<button type="button" className="text-action" onClick={()=>onOpenOrder?.(e.order_id)}>查看订单档案 →</button></span><b>{e.amount} {e.currency}</b></article>;
 return <div className="live-business-overview" aria-busy={loading}>
  {workspace&&<header className="commerce-heading"><div><p className="eyebrow">直播间经营明细</p><div className="live-heading-title"><h1>{liveViewLabel(current)}</h1></div></div>{!DemoLiveRoomBoard&&onOpenOrders&&<div className="actions"><button className="secondary" type="button" onClick={onOpenOrders}>订单档案</button></div>}</header>}
  {workspace&&<PeriodToolbar
    today={today}
    preset={periodPreset}
    custom={period}
    onPreset={key=>onOpenBusiness({...current,preset:key,range:undefined})}
    onCustom={next=>onOpenBusiness({...current,range:next})}
    filters={<>
      {compactRoomFilter&&<select className="live-room-select" aria-label="选择直播间" value={filters.room} onChange={e=>changeFilters({...defaultLiveView().filters,room:e.target.value})}><option value="">全部直播间</option>{demoOrderRooms.map(room=><option key={room.code} value={room.code}>{room.name}</option>)}</select>}
      <details className={`pt-more-filters${activeFilters?' is-active':''}`}><summary>{compactRoomFilter?"更多筛选":"直播间筛选"}{activeFilters?' · 已选':''}</summary><div className="pt-more-filters-panel">{([['room','直播间'],['host','主播'],['persona','人设ID'],['operator','对接客服']] as const).filter(([key])=>!compactRoomFilter||key!=='room').map(([key,name])=><label key={key}>{name}<select aria-label={`经营总览${name}筛选`} value={filters[key]} disabled={loading} onChange={e=>changeFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{key==='room'&&<option value="__unassigned__">未归属直播间</option>}{[...new Set([...options(key),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{key==='room'?(data?.rooms.find(room=>room.key===value)?.roomCode||value):value}{key==='persona'?' · '+(data?.options.find(o=>o.persona===value)?.persona_name||''):''}</option>)}</select></label>)}{activeFilters&&<button type="button" className="secondary pt-filter-clear" onClick={()=>changeFilters(defaultLiveView().filters)}>清除筛选</button>}</div></details>
    </>}
    actions={<button className="secondary" type="button" disabled={loading} onClick={()=>setRetry(v=>v+1)}>刷新</button>}
    ariaLabel="经营日期与筛选"
  />}
  {workspace&&DemoLiveRoomBoard&&<nav className="live-business-tabs" aria-label="直播间经营分类">{([['rooms','经营概况'],['income','开单明细'],['afterSales','售后收款'],['expenses','售后费用'],['paid','核定业绩']] as const).map(([view,name])=><button type="button" key={view} aria-pressed={current.view===view} onClick={()=>onOpenBusiness({...current,view,roomKey:undefined,filters:current.roomKey?{...filters,room:current.roomKey}:filters})}>{name}</button>)}</nav>}
  {!workspace&&<details className="live-filter-panel"><summary>直播间筛选{activeFilters?' · 已设置':' · 全部'}</summary><div className="live-filter-grid">{([['room','直播间'],['host','主播'],['persona','人设ID'],['operator','对接客服']] as const).map(([key,name])=><label key={key}>{name}<select aria-label={`经营总览${name}筛选`} value={filters[key]} disabled={loading} onChange={e=>changeFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{key==='room'&&<option value="__unassigned__">未归属直播间</option>}{[...new Set([...options(key),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{key==='room'?(data?.rooms.find(room=>room.key===value)?.roomCode||value):value}{key==='persona'?' · '+(data?.options.find(o=>o.persona===value)?.persona_name||''):''}</option>)}</select></label>)}</div>{activeFilters&&<button type="button" className="secondary" onClick={()=>changeFilters(defaultLiveView().filters)}>清除直播间筛选</button>}</details>}
  {error&&<div className="overview-error" role="alert"><strong>直播间经营数据暂不可用</strong><p>{error}</p><button type="button" onClick={()=>setRetry(v=>v+1)}>重试经营数据</button></div>}
  {!workspace&&<><section className="live-primary" aria-label="经营核心数据">
   <button type="button" disabled={!data} onClick={()=>open('income')}><span><strong>直播间{label}营业额</strong><small>开单卡 · 料价＋代购费</small></span><span className="live-kpi-value">{yuan(t?.performanceCny)}<small>CNY</small></span><span className="live-kpi-extra">有效开单 {t?.newOrderCount??'—'} 笔 · 跑单冲抵 {yuan(t?.cancelledSalesCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open('expenses')}><span><strong>直播间{label}费用</strong><small>按费用发生日</small></span><span className="live-kpi-value">{yuan(t?.expenseCny)}<small>CNY</small></span><span className="live-kpi-extra">{label}实际付款 {yuan(t?.supplierPaidCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open('ads')}><span><strong>运营成本</strong><small>全公司 · {label}广告消耗</small></span><span className="live-kpi-value">{data?.ads.spendUsd??'—'}<small>USD</small></span><span className="live-kpi-extra">按实际投放消耗统计</span><DashboardIcon name="arrow"/></button>
  </section><section className="live-secondary-kpis" aria-label="独立业绩与售后收款"><button type="button" className="secondary" disabled={!data} onClick={()=>open('paid')}><span>已付款业绩 · 财务核定</span><strong>{yuan(data?.paidPerformance?.amountCny)} <small>CNY</small></strong><small>{data?.paidPerformance?.recordCount?`已录入 ${data.paidPerformance.recordCount} 条`:'尚未录入核定结果'}</small></button><button type="button" className="secondary" disabled={!data} onClick={()=>open('afterSales')}><span>售后收款 · 按付款日</span><strong>{data?.afterSales?.recordCount?yuan(data.afterSales.receipts.CNY):'—'} <small>CNY</small></strong><small>{data?.afterSales?.recordCount?`TWD ${data.afterSales.receipts.TWD} · USD ${data.afterSales.receipts.USD}`:'尚无明确归类的售后收款'}</small></button></section><div className="live-summary-link"><button type="button" className="text-action" onClick={()=>open('rooms')}>查看直播间经营明细 <DashboardIcon name="arrow"/></button></div></>}
  {workspace&&current.view==='rooms'&&(DemoLiveRoomBoard?<Suspense fallback={<p role="status">正在读取经营看板…</p>}><DemoLiveRoomBoard today={today} data={data} loading={loading} failed={!!error} onOpen={open} onOpenOrder={onOpenOrder} onOpenOrders={onOpenOrders}/></Suspense>:<section className="boss-panel live-room-panel" aria-label="直播间列表">
   <header className="panel-heading"><h2>直播间列表<InfoTip label="直播间业绩与费用口径" text={showLiveProfit?`${scopeNote} ${profitTips.profit}`:scopeNote}/></h2><label className="live-sort">排序<select aria-label="直播间排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="performanceCny">营业额从高到低</option>{showLiveProfit?<>
    <option value="materialCostCny">料子本钱从高到低</option>
    <option value="staffTotal">人员费用从高到低</option>
    <option value="liveRoomProfitCny">直播间毛利从高到低</option>
   </>:<option value="expenseCny">费用从高到低</option>}</select></label></header>
   <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · {activeFilters?'已选直播间范围':'全部直播间'} · CNY{!!data?.legacyCost.count?` · ${data.legacyCost.count} 笔历史成本日期待核对`:''}{t&&Number(t.excludedSourceCny)>0?` · 原开单冲抵 ${yuan(t.excludedSourceCny)}`:''}</p>
   {showLiveProfit?<div className="live-room-table-head live-room-profit-head"><span>直播间 / 主播 / 引流人设</span><span>营业额 <InfoTip label="营业额口径" text={profitTips.turnover}/></span><span>料子本钱 <InfoTip label="料子本钱口径" text={profitTips.material}/></span><span>人员费用 <InfoTip label="人员费用口径" text={profitTips.staff}/></span><span>直播间毛利 <InfoTip label="直播间毛利口径" text={profitTips.profit}/></span></div>:<div className="live-room-table-head" aria-hidden="true"><span>直播间 / 主播 / 引流人设</span><span>营业额</span><span>费用</span><span>有效开单</span></div>}
   {loading?<p role="status">正在读取直播间经营数据…</p>:!error&&!rows.length?<p className="notice">当前范围暂无已登记的直播间业绩、费用或资金流水。</p>:rows.map(r=>showLiveProfit?<article className="live-room-row live-room-profit-row" key={r.key}>
    <span className="live-room-name"><strong>{r.roomCode}</strong><small>{r.hosts.join('、')||'主播待补'} · 有效开单 {r.totals.newOrderCount} 笔</small><small>{r.personas.join(' / ')||'引流人设待补'}</small><button type="button" className="text-action live-room-open" onClick={()=>open('income',r.key)}>查看收入 / 费用 →</button></span>
    <span><small>营业额 <InfoTip label={`${r.roomCode}营业额口径`} text={profitTips.turnover}/></small><b>{r.totals.performanceCny}</b></span>
    <span><small>料子本钱 <InfoTip label={`${r.roomCode}料子本钱口径`} text={profitTips.material}/></small><b>{r.profit?.materialCostCny??'—'}</b>{materialSourceLabel(r.profit)&&<small className="live-cost-source">{materialSourceLabel(r.profit)}</small>}</span>
    <span className="live-staff-cell"><small>人员费用 <InfoTip label={`${r.roomCode}人员费用口径`} text={profitTips.staff}/></small><b className={r.profit?.staff.status==='pending_finance'?'live-pending':''}>{moneyOrPending(r.profit?.staff.totalCny,'待财务录入',r.profit?.staff.status)}</b>
     <details className="live-staff-details"><summary>展开人员构成</summary>
      <p>主播提成<b className={r.profit?.staff.hostCommission.status==='pending_finance'?'live-pending':''}>{moneyOrPending(r.profit?.staff.hostCommission.value,'待财务录入',r.profit?.staff.status)}</b></p>
      <p>助理提成<b className={r.profit?.staff.assistantCommission.status==='pending_finance'?'live-pending':''}>{moneyOrPending(r.profit?.staff.assistantCommission.value,'待财务录入',r.profit?.staff.status)}</b></p>
      <p>货主演员费用<b>{moneyOrPending(r.profit?.staff.actorSessionFee.value,'—',r.profit?.staff.status)}</b></p>
      {r.profit?.staff.actorSessionFee.records.map(s=><small key={s.id}>{s.date} · {s.session_label||'场次'} · {s.amount_cny}</small>)}
     </details>
    </span>
    <span><small>直播间毛利 <InfoTip label={`${r.roomCode}直播间毛利口径`} text={profitTips.profit}/></small><b className={r.profit?.status==='pending_finance'?'live-pending':''}>{moneyOrPending(r.profit?.liveRoomProfitCny,'待核算',r.profit?.status)}</b></span>
   </article>:<button type="button" className="live-room-row" key={r.key} onClick={()=>open('income',r.key)}><span className="live-room-name"><strong>{r.roomCode}</strong><small>{r.hosts.join('、')||'主播待补'}</small><small>{r.personas.join(' / ')||'引流人设待补'}</small><small className="live-room-open">查看收入 / 费用 ›</small></span><span><small>营业额</small><b>{r.totals.performanceCny}</b></span><span><small>费用</small><b>{r.totals.expenseCny}</b></span><span><small>有效开单</small><b>{r.totals.newOrderCount} 笔</b></span></button>)}
   <details className="live-cash-details"><summary>客户收款与公司到账</summary><div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>客户实际付款 · {cur}</small><strong>{t?.customerReceipts[cur]??'—'}</strong></div>)}<div><small>公司人民币净到账 · CNY</small><strong>{t?.companyReceivedCny??'—'}</strong></div></div></details>
  </section>)}
  {workspace&&current.view==='paid'&&<section className="boss-panel"><h2>财务核定的已付款业绩</h2><p className="live-scope">按开单日、直播间和主播录入；不按人设／客服拆分，不计算主播提成。订单修改不会自动改写财务核定结果。</p><strong className="live-detail-total">{yuan(data?.paidPerformance?.amountCny)} CNY</strong>{data&&!data.paidPerformance?.recordCount&&<p>当前范围尚未录入核定结果。</p>}{data?.paidPerformance?.records.map(r=><article key={r.id} className="live-event-row"><span><strong>{r.live_room_code} · {r.host_name}</strong><small>{r.date}</small>{r.note&&<small>{r.note}</small>}</span><b>{r.amount_cny} CNY</b></article>)}</section>}
  {workspace&&current.view==='afterSales'&&<section className="boss-panel"><h2>售后收款与业务毛利</h2><p className="live-scope">收款按实际付款日、币种分别汇总；业务毛利按同一售后收费单的人民币报价减去累计已录齐成本，不受收款、发货跨日影响，不含公司广告、工资等分摊。</p><div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>售后实收 · {cur}</small><strong>{data?.afterSales?.receipts[cur]??'—'}</strong></div>)}</div>{!!data?.afterSales?.unclassifiedReceiptCount&&<p className="data-flag">另有 {data.afterSales.unclassifiedReceiptCount} 笔收款未明确关联售后业务，未推测归类。</p>}{data&&!data.afterSales?.recordCount&&<p>当前范围暂无明确归类的售后收款。</p>}{data?.afterSales?.records.filter((r,i,all)=>all.findIndex(x=>x.charge_id===r.charge_id)===i).map(r=><article className="live-after-sale-record" key={r.charge_id}><div className="panel-heading"><h3>{r.label} · {r.customer_label}</h3><button className="text-action" type="button" onClick={()=>onOpenOrder?.(r.order_id)}>查看订单档案 →</button></div><p className="live-scope">{r.order_ref} · {r.live_room_code||'直播间待补'} · {r.host_name} · 客服 {r.operator_name}</p><div className="live-cash-grid"><div><small>售后人民币报价</small><strong>{r.quoted_cny}</strong></div><div><small>累计业务成本</small><strong>{r.cost_cny}</strong></div><div><small>业务毛利 · CNY</small><strong>{r.margin_cny??'成本待录齐'}</strong></div></div>{data.afterSales.records.filter(p=>p.charge_id===r.charge_id).map(p=><p className="live-scope" key={p.id}>{p.date} 实收 {p.amount} {p.currency}</p>)}</article>)}</section>}
  {workspace&&['income','expenses','ads'].includes(current.view)&&<section className="boss-panel live-event-panel" aria-label={current.view==='ads'?'广告消耗明细':'直播间收支明细'}>
   {current.view==='income'&&onOpenOrders&&<div className="actions"><button type="button" className="text-action" onClick={onOpenOrders}>查看全部订单 →</button></div>}
   {current.view!=='ads'&&<div className="live-detail-tabs" role="group" aria-label="收支明细切换">{([['income','收入明细'],['expenses','费用明细']] as const).map(([view,name])=><button key={view} type="button" aria-pressed={current.view===view} className={current.view===view?'selected':'secondary'} onClick={()=>open(view,current.roomKey)}>{name}</button>)}</div>}
   <div className="panel-heading"><h2>{current.view==='ads'?'广告消耗明细':current.view==='income'?'开单营业额':'费用明细'}{current.view!=='ads'&&<InfoTip label="收支统计口径" text={scopeNote}/>}</h2>{data&&<strong className="live-detail-total">{current.view==='ads'?`${data.ads.spendUsd} USD`:yuan(detailTotals?.[current.view==='income'?'performanceCny':'expenseCny'])+' CNY'}</strong>}</div>
   <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · {current.view==='ads'?'全公司 · USD':current.roomKey==='__unassigned__'?'未归属直播间':current.roomKey||'全部直播间'}</p>
   {loading&&<p role="status">正在读取明细…</p>}
   {data&&(current.view==='ads'?<>{!!data.ads.unknownCount&&<p className="data-flag">{data.ads.unknownCount} 条历史日报未记录美元消耗，未推测为0。</p>}{!data.ads.records.length&&<p>当前范围暂无已登记的广告消耗。</p>}{data.ads.records.map(a=><article className="live-event-row" key={a.id}><span><strong>{a.persona||'人设待补'}</strong><small>{a.date} · {a.account}</small></span><b>{a.amount} USD</b></article>)}</>:<>{current.view==='expenses'?<p className="live-scope">售后费用按发生日；公司付款单独列示，不重复计入费用合计。</p>:<p className="live-scope">原开单 {yuan(detailTotals?.grossSalesCny)} · 已冲抵 {yuan(detailTotals?.excludedSourceCny)} · 按原开单日重算，付款不重复计入。</p>}{!events.filter(e=>e.kind!=='charge').length&&<p>当前范围暂无{current.view==='income'?'开单卡':'费用'}明细。</p>}{events.filter(e=>e.kind!=='charge').map(renderEvent)}{current.view==='income'&&<section className="live-additional-section" aria-label="追加收费（不计营业额）"><header className="panel-heading"><h3>追加收费（不计营业额）</h3><strong>{yuan(detailTotals?.additionalCny)} CNY</strong></header>{!events.some(e=>e.kind==='charge')&&<p className="live-scope">当前范围暂无追加收费。</p>}{events.filter(e=>e.kind==='charge').map(renderEvent)}</section>}</>)}
   {data&&current.view!=='ads'&&<details className="live-cash-details"><summary>客户收款与公司到账</summary><div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>客户实际付款 · {cur}</small><strong>{detailTotals?.customerReceipts[cur]??'—'}</strong></div>)}<div><small>公司人民币净到账 · CNY</small><strong>{detailTotals?.companyReceivedCny??'—'}</strong></div></div>{data.events.filter(e=>['receipt','company'].includes(e.kind)&&(!current.roomKey||(e.order.live_room_code||'__unassigned__')===current.roomKey)).map(e=><article className="live-event-row" key={`${e.kind}:${e.id}`}><span><strong>{kinds[e.kind]} · {e.label}</strong><small>{e.date} · {e.order.order_ref}</small><button type="button" className="text-action" onClick={()=>onOpenOrder?.(e.order_id)}>查看订单档案 →</button></span><b>{e.amount} {e.currency}</b></article>)}</details>}
  </section>}
 </div>;
}
