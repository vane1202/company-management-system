import {useEffect,useRef,useState} from 'react';
import {api,type LiveBusinessData,type LiveBusinessFilters} from './api';
import {InfoTip} from './InfoTip';
import {DashboardIcon} from './DashboardIcon';
import {expenseLabels} from './commerceUi';
import {signedCents,yuan} from './dashboardDisplay';
import {toErrorMessage} from './errors';

const blankFilters:LiveBusinessFilters={room:'',host:'',persona:'',operator:''};
const kinds={sale:'新增成交',charge:'追加收费',expense:'业务费用',receipt:'客户付款',company:'公司到账',supplier:'公司付款'};
type Detail={kind:'sales'|'expenses'|'all'|'ads';roomKey:string|null};
/* Keep business-date totals and cash-date receipts separate; the existing project palette is retained. */
export function LiveBusinessOverview({preset,range,tick,onOpenOrder}:{preset:string;range?:{from:string;to:string};tick:number;onOpenOrder:(id:string)=>void}){
 const [filters,setFilters]=useState<LiveBusinessFilters>(blankFilters),[data,setData]=useState<LiveBusinessData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const [sort,setSort]=useState('performanceCny'),[detail,setDetail]=useState<Detail|null>(null);
 const detailPanel=useRef<HTMLElement>(null),returnScroll=useRef(0);
 useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');api.liveBusiness(preset,range,filters).then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[preset,range?.from,range?.to,filters,tick,retry]);
 useEffect(()=>{if(detail)requestAnimationFrame(()=>{detailPanel.current?.focus({preventScroll:true});detailPanel.current?.scrollIntoView({block:'start',behavior:'instant'});});},[detail]);
 useEffect(()=>{if(!detail)return;const banner=document.querySelector('.demo-preview-banner');if(!banner)return;const measure=()=>detailPanel.current?.style.setProperty('--live-sticky-offset',`${banner.getBoundingClientRect().height}px`);measure();const observer=new ResizeObserver(measure);observer.observe(banner);return()=>observer.disconnect();},[detail]);
 const label=range?'区间':preset==='week'?'本周':preset==='month'?'本月':'当日';
 const activeFilters=Object.values(filters).some(Boolean),t=data?.totals;
 const options=(key:keyof LiveBusinessFilters)=>[...new Set(data?.options.map(o=>o[key]).filter(Boolean)??[])].sort((a,b)=>a.localeCompare(b,'zh-CN'));
 function change(key:keyof LiveBusinessFilters,value:string){setDetail(null);setFilters({...filters,[key]:value});}
 function open(next:Detail){returnScroll.current=window.scrollY;setDetail(next);}
 function close(){setDetail(null);requestAnimationFrame(()=>window.scrollTo({top:returnScroll.current,behavior:'instant'}));}
 const rows=[...(data?.rooms??[])].sort((a,b)=>{const x=signedCents(a.totals[sort as 'performanceCny'|'expenseCny'])??0n,y=signedCents(b.totals[sort as 'performanceCny'|'expenseCny'])??0n;return x===y?a.roomCode.localeCompare(b.roomCode):x>y?-1:1;});
 const events=data?.events.filter(e=>(!detail?.roomKey||(e.order.live_room_code||'__unassigned__')===detail.roomKey)&&(detail?.kind==='sales'?['sale','charge'].includes(e.kind):detail?.kind==='expenses'?['expense','supplier'].includes(e.kind):true))??[];
 return <div className="live-business-overview" aria-busy={loading}>
  <details className="live-filter-panel"><summary>直播间筛选{activeFilters?' · 已设置':' · 全部'}</summary><div className="live-filter-grid">{([['room','直播间'],['host','主播'],['persona','人设ID'],['operator','对接客服']] as const).map(([key,name])=><label key={key}>{name}<select aria-label={`经营总览${name}筛选`} value={filters[key]} disabled={loading} onChange={e=>change(key,e.target.value)}><option value="">全部</option>{key==='room'&&<option value="__unassigned__">未归属直播间</option>}{options(key).map(value=><option key={value} value={value}>{value}{key==='persona'?' · '+(data?.options.find(o=>o.persona===value)?.persona_name||''):''}</option>)}</select></label>)}</div>{activeFilters&&<button type="button" className="secondary" onClick={()=>{setDetail(null);setFilters(blankFilters);}}>清除直播间筛选</button>}</details>
  {error&&<div className="overview-error" role="alert"><strong>直播间经营数据暂不可用</strong><p>{error}</p><button type="button" onClick={()=>setRetry(v=>v+1)}>重试经营数据</button></div>}
  <section className="live-primary" aria-label="经营核心数据">
   <button type="button" disabled={!data} onClick={()=>open({kind:'sales',roomKey:null})}><span><strong>直播间{label}业绩</strong><small>新增成交＋追加收费</small></span><span className="live-kpi-value">{yuan(t?.performanceCny)}<small>CNY</small></span><span className="live-kpi-extra">新增 {t?.newOrderCount??'—'} 单 · 追加 {yuan(t?.additionalCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open({kind:'expenses',roomKey:null})}><span><strong>直播间{label}费用</strong><small>按费用发生日</small></span><span className="live-kpi-value">{yuan(t?.expenseCny)}<small>CNY</small></span><span className="live-kpi-extra">{label}实际付款 {yuan(t?.supplierPaidCny)}</span><DashboardIcon name="arrow"/></button>
   <button type="button" disabled={!data} onClick={()=>open({kind:'ads',roomKey:null})}><span><strong>运营成本</strong><small>全公司 · {label}广告消耗</small></span><span className="live-kpi-value">{data?.ads.spendUsd??'—'}<small>USD</small></span><span className="live-kpi-extra">按实际投放消耗统计</span><DashboardIcon name="arrow"/></button>
  </section>
  <section className="boss-panel live-room-panel" aria-label="直播间经营明细">
   <header className="panel-heading"><h2>直播间经营明细<InfoTip label="直播间业绩与费用口径" text="业绩按新增成交日和追加收费发生日分别统计；原石料价与10%代购费计入原始成交，追加费不再自动加10%。当前标记退款的源单不计业绩；系统没有独立退款日与部分退款流水，不将源单金额称为当日实际退款。费用按费用发生日，实际付款按财务付款日，分别列示。广告消耗始终为全公司所选日期范围，不随直播间筛选缩小。"/></h2><label className="live-sort">排序<select aria-label="直播间排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="performanceCny">业绩从高到低</option><option value="expenseCny">费用从高到低</option></select></label></header>
   <p className="live-scope">{data?`${data.period.from} 至 ${data.period.to}`:'正在读取统计区间…'} · {activeFilters?'已选直播间范围':'全部直播间'} · CNY</p>
   {!!data?.legacyCost.count&&<p className="data-flag">{data.legacyCost.count} 笔历史成本发生日期待核对，未并入本期费用。</p>}
   {!!t&&Number(t.excludedSourceCny)>0&&<p className="live-scope">已标退款源单 {yuan(t.excludedSourceCny)} · 已从本期业绩排除</p>}
   <div className="live-room-table-head" aria-hidden="true"><span>直播间 / 主播 / 人设</span><span>业绩</span><span>费用</span><span>新增订单</span></div>
   {loading?<p role="status">正在读取直播间经营数据…</p>:!error&&!rows.length?<p className="notice">当前范围暂无已登记的直播间业绩、费用或资金流水。</p>:rows.map(room=><button type="button" className="live-room-row" key={room.key} onClick={()=>open({kind:'all',roomKey:room.key})}><span className="live-room-name"><strong>{room.roomCode}</strong><small>{room.hosts.join('、')||'主播待补'}</small><small>{room.personas.join(' / ')||'人设待补'}</small><small className="live-room-open">查看收支 →</small></span><span><small>业绩</small><b>{room.totals.performanceCny}</b></span><span><small>费用</small><b>{room.totals.expenseCny}</b></span><span><small>新增订单</small><b>{room.totals.newOrderCount} 笔</b></span></button>)}
   <details className="live-cash-details"><summary>客户收款与公司到账</summary><div className="live-cash-grid">{(['CNY','TWD','USD'] as const).map(cur=><div key={cur}><small>客户实际付款 · {cur}</small><strong>{t?.customerReceipts[cur]??'—'}</strong></div>)}<div><small>公司人民币净到账 · CNY</small><strong>{t?.companyReceivedCny??'—'}</strong></div></div></details>
  </section>
  {detail&&data&&<section ref={detailPanel} tabIndex={-1} className="boss-panel live-event-panel" aria-label="展开的经营明细"><header className="panel-heading"><h2>{detail.kind==='ads'?'广告消耗明细':detail.roomKey?`${detail.roomKey==='__unassigned__'?'未归属直播间':detail.roomKey} 收支明细`:detail.kind==='sales'?'成交与追加收费明细':'业务费用与公司付款明细'}</h2><button className="secondary" type="button" onClick={close}>返回直播间列表</button></header>
   {detail.kind==='ads'?<><p className="live-scope">全公司 · USD · {data.period.from} 至 {data.period.to}</p>{!!data.ads.unknownCount&&<p className="data-flag">{data.ads.unknownCount} 条历史日报未记录美元消耗，未推测为0。</p>}{!data.ads.records.length&&<p>当前范围暂无已登记的广告消耗。</p>}{data.ads.records.map(a=><article className="live-event-row" key={a.id}><span><strong>{a.persona||'人设待补'}</strong><small>{a.date} · {a.account}</small></span><b>{a.amount} USD</b></article>)}</>:<>{!events.length&&<p>当前范围暂无此类明细。</p>}{events.map(e=><article className="live-event-row" key={`${e.kind}:${e.id}`}><span><strong>{kinds[e.kind]} · {e.label}</strong><small>{e.date} · {e.order.order_ref} · {e.order.customer_label||'客户待补'}</small><small>{e.order.live_room_code||'未归属直播间'} · {e.order.host_name||'主播待补'} · {e.order.persona_code||'人设ID待补'} · 客服 {e.order.operator_name||e.order.wechat_id||'待补'}</small>{e.category&&<small>{expenseLabels[e.category]??e.category}</small>}{['sale','charge'].includes(e.kind)&&e.order.status==='refunded'&&<small>已标退款源单 · 不计入业绩</small>}<button type="button" className="text-action" onClick={()=>onOpenOrder(e.order_id)}>查看订单档案 →</button></span><b>{e.amount} {e.currency}</b></article>)}</>}
  </section>}
 </div>;
}
