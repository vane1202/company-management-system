import { useEffect, useState } from "react";
import type { LiveBusinessData } from "../api";
import { AnalysisPlot, ChartStyleControl, useChartStyle } from "./AnalysisChart";
import { buildAccountTrends } from "./opsAccountTrendData";
import { useReferenceQuotes } from "./useReferenceQuotes";
import { type TrendSeries } from "./bossTrendData";
import { InfoTip } from "../InfoTip";

type Key="total"|"operatingCost"|"ads";
type Day={date:string;total:string|null;operatingCost:null};
const labels:Record<Key,string>={total:'总业绩',operatingCost:'运营成本',ads:'投流消耗'};
export default function BossHomeTrend({today,from,to,tick,live}:{today:string;from:string;to:string;tick:number;live:LiveBusinessData|null}){
 const [metric,setMetric]=useState<Key>('total'),[style,setStyle]=useChartStyle(),[selected,setSelected]=useState(to);
 const [days,setDays]=useState<Day[]|null>(null),[ads,setAds]=useState<TrendSeries|null>(null),[error,setError]=useState('');
 const revision=useReferenceQuotes();
 useEffect(()=>{const controller=new AbortController();setDays(null);setError('');fetch('/api/demo/boss-priority?'+new URLSearchParams({from,to}),{signal:controller.signal,cache:'no-store'}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error||'趋势读取失败');if(!controller.signal.aborted)setDays(data.days);}).catch(cause=>{if(!controller.signal.aborted)setError(cause instanceof Error?cause.message:'趋势读取失败');});setSelected(to);return()=>controller.abort();},[from,to,tick]);
 useEffect(()=>{let active=true;setAds(null);if(days&&live)void buildAccountTrends(live.ads.records.map(row=>({adAccountRef:'ads',businessDate:row.date,spendUsd:row.amount,consultCount:null})),days.map(day=>day.date),['ads'],'spendCny').then(series=>{if(active)setAds(series[0]);});return()=>{active=false;};},[days,live,revision]);
 const series:TrendSeries={key:metric,label:labels[metric],points:(days||[]).map(day=>{
   const ad=ads?.points.find(point=>point.date===day.date);
   const value=metric==='total'?day.total:metric==='operatingCost'?null:metric==='ads'?live?.ads.unknownCount?null:ad?.value??null:null;
   return{date:day.date,value,reason:metric==='operatingCost'?'工资及费用待核算':metric==='ads'?ad?.reason||'未报':'未填报',count:0,native:'',estimated:metric==='ads'};
 })};
 return <section className="bh-trend" aria-label="首页经营趋势"><header><h2>经营趋势<InfoTip label="首页趋势口径" text="跟随首页日期。总业绩包含直播间和私推，与顶部主数同口径。缺报日期留空；运营成本未完整核算时不绘制估算数。广告消耗为发生日参考折算。"/></h2><ChartStyleControl style={style} onChange={setStyle}/></header><nav aria-label="首页趋势指标">{Object.entries(labels).map(([key,label])=><button type="button" key={key} aria-pressed={metric===key} onClick={()=>setMetric(key as Key)}>{label}</button>)}</nav>{error?<p className="error" role="alert">{error}</p>:!days?<p role="status">正在读取趋势…</p>:metric==='operatingCost'?<p className="empty-state">费用及工资尚未核算完整，暂不绘制运营成本趋势。</p>:<AnalysisPlot series={[series]} style={style} today={today} selected={selected} onSelect={setSelected} label={labels[metric]}/>}
 </section>;
}
