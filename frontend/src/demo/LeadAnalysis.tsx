import {useState} from 'react';
import type {Lead,LeadReport} from '../leadApi';
import {percent} from '../leadApi';
import {InfoTip} from '../InfoTip';
import {AnalysisPlot,ChartStyleControl,Ranking,useChartStyle} from './AnalysisChart';
import {leadAnalysis} from './leadAnalysisData';
import './lead-analysis.css';

export default function LeadAnalysis({leads,coverageLeads,reports,today,range,supervisor,covered,onAccount,onTeam,onAll}:{leads:Lead[];coverageLeads:Lead[];reports:LeadReport[];today:string;range:{from:string;to:string};supervisor:boolean;covered:boolean;onAccount:(id:string)=>void;onTeam:(id:string)=>void;onAll:()=>void}){
  const [by,setBy]=useState<'team'|'account'>(supervisor?'account':'team'),[sort,setSort]=useState<'received'|'rate'>('received'),[selected,setSelected]=useState(range.to);
  const [style,setStyle]=useChartStyle();
  const data=leadAnalysis(leads,reports,range,today,by,coverageLeads),groups=[...data.groups].sort((a,b)=>sort==='received'?b.stats.received-a.stats.received:(b.stats.sameDayRate??-1)-(a.stats.sameDayRate??-1));
  return <div className="lead-analysis"><div className="la-main-layout"><section className="analysis-panel"><div className="analysis-toolbar"><h3>{by==='team'?'小组承接对比':'接待账号对比'}</h3><label>分类<select aria-label="线索分类维度" value={by} onChange={e=>setBy(e.target.value as typeof by)}><option value="team">按小组</option><option value="account">按接待账号</option></select></label></div><label className="la-sort">排序<select aria-label="线索排名排序" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="received">承接人数从高到低</option><option value="rate">当日转化率从高到低</option></select></label><p className="analysis-caption">承接人数 · 当日明确／承接人数</p>
    <Ranking label="线索承接排名" rows={groups.map(g=>({key:g.key,label:g.name,value:g.stats.received,display:`${g.stats.received} 人`,note:`当日明确 ${g.stats.sameDay}/${g.stats.received} · 转化 ${covered?percent(g.stats.sameDayRate):'明细待对齐'} · 查看客户 →`}))} onOpen={by==='team'?onTeam:onAccount}/></section>
    <section className="analysis-panel"><div className="analysis-toolbar"><h3>承接与明确需求 <InfoTip label="线索趋势口径" text="按客户承接日看已登记人数及承接当天明确具体需求的人数；普通回复不等于明确需求，月进粉快照不参与每日相加。缺报断开，日报明确填零且明细对齐才显示零。图表最多显示所选范围最后31天。"/></h3><ChartStyleControl style={style} onChange={setStyle}/></div><p className="analysis-caption">{data.from} 至 {data.to} · 仅已登记明细</p><AnalysisPlot series={data.series} style={style} today={today} unit="count" selected={selected} onSelect={setSelected} label="线索承接与明确需求"/></section></div>
    <button type="button" className="secondary la-record-entry" onClick={onAll}>查看全部客户明细 · {leads.length} 条 →</button>
  </div>;
}
