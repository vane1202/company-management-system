import { addDays, isIsoDate } from './dates.js';
import { HttpError } from '../types.js';

export const INVALID_REASON_PRESETS = {
  no_chinese: '语言不通（未能取得正常沟通）',
  misclick: '误点咨询/不感兴趣',
  obscene: '色粉'
} as const;
export type InvalidReasonCode = '' | keyof typeof INVALID_REASON_PRESETS | 'custom';
export type InvalidReviewStatus = '' | 'pending' | 'approved' | 'rejected' | 'restored';

export type Lead = {
  id:string; accountId:string; wechatId:string; teamId:string; teamName:string;
  receivedOn:string; pageName:string; personaCode:string; operatorName:string; channel:'ms'|'ws';
  customerLabel:string; customerRef:string; contactStatus:'unread'|'read_no_reply'|'replied';
  repliedOn:string|null; qualifiedOn:string|null; needSummary:string; invalidReason:string; lossReason:string;
  nextFollowup:string|null; note:string; version:number; voidedAt:string|null; voidReason:string|null;
  invalidReasonCode?: InvalidReasonCode;
  invalidReviewStatus?: InvalidReviewStatus;
  invalidReviewNote?: string;
  attemptContact?: boolean;
};

export function isConfirmedInvalidLead(lead: Pick<Lead, 'invalidReason' | 'invalidReviewStatus'>): boolean {
  if (lead.invalidReviewStatus !== undefined) return lead.invalidReviewStatus === 'approved';
  return Boolean(lead.invalidReason);
}

export function leadPayload(body:Record<string,unknown>,today:string,receivedOn?:string){
  const labels:Record<string,string>={receivedOn:'承接日期',pageName:'主页全名',personaCode:'人设ID',operatorName:'经办客服',customerLabel:'客户昵称',customerRef:'客户标识',repliedOn:'首次回复日期',qualifiedOn:'首次明确需求日期',nextFollowup:'下次跟进日期',needSummary:'需求摘要',invalidReason:'无效原因',lossReason:'流失原因',note:'备注'};
  function text(key:string,max:number,required=false){const v=String(body[key]??'').trim();if((required&&!v)||v.length>max)throw new HttpError(400,`${labels[key]}${required?'须填写，且':''}最多 ${max} 字`);return v;}
  function date(key:string,required=false,future=false){const v=String(body[key]??'');if(!v&&!required)return null;if(!isIsoDate(v)||(!future&&v>today))throw new HttpError(400,`${labels[key]}无效或晚于今天`);return v;}
  const received=receivedOn??date('receivedOn',true)!;
  const channel=String(body.channel),contactStatus=String(body.contactStatus);
  if(!['ms','ws'].includes(channel)||!['unread','read_no_reply','replied'].includes(contactStatus))throw new HttpError(400,'渠道或沟通状态无效');
  const repliedOn=date('repliedOn'),qualifiedOn=date('qualifiedOn'),nextFollowup=date('nextFollowup',false,true);
  const needSummary=text('needSummary',1000);
  const rawCode=String(body.invalidReasonCode??'').trim();
  if(!['','no_chinese','misclick','obscene','custom'].includes(rawCode))throw new HttpError(400,'无效原因类型无效');
  let invalidReasonCode=rawCode as InvalidReasonCode;
  let invalidReason=text('invalidReason',500);
  let invalidReviewStatus:InvalidReviewStatus='';
  if(invalidReasonCode==='no_chinese'||invalidReasonCode==='misclick'||invalidReasonCode==='obscene'){
    invalidReason=INVALID_REASON_PRESETS[invalidReasonCode];
    invalidReviewStatus='approved';
  }else if(invalidReasonCode==='custom'){
    if(!invalidReason)throw new HttpError(400,'选择“其他（需主管复核）”时须填写具体判定原因');
    invalidReviewStatus='pending';
  }else if(invalidReason){
    const matched=(Object.entries(INVALID_REASON_PRESETS) as Array<[keyof typeof INVALID_REASON_PRESETS,string]>).find(([,label])=>label===invalidReason);
    if(matched){invalidReasonCode=matched[0];invalidReviewStatus='approved';}
    else{invalidReasonCode='custom';invalidReviewStatus='pending';}
  }
  if(repliedOn&&repliedOn<received)throw new HttpError(400,'首次回复不能早于承接日期');
  if(qualifiedOn&&(!repliedOn||qualifiedOn<repliedOn||!needSummary||invalidReason))throw new HttpError(400,'明确需求须填写摘要、首次回复日期，且不能同时标记无效');
  if(contactStatus==='replied'&&!repliedOn)throw new HttpError(400,'已回复须填写首次回复日期');
  if(nextFollowup&&nextFollowup<received)throw new HttpError(400,'跟进日期不能早于承接日期');
  return {receivedOn:received,pageName:text('pageName',128,true),personaCode:text('personaCode',128),operatorName:text('operatorName',128,true),channel:channel as Lead['channel'],customerLabel:text('customerLabel',128,true),customerRef:text('customerRef',128),contactStatus:contactStatus as Lead['contactStatus'],repliedOn,qualifiedOn,needSummary,invalidReason,invalidReasonCode,invalidReviewStatus,lossReason:text('lossReason',500),nextFollowup,note:text('note',1000)};
}
export function leadMetrics(leads:Lead[],today:string){
  const active=leads.filter(l=>!l.voidedAt),n=active.length;
  const sameDay=active.filter(l=>l.qualifiedOn===l.receivedOn).length;
  const withinSeven=active.filter(l=>l.qualifiedOn&&l.qualifiedOn<=addDays(l.receivedOn,6)).length;
  const qualified=active.filter(l=>l.qualifiedOn).length;
  return {received:n,ms:active.filter(l=>l.channel==='ms').length,ws:active.filter(l=>l.channel==='ws').length,
    replied:active.filter(l=>l.repliedOn&&!isConfirmedInvalidLead(l)).length,qualified,sameDay,withinSeven,
    sameDayRate:n?Math.round(sameDay/n*1000)/10:null,sevenDayRate:n?Math.round(withinSeven/n*1000)/10:null,
    observing:active.filter(l=>addDays(l.receivedOn,6)>today).length,
    invalid:active.filter(l=>isConfirmedInvalidLead(l)).length,
    pendingInvalid:active.filter(l=>l.invalidReviewStatus==='pending').length,
    lost:active.filter(l=>l.lossReason).length,due:active.filter(l=>l.nextFollowup&&l.nextFollowup<=today&&!l.lossReason&&!isConfirmedInvalidLead(l)).length};
}
