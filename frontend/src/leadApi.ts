import {requestInner} from './api';
export const INVALID_REASON_PRESETS = {
  no_chinese: '语言不通（未能取得正常沟通）',
  misclick: '误点咨询/不感兴趣',
  obscene: '色粉'
} as const;
export type InvalidReasonCode = '' | keyof typeof INVALID_REASON_PRESETS | 'custom';
export type InvalidReviewStatus = '' | 'pending' | 'approved' | 'rejected' | 'restored';
export type Lead={id:string;accountId:string;wechatId:string;teamId:string;teamName:string;receivedOn:string;pageName:string;personaCode:string;operatorName:string;sourceAdAccountId?:string;channel:'ms'|'ws';customerLabel:string;customerRef:string;contactStatus:'unread'|'read_no_reply'|'replied';repliedOn:string|null;qualifiedOn:string|null;needSummary:string;invalidReason:string;invalidReasonCode?:InvalidReasonCode;invalidReviewStatus?:InvalidReviewStatus;invalidReviewNote?:string;attemptContact?:boolean;lossReason:string;nextFollowup:string|null;note:string;version:number;voidedAt:string|null;voidReason:string|null};
export type CustomerLead = Lead & {reviewedAt:string|null;lastOrderStatus:string|null;lastOrderCancelled:boolean};
export type PersonalFanPreset = "day" | "week" | "month";
export type PersonalFans = {from:string;to:string;added:number;replied:number;booked:number};
export type PersonalFillOverview = {orderCount:number;liveAmount:string;privateAmount:string;commission:string|null;commissionEstimate?:{amount:string|null;pendingCount:number}|null};
export type LeadReport={accountId:string;pageName:string;businessDate:string;msToday:number|null;wsToday:number|null;addedCount:number};
export type ZeroStatus={date:string;leadCount:number;zeroCheckedIn:boolean;checkedInAt:string|null};
export function isConfirmedInvalidLead(lead:Pick<Lead,'invalidReason'|'invalidReviewStatus'>):boolean{
  if(lead.invalidReviewStatus!==undefined)return lead.invalidReviewStatus==='approved';
  return Boolean(lead.invalidReason);
}
export const leadApi={
  customerBook:(search:string,page:number,invalid:boolean)=>requestInner<{rows:CustomerLead[];hasMore:boolean}>(
    `/api/fan-leads/customer-book?${new URLSearchParams({search,page:String(page),invalid:String(invalid)})}`),
  personalFans:(preset:PersonalFanPreset)=>requestInner<PersonalFans>(`/api/fan-leads/personal-fans?preset=${preset}`),
  personalOverview:()=>requestInner<PersonalFillOverview>('/api/fan-leads/personal-overview'),
  list:(from:string,to:string)=>requestInner<{from:string;to:string;today:string;leads:Lead[];reports:LeadReport[]}>(`/api/fan-leads?${new URLSearchParams({from,to})}`),
  create:(payload:Record<string,unknown>)=>requestInner<{id:string}>('/api/fan-leads',{method:'POST',body:JSON.stringify(payload)}),
  update:(id:string,payload:Record<string,unknown>)=>requestInner<{id:string}>(`/api/fan-leads/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
  history:(id:string)=>requestInner<{history:{created_at:string;actor_name:string;action:string;after_data:Record<string,unknown>}[]}>(`/api/fan-leads/${encodeURIComponent(id)}/history`),
  zeroStatus:(date:string)=>requestInner<ZeroStatus>(`/api/fan-reports/zero-status?${new URLSearchParams({date})}`),
  submitZeroReport:(businessDate:string)=>requestInner<{ok:boolean;date:string;leadCount:number;zeroCheckedIn:boolean;alreadyHasLeads:boolean}>('/api/fan-reports/zero-report',{method:'POST',body:JSON.stringify({businessDate})})
};
export function leadStats(leads:Lead[],today:string){
  const active=leads.filter(l=>!l.voidedAt),n=active.length;
  const end=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
  const sameDay=active.filter(l=>l.qualifiedOn===l.receivedOn).length,withinSeven=active.filter(l=>l.qualifiedOn&&l.qualifiedOn<=end(l.receivedOn)).length;
  return {received:n,ms:active.filter(l=>l.channel==='ms').length,ws:active.filter(l=>l.channel==='ws').length,replied:active.filter(l=>l.repliedOn&&!isConfirmedInvalidLead(l)).length,sameDay,withinSeven,invalid:active.filter(l=>isConfirmedInvalidLead(l)).length,pendingInvalid:active.filter(l=>l.invalidReviewStatus==='pending').length,lost:active.filter(l=>l.lossReason).length,observing:active.filter(l=>end(l.receivedOn)>today).length,sameDayRate:n?Math.round(sameDay/n*1000)/10:null,sevenDayRate:n?Math.round(withinSeven/n*1000)/10:null};
}
export function percent(n:number|null){return n===null?'—':`${n}%`;}
export function leadCoverage(leads:Lead[],reports:LeadReport[]){
 let mismatches=0,reported=0;
 for(const r of reports){const list=leads.filter(l=>!l.voidedAt&&l.accountId===r.accountId&&l.pageName===r.pageName&&l.receivedOn===r.businessDate);reported+=r.msToday===null||r.wsToday===null?r.addedCount:r.msToday+r.wsToday;if(r.msToday===null||r.wsToday===null||list.filter(l=>l.channel==='ms').length!==r.msToday||list.filter(l=>l.channel==='ws').length!==r.wsToday)mismatches++;}
 return {mismatches,reported};
}
/** Seven complete business days must have ended; today's last observation day is still partial. */
export function sevenDayResult(leads:Lead[],today:string,reports?:LeadReport[]) {
 const end=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')+6*86400000).toISOString().slice(0,10);
 const active=leads.filter(l=>!l.voidedAt),mature=active.filter(l=>end(l.receivedOn)<today);
 const converted=mature.filter(l=>l.qualifiedOn&&l.qualifiedOn>=l.receivedOn&&l.qualifiedOn<=end(l.receivedOn)).length;
 const missing=reports?leadCoverage(mature,reports.filter(r=>end(r.businessDate)<today)).mismatches:0;
 return {received:mature.length,converted,observing:active.length-mature.length,missing,rate:mature.length&&!missing?Math.round(converted/mature.length*1000)/10:null};
}
