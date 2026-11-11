import { useEffect, useRef, useState } from 'react';
import { dashboardPresetRange } from '../dates';
import { InfoTip } from '../InfoTip';
import { Skeleton } from '../Skeleton';
import './ops-analysis.css';

type Totals = {spendUsd:string|null;spendCny:string|null;consultCount:number|null;clickCount:number|null;consultationCostUsd:string|null;costStatus:string;recordCount:number;reportedDays:number;missingSpendCount:number;missingConsultCount:number;missingClickCount:number};
type RecordRow={id:string;businessDate:string;personaName:string;adAccountRef:string;platform:string;spendUsd:string|null;consultCount:number|null;consultCostUsd:string|null;clickCount:number|null;ctrPercent:string|null;balanceUsd:string|null;promoVideoCount:number|null;promoCost:string|null;note:string};
type Group=Totals&{key:string;name:string};
type Dimension='persona'|'platform'|'account';
type Filters=Record<Dimension,string>;
type Data={version:string;demo:boolean;period:{from:string;to:string;partial:boolean};summary:Totals;groups:Group[];records:RecordRow[];comparison:{label:string;from:string;to:string;totals:Totals};trend:{from:string;to:string;days:(Totals&{date:string;partial:boolean})[]};balances:{totalUsd:string|null;scope:string;accounts:{account:string;amountUsd:string|null;date:string|null;status:string;shared:boolean}[]};options:Record<Dimension,string[]>;fx:{ratesUsed:{cnyPerUnit:string;effectiveFrom:string}[];missing:string[]};updatedAt:string|null;definitions:Record<string,string>};
const labels:Record<Dimension,string>={persona:'人设／主页',platform:'平台',account:'广告账户'};
const zeroFilters=():Filters=>({persona:'',platform:'',account:''});
const amount=(v:string|null|undefined)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const count=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('zh-CN');
const clockTime=(s:string|null|undefined)=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无数据';

// A cost can be absent on a submitted zero-consultation day. Preserve that
// reason in the chart instead of labelling every absent point as an unfiled day.
function OpsTrend({days,field,label,unit}:{days:Data['trend']['days'];field:'spendUsd'|'consultationCostUsd';label:string;unit:string}){
  const values=days.map(d=>d[field]==null?null:Number(d[field])),max=Math.max(1,...values.filter((v):v is number=>v!==null));
  const x=(i:number)=>3+i*414/Math.max(1,days.length-1),y=(v:number)=>67-v/max*64;
  const solid:string[]=[],dashed:string[]=[];
  for(let i=1;i<values.length;i++){const a=values[i-1],b=values[i];if(a===null||b===null)continue;(days[i].partial?dashed:solid).push(`M${x(i-1)},${y(a)}L${x(i)},${y(b)}`);}
  const description=`近7天${label}（${unit}）：`+days.map((d,i)=>`${d.date.slice(5)} ${values[i]===null?(d.recordCount===0?'未报':field==='consultationCostUsd'&&d.consultCount===0?'零咨询，未计算':'字段待补'):values[i]}${d.partial?'（今日未结束）':''}`).join('，');
  return <svg className="sparkline" viewBox="0 0 420 70" preserveAspectRatio="none" role="img" aria-label={description}><title>{description}</title><path d={solid.join('')} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke"/><path d={dashed.join('')} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"/>{values.map((v,i)=>v===null?null:<circle key={days[i].date} cx={x(i)} cy={y(v)} r="2" fill="currentColor"/>)}</svg>;
}

/* Only the independent demo build imports this component. Reuses the jade
 * design and existing mobile shell. Cards hold reported daily comparisons;
 * no invented intraday growth rate, CTR rollup or unique-customer count. */
