import {opsBossPeriod} from "./opsBossPeriod";
import OpsBalanceStrip from "./OpsBalanceStrip";
import OpsScopeBar from "./OpsScopeBar";
import {opsScopeStorageKey,readScopePreference,type OpsScope} from "./opsScope";
import OpsIdentity from "./OpsIdentity";
import OpsAccountTrends from "./OpsAccountTrends";
import { useEffect, useRef, useState } from 'react';
import { dashboardPresetRange } from '../dates';
import { InfoTip } from '../InfoTip';
import { Skeleton } from '../Skeleton';
import './ops-analysis.css';
import { buildOpsReference } from './opsReferenceView';
import { useReferenceQuotes } from './useReferenceQuotes';
import { AnalysisPlot, ChartStyleControl, useChartStyle } from './AnalysisChart';
import type { TrendSeries } from './bossTrendData';
import InvalidLeadFacts from './InvalidLeadFacts';
import type { OpsView } from '../opsNavigation';

type Totals = {spendUsd:string|null;spendCny:string|null;consultationCostCny?:string|null;consultCount:number|null;clickCount:number|null;consultationCostUsd:string|null;costStatus:string;recordCount:number;reportedDays:number;missingSpendCount:number;missingConsultCount:number;missingClickCount:number};
type RecordRow={operatorName?:string;id:string;businessDate:string;personaName:string;adAccountRef:string;platform:string;spendUsd:string|null;consultCount:number|null;consultCostUsd:string|null;clickCount:number|null;ctrPercent:string|null;balanceUsd:string|null;promoVideoCount:number|null;promoCost:string|null;note:string};
type Group=Totals&{key:string;name:string};
type Dimension='persona'|'platform'|'account'|'operator';
type Filters=Record<Dimension,string>;
type Data={version:string;demo:boolean;period:{from:string;to:string;partial:boolean};summary:Totals;groups:Group[];records:RecordRow[];comparison:{label:string;from:string;to:string;totals:Totals;records?:RecordRow[]};trend:{from:string;to:string;days:(Totals&{date:string;partial:boolean})[];records?:RecordRow[]};balances:{totalUsd:string|null;scope:string;accounts:{account:string;amountUsd:string|null;date:string|null;status:string;shared:boolean}[]};options:Record<Dimension,string[]>;scopeAccounts?:string[];fx:{ratesUsed:{cnyPerUnit:string;effectiveFrom:string}[];missing:string[]};updatedAt:string|null;definitions:Record<string,string>};
const labels:Record<Dimension,string>={operator:'运营人员',persona:'人设／主页',platform:'平台',account:'广告账户'};
const zeroFilters=():Filters=>({persona:'',platform:'',account:'',operator:''});
const amount=(v:string|null|undefined)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const count=(v:number|null|undefined)=>v==null?'—':v.toLocaleString('zh-CN');
const clockTime=(s:string|null|undefined)=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚无数据';

/* Only the independent demo build imports this component. Reuses the jade
 * design and existing mobile shell. Cards hold reported daily comparisons;
 * no invented intraday growth rate, CTR rollup or unique-customer count. */
