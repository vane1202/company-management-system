import {useEffect,useState} from 'react';
import type {Lead,LeadReport} from '../leadApi';
import {leadApi,percent} from '../leadApi';
import {InfoTip} from '../InfoTip';
import {AnalysisPlot,ChartStyleControl,Ranking,useChartStyle} from './AnalysisChart';
import {leadAnalysis,selectAnalysisLeads,type LeadSelection} from './leadAnalysisData';
import {shift} from './bossTrendData';
import './lead-analysis.css';

export default function LeadAnalysis({leads,coverageLeads,reports,today,range,supervisor,covered,onAccount,onTeam,onAll,filters}:{leads:Lead[];coverageLeads:Lead[];reports:LeadReport[];today:string;range:{from:string;to:string};supervisor:boolean;covered:boolean;onAccount:(id:string)=>void;onTeam:(id:string)=>void;onAll:()=>void;filters?:LeadSelection}){
  const [by,setBy]=useState<'team'|'account'>(supervisor?'account':'team'),[sort,setSort]=useState<'received'|'rate'>('received'),[selected,setSelected]=useState(range.to);
  const [style,setStyle]=useChartStyle();
  const [trendMode,setTrendMode]=useState<'7'|'period'>('7');
  const [trendSource,setTrendSource]=useState<{leads:Lead[];reports:LeadReport[]}|null>(null),[trendError,setTrendError]=useState('');
  const filterKey=JSON.stringify(filters??{});
  useEffect(()=>{setSelected(range.to);if(trendMode!=='7')return;let active=true;setTrendSource(null);setTrendError('');leadApi.list(shift(range.to,-6),range.to).then(value=>{if(active)setTrendSource(value);}).catch(()=>{if(active)setTrendError('线索趋势暂不可用，请重试或选择跟随汇总');});return()=>{active=false;};},[range.to,filterKey,trendMode]);
  const data=leadAnalysis(leads,reports,range,today,by,coverageLeads),groups=[...data.groups].sort((a,b)=>sort==='received'?b.stats.received-a.stats.received:(b.stats.sameDayRate??-1)-(a.stats.sameDayRate??-1));
  const trend=trendMode==='period'?data:trendSource?leadAnalysis(selectAnalysisLeads(trendSource.leads,filters),trendSource.reports,{from:shift(range.to,-6),to:range.to},today,by,trendSource.leads):null;
  return <div className="lead-analysis"><div className="la-main-layout"><section className="analysis-panel"><div className="analysis-toolbar"><h3>{by==='team'?'小组承接对比':'接待账号对比'}</h3><label>分类<select aria-label="线索分类维度" value={by} onChange={e=>setBy(e.target.value as typeof by)}><option value="team">按小组</option><option value="account">按接待账号</option></select></label></div><label className="la-sort">排序<select aria-label="线索排名排序" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="received">承接人数从高到低</option><option value="rate">承接需求转化率从高到低</option></select></label><p className="analysis-caption">承接人数 · 当日明确／承接人数</p>
    <Ranking label="线索承接排名" rows={groups.map(g=>({key:g.key,label:g.name,value:g.stats.received,display:`${g.stats.received} 人`,note:`当日明确 ${g.stats.sameDay}/${g.stats.received} · 承接需求转化 ${covered?percent(g.stats.sameDayRate):'明细待对齐'} · 查看客户 →`}))} onOpen={by==='team'?onTeam:onAccount}/></section>
    <section className="analysis-panel"><div className="analysis-toolbar"><h3>承接与明确需求 <InfoTip label="线索趋势口径" text="按客户承接日看已登记人数及承接当天明确具体需求的人数；普通回复不等于明确需求，月进粉快照不参与每日相加。缺报断开，日报明确填零且明细对齐才显示零。近7天独立于顶部汇总日期，但沿用相同分类筛选；跟随汇总最多显示最后31天。"/></h3><ChartStyleControl style={style} onChange={setStyle}/></div><nav className="analysis-tabs" aria-label="线索趋势日期"><button type="button" aria-pressed={trendMode==='7'} onClick={()=>setTrendMode('7')}>近7天趋势</button><button type="button" aria-pressed={trendMode==='period'} onClick={()=>setTrendMode('period')}>跟随汇总</button></nav>{trend?<><p className="analysis-caption">{trendMode==='7'?'独立趋势 · ':''}{trend.from} 至 {trend.to} · 仅已登记明细</p><AnalysisPlot series={trend.series} style={style} today={today} unit="count" selected={selected} onSelect={setSelected} label="线索承接与明确需求"/></>:<p role="status">{trendError||'正在读取线索趋势…'}</p>}</section></div>
    <button type="button" className="secondary la-record-entry" onClick={onAll}>查看全部客户明细 · {leads.length} 条 →</button>
  </div>;
}