export default function OpsAnalysis({today}:{today:string}){
  const [preset,setPreset]=useState('day'),[range,setRange]=useState<{from:string;to:string}>(),[draft,setDraft]=useState({from:today,to:today});
  const [filters,setFilters]=useState<Filters>(zeroFilters),[dimension,setDimension]=useState<Dimension>('persona'),[sort,setSort]=useState('spend'),[tick,setTick]=useState(0);
  const [data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[dateError,setDateError]=useState('');
  const [detailKey,setDetailKey]=useState<string|null>(null),[expanded,setExpanded]=useState<string[]>([]),[detailsOpen,setDetailsOpen]=useState(false);
  const detailsRef=useRef<HTMLElement>(null),groupsRef=useRef<HTMLElement>(null);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setData(null);setDetailKey(null);setExpanded([]);
    const q=new URLSearchParams({preset,...range,dimension,...filters});
    fetch('/api/demo/ops-analysis?'+q,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const d=await response.json();if(!response.ok)throw Error(d.error||'投放数据暂不可用');
      if(d.version!=='ops-analysis/v1'||d.demo!==true)throw Error('演示投放指标版本不匹配');if(!controller.signal.aborted)setData(d);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'投放数据暂不可用');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[preset,range?.from,range?.to,filters.persona,filters.platform,filters.account,dimension,tick]);
  const rows=[...(data?.groups??[])].sort((a,b)=>{
    const x=sort==='cost'?a.consultationCostUsd:sort==='consult'?a.consultCount:a.spendUsd,y=sort==='cost'?b.consultationCostUsd:sort==='consult'?b.consultCount:b.spendUsd;
    if(x==null&&y==null)return a.name.localeCompare(b.name,'zh-CN');if(x==null)return 1;if(y==null)return-1;
    return (sort==='cost'?1:-1)*(Number(x)-Number(y))||a.name.localeCompare(b.name,'zh-CN');
  });
  const selectedRange=range??dashboardPresetRange(today,preset),s=data?.summary,base=data?.comparison.totals;
  const activeFilters=Object.values(filters).some(Boolean);
  const detailRecords=data?.records.filter(r=>!detailKey||(r[dimension==='persona'?'personaName':dimension==='platform'?'platform':'adAccountRef']||'__unassigned__')===detailKey)??[];
  const filteredName=data?.groups.find(g=>g.key===detailKey)?.name;
  const displayed=(value:string|null|undefined)=>loading?<Skeleton width="3em" height=".8em"/>:amount(value);
  const rateText=data?.fx.ratesUsed.map(r=>`1 USD = ${Number(r.cnyPerUnit)} CNY（生效 ${r.effectiveFrom}）`).join('；')||'参考汇率待补';
  function showRecords(key:string|null){setDetailKey(key);setDetailsOpen(true);setExpanded([]);requestAnimationFrame(()=>detailsRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}
  const tip=(key:string,label:string)=> <InfoTip label={`${label}口径`} text={`${data?.definitions[key]??'来源：运营投放日报'} ${key==='spend'?rateText:''}`}/>;
  function benchmark(value:string|number|null|undefined,isMoney:boolean,emptyLabel='未报'){return <span className="oa-benchmark"><span>{data?.comparison.label??'历史已报'}</span><b>{value==null?emptyLabel:isMoney?amount(String(value)):count(Number(value))}</b></span>;}
  function coverage(t:Totals){return t.missingSpendCount+t.missingConsultCount+t.missingClickCount>0?'字段待补':t.costStatus==='no_consultation'?'有消耗无咨询':t.costStatus==='no_spend'?'零消耗／零咨询':'';}
  return <section className="ops-analysis" aria-label="运营投放分析" aria-busy={loading}>
    <header className="oa-heading"><div><span className="oa-eyebrow">BOSS · 运营投入与咨询</span><h1>运营投放分析</h1></div><button className="secondary" type="button" disabled={loading} onClick={()=>setTick(n=>n+1)}>刷新</button></header>
    <div className="oa-toolbar"><div className="overview-segments">{[['day','今日'],['week','本周'],['month','本月']].map(([key,label])=><button type="button" key={key} className={!range&&preset===key?'selected':''} aria-pressed={!range&&preset===key} onClick={()=>{setPreset(key);setRange(undefined);setDraft(dashboardPresetRange(today,key));setDateError('');}}>{label}</button>)}</div><details className="oa-date"><summary>自定义{range?' · 已选':''}</summary><form onSubmit={e=>{e.preventDefault();if(!draft.from||!draft.to||draft.from>draft.to||draft.to>today){setDateError('请选择有效日期，结束日不能晚于今天');return;}setDateError('');setRange({...draft});e.currentTarget.closest('details')?.removeAttribute('open');}}><label>开始日期<input required type="date" max={today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束日期<input required type="date" min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit" className="secondary">查询</button></form></details></div>
    {dateError&&<p className="error" role="alert">{dateError}</p>}
    <p className="oa-period"><span>{selectedRange.from} 至 {selectedRange.to}{data?.period.partial?' · 今日未结束':''}</span><span>更新 {data?.updatedAt?clockTime(data.updatedAt):loading?'读取中':'尚无数据'}</span></p>
    <details className="oa-filters"><summary>筛选{activeFilters?' · 已设置':' · 全部'}</summary><div className="oa-filter-fields">{(['persona','platform','account'] as const).map(key=><label key={key}>{labels[key]}<select aria-label={`投放${labels[key]}筛选`} value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{[...new Set([...(data?.options[key]??[]),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{value==='__unassigned__'?'未关联':value}</option>)}</select></label>)}<button type="button" className="secondary" onClick={()=>setFilters(zeroFilters())}>清除筛选</button></div></details>
    {activeFilters&&<div className="oa-filter-chips">{Object.entries(filters).filter(([,value])=>value).map(([key,value])=><button type="button" className="secondary" key={key} aria-label={`清除${labels[key as Dimension]}筛选`} onClick={()=>setFilters({...filters,[key]:''})}>{value==='__unassigned__'?'未关联':value} ×</button>)}</div>}
    {error?<div className="overview-error" role="alert"><strong>{error}</strong><button type="button" onClick={()=>setTick(n=>n+1)}>重试</button></div>:<>
      <div className="oa-kpis">
        <article aria-label="广告消耗"><h2>广告消耗 {tip('spend','广告消耗')}</h2><strong>{displayed(s?.spendUsd)}<small>USD</small></strong><span className="oa-secondary-value">参考折算 {amount(s?.spendCny)} CNY</span>{benchmark(base?.spendUsd,true)}</article>
        <article aria-label="咨询量"><h2>咨询量 {tip('consultations','咨询量')}</h2><strong>{loading?<Skeleton width="2em" height=".8em"/>:count(s?.consultCount)}<small>上报数</small></strong><span className="oa-secondary-value">{s?.missingConsultCount?`${s.missingConsultCount} 条缺咨询量`:'运营日报'}</span>{benchmark(base?.consultCount,false)}</article>
        <article aria-label="综合咨询成本"><h2>综合咨询成本 {tip('cost','综合咨询成本')}</h2><strong>{displayed(s?.consultationCostUsd)}<small>USD</small></strong><span className="oa-secondary-value">{s?.costStatus==='no_consultation'?'有消耗无咨询':s?.costStatus==='no_spend'?'零咨询，暂不计算':s?.costStatus==='incomplete'?'字段待补':s?.costStatus==='empty'?'尚无日报':'每次上报咨询'}</span>{benchmark(base?.consultationCostUsd,true,['no_consultation','no_spend'].includes(base?.costStatus??'')?'零咨询':'未报')}</article>
        <article aria-label="点击量"><h2>点击量 {tip('clicks','点击量')}</h2><strong>{loading?<Skeleton width="2em" height=".8em"/>:count(s?.clickCount)}<small>次</small></strong><span className="oa-secondary-value">{s?.missingClickCount?`${s.missingClickCount} 条缺点击量`:'日报点击合计'}</span>{benchmark(base?.clickCount,false)}</article>
      </div>
      <div className="oa-source-line"><span>{data?.summary.recordCount??'—'} 条日报 · {data?.summary.reportedDays??'—'} 个已报日期 {tip('comparison','历史比较')}</span><span>{data?.fx.missing.length?'参考汇率缺失':data?.fx.ratesUsed.length===1?`1 USD = ${Number(data.fx.ratesUsed[0].cnyPerUnit)} CNY`:'汇率按发生日'}</span></div>
      {!loading&&data&&!data.records.length&&<div className="oa-empty"><strong>该范围暂无日报</strong><p>调整日期或清除筛选；没有填报不计为零消耗。</p></div>}
      <section className="oa-panel oa-trend"><div className="oa-panel-heading"><h2>近7天投放走势 <InfoTip label="投放趋势口径" text={`截至所选结束日的7个业务日，筛选条件一致，未必等于上方完整统计区间。未报日断开，明确填0显示0，今天虚线。零咨询日不计算成本，不标成缺报；咨询成本每日分别按消耗÷咨询量计算。来源：运营日报。`}/></h2><span>{data?.trend.from} — {data?.trend.to}</span></div><div className="oa-trend-pair">{[['spendUsd','广告消耗','USD'],['consultationCostUsd','综合咨询成本','USD/咨询']].map(([key,label,unit])=><div className="oa-trend-chart" key={key}><div><span>{label}</span><small>{unit}</small></div>{data&&<OpsTrend days={data.trend.days} field={key as 'spendUsd'|'consultationCostUsd'} label={label} unit={unit}/>}<div className="oa-chart-ends"><span>{data?.trend.from.slice(5)}</span><span>{data?.trend.to.slice(5)}{data?.period.partial?' · 未结束':''}</span></div></div>)}</div></section>
      <section className="oa-panel" aria-label="投放分类对比" ref={groupsRef}><div className="oa-panel-heading"><h2>分类对比 <InfoTip label="投放分类对比口径" text="按选定日报的人设/主页、平台或广告账户分组；每条日报只属于当前维度的一个分类，各分类相加等于汇总。同一账户可承接多个人设。咨询成本用分类总消耗÷分类总咨询量。点击查看日报可核对原始字段。"/></h2><label className="oa-sort">排序<select aria-label="投放对比排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="spend">消耗从高到低</option><option value="consult">咨询量从高到低</option><option value="cost">咨询成本从低到高</option></select></label></div><div className="oa-dimensions" role="group" aria-label="投放分类维度">{(['persona','platform','account'] as const).map(key=><button type="button" key={key} aria-pressed={dimension===key} className={dimension===key?'selected':''} onClick={()=>{setDimension(key);setDetailKey(null);}}>{labels[key]}</button>)}</div>
        <div className="oa-table-head" aria-hidden="true"><span>{labels[dimension]}</span><span>消耗 USD</span><span>咨询量</span><span>咨询成本 USD</span><span>点击量</span><span/></div>
        <div className="oa-comparison-rows">{rows.map(g=><article className="oa-group-row" key={g.key}><div className="oa-group-name"><strong>{g.name}</strong>{coverage(g)&&<small className={g.costStatus==='no_consultation'?'oa-attention':''}>{coverage(g)}</small>}</div><div><span>消耗 USD</span><b>{amount(g.spendUsd)}</b></div><div><span>咨询量</span><b>{count(g.consultCount)}</b></div><div><span>咨询成本 USD</span><b>{amount(g.consultationCostUsd)}</b></div><div><span>点击量</span><b>{count(g.clickCount)}</b></div><button type="button" className="text-action" aria-label={`查看${g.name}的日报`} onClick={()=>showRecords(g.key)}>查看日报 →</button></article>)}</div>
        {!loading&&!rows.length&&<p className="oa-muted">该范围没有可分类的日报。</p>}
      </section>
      <section className="oa-panel" aria-label="相关广告账户余额"><div className="oa-panel-heading"><h2>相关账户余额 {tip('balance','账户余额')}</h2><span>账户快照 · USD</span></div><div className="oa-balances">{data?.balances.accounts.map(a=><article key={a.account}><div><strong>{a.account}</strong><small>{a.date??'无快照'}{a.shared?' · 共享账户':''}</small></div><b>{amount(a.amountUsd)} <small>USD</small></b>{a.status!=='ready'&&<span className="oa-attention">{a.status==='conflict'?'快照冲突，待核对':'快照待补'}</span>}</article>)}</div>{!loading&&!data?.balances.accounts.length&&<p className="oa-muted">该范围尚无相关账户快照。</p>}{activeFilters&&<p className="oa-muted">显示所涉账户的完整余额。</p>}</section>
      <section className="oa-panel oa-records" ref={detailsRef}><details open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary><h2>原始日报</h2><span>{detailRecords.length} 条{filteredName?' · '+filteredName:''}</span></summary><div className="oa-record-actions"><button type="button" className="secondary" onClick={()=>{setDetailKey(null);setExpanded([]);}}>显示当前筛选全部日报</button>{detailKey&&<button type="button" className="secondary" onClick={()=>{setDetailKey(null);setDetailsOpen(false);groupsRef.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>返回分类对比</button>}</div>
        {detailRecords.map(r=><details className="oa-record" key={r.id} open={expanded.includes(r.id)} onToggle={e=>{const open=e.currentTarget.open;setExpanded(ids=>open?(ids.includes(r.id)?ids:[...ids,r.id]):ids.filter(id=>id!==r.id));}}><summary><span><b>{r.personaName||'未关联主页'}</b><small>{r.businessDate} · {r.platform||'平台待补'} · {r.adAccountRef||'账户待补'}</small></span><strong>{amount(r.spendUsd)} USD</strong></summary><dl>{[['广告账户',r.adAccountRef],['人设／主页',r.personaName],['平台',r.platform],['广告消耗 USD',amount(r.spendUsd)],['咨询量（上报）',count(r.consultCount)],['咨询成本 USD（原上报）',amount(r.consultCostUsd)],['点击量',count(r.clickCount)],['点击率 %（原上报）',r.ctrPercent??'未上报'],['账户余额快照 USD',amount(r.balanceUsd)],['推广视频上报数',count(r.promoVideoCount)],...(r.promoCost&&r.promoCost!=='0.00'?[['历史费用（币种未记录）',r.promoCost]]:[]),['备注',r.note||'—']].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'未上报'}</dd></div>)}</dl></details>)}
        {!detailRecords.length&&<p className="oa-muted">当前筛选没有日报。</p>}
      </details></section>
    </>}
  </section>;
}