export default function OpsAnalysis({today,onOpenReports,onOpenFeedback,context}:{today:string;onOpenReports?:()=>void;onOpenFeedback?:(account?:string)=>void;context?:OpsView}){
  const [scopeKey]=useState(()=>onOpenReports?opsScopeStorageKey():"");
  const [initial]=useState(()=>scopeKey?readScopePreference(scopeKey,today):{filters:zeroFilters(),preset:"day",range:undefined});
  const [preset,setPreset]=useState(initial.preset),[range,setRange]=useState<{from:string;to:string}|undefined>(initial.range),[draft,setDraft]=useState(initial.range||{from:today,to:today});
  const [filters,setFilters]=useState<Filters>({...initial.filters,operator:''}),[dimension,setDimension]=useState<Dimension>(onOpenReports?'persona':'operator'),[sort,setSort]=useState('spend'),[tick,setTick]=useState(0);
  const [rawData,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[dateError,setDateError]=useState('');
  useEffect(()=>{if(!scopeKey)return;try{sessionStorage.setItem(scopeKey,JSON.stringify({filters,preset,range}));}catch{/* The dashboard remains usable without storage. */}},[scopeKey,filters,preset,range?.from,range?.to]);
  function changeScope(next:OpsScope){setFilters({...next,operator:''});setData(null);setLoading(true);setDetailsOpen(false);}
  const revision=useReferenceQuotes();
  const [style,setStyle]=useChartStyle(),[trendMetric,setTrendMetric]=useState<'spendCny'|'consultCount'|'consultationCostCny'>('spendCny'),[selectedDay,setSelectedDay]=useState(today);
  const [priced,setPriced]=useState<{key:string;view:Awaited<ReturnType<typeof buildOpsReference>>}|null>(null);
  const pricingKey=JSON.stringify([rawData,dimension,revision]);
  useEffect(()=>{let active=true;setPriced(null);if(rawData)void buildOpsReference(rawData,dimension).then(view=>{if(active)setPriced({key:pricingKey,view});}).catch(()=>{if(active)setError('参考金额暂不可用，请刷新重试');});return()=>{active=false;};},[pricingKey]);
  const pricing=priced?.key===pricingKey?priced.view:null;
  const pricingPending=!!rawData&&!pricing;
  const blank=(t:Totals):Totals=>({...t,spendCny:null,consultationCostCny:null});
  const data:Data|null=rawData?{...rawData,summary:pricing?.summary??blank(rawData.summary),groups:pricing?.groups??rawData.groups.map(g=>({...g,...blank(g)})),comparison:{...rawData.comparison,totals:pricing?.comparison??blank(rawData.comparison.totals)},trend:{...rawData.trend,days:rawData.trend.days.map(d=>({...d,...pricing?.days.find(p=>p.date===d.date)??blank(d)}))}}:null;
  const [detailKey,setDetailKey]=useState<string|null>(null),[expanded,setExpanded]=useState<string[]>([]),[detailsOpen,setDetailsOpen]=useState(false);
  const detailsRef=useRef<HTMLElement>(null),groupsRef=useRef<HTMLElement>(null);
  useEffect(()=>{if(!context||context.to>today)return;setRange({...context});setDraft({...context});setPreset('custom');setFilters(zeroFilters());setDateError('');setDetailsOpen(false);setSelectedDay(context.to);},[context,today]);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setData(null);setDetailKey(null);setExpanded([]);
    const q=new URLSearchParams({preset:['day','week','month'].includes(preset)?preset:'day',...range,dimension,...filters,...(!onOpenReports?{trendScope:'period'}:{})});
    fetch('/api/demo/ops-analysis?'+q,{signal:controller.signal,cache:'no-store'}).then(async response=>{
      const d=await response.json();if(!response.ok)throw Error(d.error||'投放数据暂不可用');
      if(d.version!=='ops-analysis/v1'||d.demo!==true)throw Error('演示投放指标版本不匹配');if(!controller.signal.aborted)setData(d);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'投放数据暂不可用');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[preset,range?.from,range?.to,filters.persona,filters.platform,filters.account,filters.operator,dimension,tick]);
  const rows=[...(data?.groups??[])].sort((a,b)=>{
    const x=sort==='cost'?a.consultationCostCny:sort==='consult'?a.consultCount:a.spendCny,y=sort==='cost'?b.consultationCostCny:sort==='consult'?b.consultCount:b.spendCny;
    if(x==null&&y==null)return a.name.localeCompare(b.name,'zh-CN');if(x==null)return 1;if(y==null)return-1;
    return (sort==='cost'?1:-1)*(Number(x)-Number(y))||a.name.localeCompare(b.name,'zh-CN');
  });
  const selectedRange=range??(onOpenReports?dashboardPresetRange(today,preset):opsBossPeriod(today,preset)),s=data?.summary,base=data?.comparison.totals;
  const activeFilters=Object.values(filters).some(Boolean);
  const detailRecords=data?.records.filter(r=>!detailKey||(r[dimension==='persona'?'personaName':dimension==='platform'?'platform':dimension==='operator'?'operatorName':'adAccountRef']||'__unassigned__')===detailKey)??[];
  const filteredName=data?.groups.find(g=>g.key===detailKey)?.name;
  const displayed=(value:string|null|undefined)=>loading?<Skeleton width="3em" height=".8em"/>:amount(value);
  const rateText=pricing?.quotes.map(r=>`${r.date}：1 USD = ${Number(r.rate)} CNY；行情时间 ${clockTime(r.updatedAt)}${r.sourceDate!==r.date?`；沿用 ${r.sourceDate} 已发布汇率`:''}`).join('；')||'参考汇率待补';
  function showRecords(key:string|null){setDetailKey(key);setDetailsOpen(true);setExpanded([]);requestAnimationFrame(()=>detailsRef.current?.scrollIntoView({behavior:'smooth',block:'start'}));}
  const tip=(key:string,label:string)=> <InfoTip label={`${label}口径`} text={`${key==='spend'?'广告实际消耗按发生日参考汇率折算人民币，非充值或实际结汇。':key==='cost'?'综合咨询成本＝人民币参考消耗总额÷总咨询量，不平均日报成本；零咨询或字段不全不计算。':data?.definitions[key]??'来源：运营投放日报'} ${key==='spend'||key==='cost'?rateText:''}`}/>;
  const cny=(value:string|null|undefined)=>loading?'…':pricingPending?<span className="fx-pending">折算中…</span>:data?.summary.recordCount===0?'—':value==null?'待核对':<><span className="oa-approx">约</span><span>¥{amount(value)}</span></>;
  function baselineWord(label?:string){const text=label||'上期';if(text.includes('昨日'))return '昨日';if(text.includes('上周'))return '上周';if(text.includes('上月'))return '上月';return '上期';}
  function benchmark(value:string|number|null|undefined,isMoney:boolean,emptyLabel='未报'){const shown=value==null?emptyLabel:isMoney?`¥${amount(String(value))}`:count(Number(value));return <span className="oa-benchmark"><span>{baselineWord(data?.comparison.label)}</span><b>{shown}</b></span>;}
  function costNote(t?:Totals){if(!t||t.costStatus==='ready')return null;const text=t.costStatus==='no_consultation'?'有消耗无咨询':t.costStatus==='no_spend'?'零咨询':t.costStatus==='incomplete'?'字段待补':t.costStatus==='empty'?'尚无日报':'';return text?<span className="oa-secondary-value">{text}</span>:null;}
  function coverage(t:Totals){return t.missingSpendCount+t.missingConsultCount+t.missingClickCount>0?'字段待补':t.costStatus==='no_consultation'?'有消耗无咨询':t.costStatus==='no_spend'?'零消耗／零咨询':'';}
  return <section className="ops-analysis" aria-label="运营投放分析" aria-busy={loading}>
    {onOpenReports && <OpsIdentity />}
    <header className="oa-heading"><div><span className="oa-eyebrow">{onOpenReports?"运营 · 本人投放日报":"BOSS · 运营投入与咨询"}</span><h1>{onOpenReports?"运营工作台":"投流数据"}</h1></div><div className="oa-heading-actions"><button className="secondary" type="button" disabled={loading} onClick={()=>setTick(n=>n+1)}>刷新</button></div></header>
    <div className="oa-toolbar"><div className="overview-segments">{(onOpenReports?[['day','今日'],['week','本周'],['month','本月']]:[['day','日'],['month','月'],['quarter','季'],['year','年']]).map(([key,label])=><button type="button" key={key} className={(onOpenReports?!range:preset!=='custom')&&preset===key?'selected':''} aria-pressed={(onOpenReports?!range:preset!=='custom')&&preset===key} onClick={()=>{setPreset(key);setRange(onOpenReports?undefined:opsBossPeriod(today,key));setDraft(onOpenReports?dashboardPresetRange(today,key):opsBossPeriod(today,key));setDateError('');}}>{label}</button>)}</div><details className="oa-date"><summary>自定义{preset==='custom'?' · 已选':''}</summary><form onSubmit={e=>{e.preventDefault();if(!draft.from||!draft.to||draft.from>draft.to||draft.to>today){setDateError('请选择有效日期，结束日不能晚于今天');return;}setDateError('');setRange({...draft});setPreset('custom');e.currentTarget.closest('details')?.removeAttribute('open');}}><label>开始日期<input required type="date" max={today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束日期<input required type="date" min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit" className="secondary">查询</button></form></details></div>
    {dateError&&<p className="error" role="alert">{dateError}</p>}
    <p className="oa-period"><span>{selectedRange.from} 至 {selectedRange.to}{data?.period.partial?' · 今日未结束':''}</span><span>更新 {data?.updatedAt?clockTime(data.updatedAt):loading?'读取中':'尚无数据'}</span></p>
    {!onOpenReports&&<div className="boss-ops-operator"><label>运营人员<select aria-label="投放运营人员筛选" value={filters.operator} onChange={e=>{setFilters({...filters,operator:e.target.value,account:'',persona:'',platform:''});setData(null);setLoading(true);}}><option value="">全部运营人员</option>{[...new Set([...(data?.options.operator||[]),...(filters.operator?[filters.operator]:[])])].map(name=><option key={name}>{name}</option>)}</select></label><small>人员姓名为已登记资料，当前日报归属为演练示例。</small></div>}
    {onOpenReports ? <OpsScopeBar value={filters} onChange={changeScope} refresh={tick}/> : <details className="oa-filters"><summary>筛选{activeFilters?' · 已设置':' · 全部'}</summary><div className="oa-filter-fields">{(['persona','platform','account'] as const).map(key=><label key={key}>{labels[key]}<select aria-label={`投放${labels[key]}筛选`} value={filters[key]} onChange={e=>setFilters({...filters,[key]:e.target.value})}><option value="">全部</option>{[...new Set([...(data?.options[key]??[]),...(filters[key]?[filters[key]]:[])])].map(value=><option key={value} value={value}>{value==='__unassigned__'?'未关联':value}</option>)}</select></label>)}<button type="button" className="secondary" onClick={()=>setFilters(zeroFilters())}>清除筛选</button></div></details>}
    {!onOpenReports&&activeFilters&&<div className="oa-filter-chips">{Object.entries(filters).filter(([,value])=>value).map(([key,value])=><button type="button" className="secondary" key={key} aria-label={`清除${labels[key as Dimension]}筛选`} onClick={()=>setFilters({...filters,[key]:''})}>{value==='__unassigned__'?'未关联':value} ×</button>)}</div>}
    {onOpenReports && <OpsBalanceStrip key={filters.account+":"+filters.persona+":"+selectedRange.to} account={filters.account} rows={data?.balances.accounts||[]} loading={loading} error={error} endDate={selectedRange.to}/>}
    {error?<div className="overview-error" role="alert"><strong>{error}</strong><button type="button" onClick={()=>setTick(n=>n+1)}>重试</button></div>:<>
      <div className="oa-kpis">
        <article aria-label="广告消耗"><h2>广告消耗 {tip('spend','广告消耗')}</h2><strong>{cny(s?.spendCny)}</strong><span className="oa-secondary-value">{amount(s?.spendUsd)} USD</span>{benchmark(base?.spendCny,true)}</article>
        <article aria-label="咨询量"><h2>咨询量 {tip('consultations','咨询量')}</h2><strong>{loading?<Skeleton width="2em" height=".8em"/>:count(s?.consultCount)}</strong>{s?.missingConsultCount?<span className="oa-secondary-value">{`${s.missingConsultCount} 条缺咨询量`}</span>:null}{benchmark(base?.consultCount,false)}</article>
        <article aria-label="综合咨询成本"><h2>综合咨询成本 {tip('cost','综合咨询成本')}</h2><strong>{s?.costStatus==='ready'?cny(s?.consultationCostCny):displayed(null)}</strong>{costNote(s)}{benchmark(base?.consultationCostCny,true,['no_consultation','no_spend'].includes(base?.costStatus??'')?'零咨询':'未报')}</article>
        <article aria-label="点击量"><h2>点击量 {tip('clicks','点击量')}</h2><strong>{loading?<Skeleton width="2em" height=".8em"/>:count(s?.clickCount)}</strong>{s?.missingClickCount?<span className="oa-secondary-value">{`${s.missingClickCount} 条缺点击量`}</span>:null}{benchmark(base?.clickCount,false)}</article>
      </div>
      <div className="oa-source-line"><span>{data?.summary.recordCount??'—'} 条日报 · {data?.summary.reportedDays??'—'} 个已报日期 {tip('comparison','历史比较')}</span><span>{pricingPending?'正在读取共享参考汇率':pricing?.missing.length?'部分参考汇率缺失':pricing?.stale?'共享参考行情 · 更新延迟':'按发生日参考折算'}</span></div>
      {!loading&&data&&!data.records.length&&<div className="oa-empty"><strong>该范围暂无日报</strong><p>调整日期或清除筛选；没有填报不计为零消耗。</p></div>}
      {onOpenReports && data ? <OpsAccountTrends key={filters.account+":"+filters.persona} rows={data.trend.records || []} dates={data.trend.days.map(day=>day.date)} accounts={(data.scopeAccounts||data.options.account).filter(account=>account!=="__unassigned__")} today={today} onFeedback={onOpenFeedback}/> : <section className="oa-panel oa-trend"><div className="analysis-toolbar"><h2>{onOpenReports?"近7天投放走势":"所选周期投放走势"} <InfoTip label="投放趋势口径" text="跟随所选周期查看，筛选条件一致。人民币消耗、咨询量、咨询成本分别查看；未报日断开，明确填0显示0，今天未结束。零咨询日不计算成本。"/></h2><ChartStyleControl style={style} onChange={setStyle}/></div>
      <nav className="analysis-tabs oa-trend-tabs" aria-label="投放趋势指标">{([['spendCny','广告消耗'],['consultCount','咨询量'],['consultationCostCny','咨询成本']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={trendMetric===key} onClick={()=>setTrendMetric(key)}>{label}</button>)}</nav>
      <p className="analysis-caption">{data?.trend.from} 至 {data?.trend.to} · {trendMetric==='consultCount'?'咨询次数':trendMetric==='spendCny'?'人民币参考消耗':'人民币／咨询'}</p>
      {data&&<AnalysisPlot series={[{key:trendMetric,label:trendMetric==='spendCny'?'广告消耗':trendMetric==='consultCount'?'咨询量':'综合咨询成本',points:data.trend.days.map(d=>({date:d.date,value:d[trendMetric]==null?null:String(d[trendMetric]),reason:d.recordCount===0?'未报':trendMetric==='consultationCostCny'&&d.consultCount===0?'零咨询，未计算':'汇率或字段待补',count:d.recordCount,native:'',estimated:trendMetric!=='consultCount'}))} satisfies TrendSeries]} style={style} today={today} unit={trendMetric==='consultCount'?'count':'money'} selected={selectedDay} onSelect={setSelectedDay} label="运营投放"/>}</section>}

      <section className="oa-panel" aria-label="投放分类对比" ref={groupsRef}><div className="oa-panel-heading"><h2>分类对比 <InfoTip label="投放分类对比口径" text="按选定日报的人设/主页、平台或广告账户分组；每条日报只属于当前维度的一个分类，各分类相加等于汇总。同一账户可承接多个人设。咨询成本用分类总消耗÷分类总咨询量。点击查看日报可核对原始字段。"/></h2><label className="oa-sort">排序<select aria-label="投放对比排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="spend">消耗从高到低</option><option value="consult">咨询量从高到低</option><option value="cost">咨询成本从低到高</option></select></label></div><div className="oa-dimensions" role="group" aria-label="投放分类维度">{(onOpenReports?(['persona','platform','account'] as const):(['operator','persona','platform','account'] as const)).map(key=><button type="button" key={key} aria-pressed={dimension===key} className={dimension===key?'selected':''} onClick={()=>{setDimension(key);setDetailKey(null);}}>{labels[key]}</button>)}</div>
        <div className="oa-table-head" aria-hidden="true"><span>{labels[dimension]}</span><span>消耗 · 人民币</span><span>咨询量</span><span>咨询成本 · 人民币</span><span>点击量</span><span/></div>
        <div className="oa-comparison-rows">{rows.map(g=><article className="oa-group-row" key={g.key}><div className="oa-group-name"><strong>{g.name}</strong>{coverage(g)&&<small className={g.costStatus==='no_consultation'?'oa-attention':''}>{coverage(g)}</small>}</div><div><span>消耗 · 人民币</span><b>{amount(g.spendCny)}</b></div><div><span>咨询量</span><b>{count(g.consultCount)}</b></div><div><span>咨询成本 · 人民币</span><b>{amount(g.consultationCostCny)}</b></div><div><span>点击量</span><b>{count(g.clickCount)}</b></div><button type="button" className="text-action" aria-label={`查看${g.name}的日报`} onClick={()=>showRecords(g.key)}>查看日报 →</button></article>)}</div>
        {!loading&&!rows.length&&<p className="oa-muted">该范围没有可分类的日报。</p>}
      </section>
      {!onOpenReports && <section className="oa-panel" aria-label="相关广告账户余额"><div className="oa-panel-heading"><h2>相关账户余额 {tip('balance','账户余额')}</h2><span>账户快照 · USD</span></div><div className="oa-balances">{data?.balances.accounts.map(a=><article key={a.account}><div><strong>{a.account}</strong><small>{a.date??'无快照'}{a.shared?' · 共享账户':''}</small></div><b>{amount(a.amountUsd)} <small>USD</small></b>{a.status!=='ready'&&<span className="oa-attention">{a.status==='conflict'?'快照冲突，待核对':'快照待补'}</span>}</article>)}</div>{!loading&&!data?.balances.accounts.length&&<p className="oa-muted">该范围尚无相关账户快照。</p>}{activeFilters&&<p className="oa-muted">显示所涉账户的完整余额。</p>}</section>}
      <details className="oa-reference"><summary>参考汇率与更新时间</summary><p>{rateText}</p><a href="https://exchangerate.dev" target="_blank" rel="noreferrer">Rates by Exchangerate.dev</a></details><section className="oa-panel oa-records" ref={detailsRef}><details open={detailsOpen} onToggle={e=>setDetailsOpen(e.currentTarget.open)}><summary><h2>原始日报</h2><span>{detailRecords.length} 条{filteredName?' · '+filteredName:''}</span></summary><div className="oa-record-actions"><button type="button" className="secondary" onClick={()=>{setDetailKey(null);setExpanded([]);}}>显示当前筛选全部日报</button>{detailKey&&<button type="button" className="secondary" onClick={()=>{setDetailKey(null);setDetailsOpen(false);groupsRef.current?.scrollIntoView({behavior:'smooth',block:'start'});}}>返回分类对比</button>}</div>
        {detailRecords.map(r=><details className="oa-record" key={r.id} open={expanded.includes(r.id)} onToggle={e=>{const open=e.currentTarget.open;setExpanded(ids=>open?(ids.includes(r.id)?ids:[...ids,r.id]):ids.filter(id=>id!==r.id));}}><summary><span><b>{r.personaName||'未关联主页'}</b><small>{r.businessDate} · {r.platform||'平台待补'} · {r.adAccountRef||'账户待补'}</small></span><strong>{amount(r.spendUsd)} USD</strong></summary><dl>{[...(!onOpenReports?[['运营人员',r.operatorName||'待关联']]:[]),['广告账户',r.adAccountRef],['人设／主页',r.personaName],['平台',r.platform],['广告消耗 USD',amount(r.spendUsd)],['咨询量（上报）',count(r.consultCount)],['咨询成本 USD（原上报）',amount(r.consultCostUsd)],['点击量',count(r.clickCount)],['点击率 %（原上报）',r.ctrPercent??'未上报'],['账户余额快照 USD',amount(r.balanceUsd)],['推广视频上报数',count(r.promoVideoCount)],...(r.promoCost&&r.promoCost!=='0.00'?[['历史费用（币种未记录）',r.promoCost]]:[]),['备注',r.note||'—']].map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value||'未上报'}</dd></div>)}</dl></details>)}
        {!detailRecords.length&&<p className="oa-muted">当前筛选没有日报。</p>}
      </details></section>
      {onOpenReports && <InvalidLeadFacts today={today} />}
    </>}
  </section>;
}
