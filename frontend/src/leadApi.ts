import {requestInner} from './api';
export type Lead={id:string;accountId:string;wechatId:string;teamId:string;teamName:string;receivedOn:string;pageName:string;personaCode:string;operatorName:string;channel:'ms'|'ws';customerLabel:string;customerRef:string;contactStatus:'unread'|'read_no_reply'|'replied';repliedOn:string|null;qualifiedOn:string|null;needSummary:string;invalidReason:string;lossReason:string;nextFollowup:string|null;note:string;version:number;voidedAt:string|null;voidReason:string|null};
export type LeadReport={accountId:string;pageName:string;businessDate:string;msToday:number|null;wsToday:number|null;addedCount:number};
export const leadApi={
  list:(from:string,to:string)=>requestInner<{from:string;to:string;today:string;leads:Lead[];reports:LeadReport[]}>(`/api/fan-leads?${new URLSearchParams({from,to})}`),
  create:(payload:Record<string,unknown>)=>requestInner<{id:string}>('/api/fan-leads',{method:'POST',body:JSON.stringify(payload)}),
  update:(id:string,payload:Record<string,unknown>)=>requestInner<{id:string}>(`/api/fan-leads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  history:(id:string)=>requestInner<{history:{created_at:string;actor_name:string;action:string;after_data:Record<string,unknown>}[]}>(`/api/fan-leads/${encodeURIComponent(id)}/history`)
};
export function leadStats(leads:Lead[],today:string){
  const active=leads.filter(l=>!l.voidedAt),n=active.length;
  const end=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
  const sameDay=active.filter(l=>l.qualifiedOn===l.receivedOn).length,withinSeven=active.filter(l=>l.qualifiedOn&&l.qualifiedOn<=end(l.receivedOn)).length;
  return {received:n,ms:active.filter(l=>l.channel==='ms').length,ws:active.filter(l=>l.channel==='ws').length,replied:active.filter(l=>l.repliedOn).length,sameDay,withinSeven,invalid:active.filter(l=>l.invalidReason).length,lost:active.filter(l=>l.lossReason).length,observing:active.filter(l=>end(l.receivedOn)>today).length,sameDayRate:n?Math.round(sameDay/n*1000)/10:null,sevenDayRate:n?Math.round(withinSeven/n*1000)/10:null};
}
export function percent(n:number|null){return n===null?'—':`${n}%`;}
export function leadCoverage(leads:Lead[],reports:LeadReport[]){
 let mismatches=0,reported=0;
 for(const r of reports){const list=leads.filter(l=>!l.voidedAt&&l.accountId===r.accountId&&l.pageName===r.pageName&&l.receivedOn===r.businessDate);reported+=r.msToday===null||r.wsToday===null?r.addedCount:r.msToday+r.wsToday;if(r.msToday===null||r.wsToday===null||list.filter(l=>l.channel==='ms').length!==r.msToday||list.filter(l=>l.channel==='ws').length!==r.wsToday)mismatches++;}
 return {mismatches,reported};
}
