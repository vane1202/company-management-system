import {leadCoverage,leadStats,type Lead,type LeadReport} from '../leadApi';
import {daysIn,shift,type TrendSeries,type TrendPoint} from './bossTrendData';

export type LeadSelection = {account:string;team:string;page:string;persona:string;operator:string;channel:string;adAccount:string};
export function selectAnalysisLeads(leads:Lead[],filters?:LeadSelection){
  return !filters?leads:leads.filter(lead=>(!filters.account||lead.accountId===filters.account)&&(!filters.team||lead.teamName===filters.team)&&(!filters.page||lead.pageName===filters.page)&&(!filters.persona||lead.personaCode===filters.persona)&&(!filters.operator||lead.operatorName===filters.operator)&&(!filters.channel||lead.channel===filters.channel)&&(!filters.adAccount||(filters.adAccount==='__missing__'?!String(lead.sourceAdAccountId||'').trim():String(lead.sourceAdAccountId||'').trim()===filters.adAccount)));
}

/** Trends are registered customer cohorts, never the monthly incoming snapshot. */
export function leadAnalysis(leads:Lead[],reports:LeadReport[],range:{from:string;to:string},today:string,by:'team'|'account',coverageLeads=leads){
  const active=leads.filter(l=>!l.voidedAt);
  const from=range.from>shift(range.to,-30)?range.from:shift(range.to,-30);
  const daily=daysIn(from,range.to).map(date=>{
    const list=active.filter(l=>l.receivedOn===date),dailyReports=reports.filter(r=>r.businessDate===date),stats=leadStats(list,today);
    const mismatch=leadCoverage(coverageLeads.filter(l=>l.receivedOn===date),dailyReports).mismatches>0;
    const observed=list.length>0||dailyReports.some(r=>r.msToday!==null&&r.wsToday!==null);
    return {date,stats,known:observed&&!mismatch,reason:mismatch?'日报明细待对齐':'无已登记明细'};
  });
  const points=(key:'received'|'sameDay'):TrendPoint[]=>daily.map(d=>({date:d.date,value:d.known?String(d.stats[key]):null,reason:d.known?'':d.reason,count:d.stats.received,native:'',estimated:false}));
  const series:TrendSeries[]=[{key:'received',label:'已登记承接',points:points('received')},{key:'qualified',label:'承接当日明确需求',points:points('sameDay')}];
  const groups=[...new Set(active.map(l=>by==='team'?l.teamId:l.accountId))].map(key=>{const rows=active.filter(l=>(by==='team'?l.teamId:l.accountId)===key);return {key,name:by==='team'?rows[0].teamName:rows[0].wechatId,stats:leadStats(rows,today)};});
  return {series,groups,from,to:range.to};
}
