import type { Currency, LiveBusinessData, LiveBusinessEvent } from "../api";
import { convertAdSpend, convertCustomerPayments, getReferenceQuote, type FxCurrency, type FxQuote } from "./adExchangeRates";

export type ChartStyle = "line" | "bar";
export type TrendKey = "turnover" | "receipts" | "ads" | "expenses";
export type TrendPoint = {date:string; value:string|null; reason:string; count:number; native:string; estimated:boolean};
export type TrendSeries = {key:string;label:string;points:TrendPoint[]};
export type TrendData = {days:string[]; series:Record<TrendKey,TrendSeries>;rooms:TrendSeries[];rows:LiveBusinessEvent[];ads:LiveBusinessData['ads']['records'];previous:Record<TrendKey,string|null>;totals:Record<TrendKey,string|null>;stale:boolean;missingRates:boolean};
type Quote = (date:string,currency:FxCurrency)=>Promise<FxQuote|null>;
const units:Currency[]=["CNY","TWD","USD"];
export function cents(v:string) {if(!/^\d+(?:\.\d{1,2})?$/.test(v))throw Error("金额待核对");const [a,b=""]=v.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));}
export const money=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
export function shift(date:string,n:number){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
export function daysIn(from:string,to:string){
  if(![from,to].every(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+"T00:00:00Z"))&&new Date(d+"T00:00:00Z").toISOString().slice(0,10)===d))throw Error("请选择有效日期");
  const length=(Date.parse(to)-Date.parse(from))/86400000+1;
  if(length<1||length>31)throw Error("趋势区请选择1至31天");
  return Array.from({length},(_,i)=>shift(from,i));
}
export function previousRange(from:string,to:string){const n=daysIn(from,to).length;return {from:shift(from,-n),to:shift(from,-1)};}
export function lineSegments(points:TrendPoint[]){const segments:number[][]=[];let current:number[]=[];points.forEach((p,i)=>{if(p.value===null){if(current.length)segments.push(current);current=[];}else current.push(i);});if(current.length)segments.push(current);return segments;}
export function sumPoints(points:TrendPoint[]):string|null {
  // Missing days stay visible as gaps. The caption is explicitly "registered total".
  if(points.some(p=>p.reason==="金额待核对"||p.reason==="缺参考汇率"||p.reason==="明细待补齐"))return null;
  const known=points.filter(p=>p.value!==null);
  return known.length?money(known.reduce((n,p)=>n+cents(p.value!),0n)):null;
}
export async function buildTrend(data:LiveBusinessData,range:{from:string;to:string},room="",quote:Quote=getReferenceQuote):Promise<TrendData>{
  const dates=daysIn(range.from,range.to),previous=previousRange(range.from,range.to),allDates=[...daysIn(previous.from,previous.to),...dates];
  const rows=data.events.filter(e=>!room||(e.order.live_room_code||"__unassigned__")===room);
  const sales=(events:LiveBusinessEvent[])=>events.filter(e=>e.kind==="sale"&&!e.order.cancelled&&e.order.status!=="refunded");
  const rawPoints=(dates:string[],events:LiveBusinessEvent[],kind:"sale"|"expense"):TrendPoint[]=>dates.map(date=>{
    const items=(kind==="sale"?sales(events):events.filter(e=>e.kind===kind)).filter(e=>e.date===date);
    const observed=kind==="sale"?events.some(e=>e.kind==="sale"&&e.date===date):items.length>0;
    try {return {date,value:observed?money(items.reduce((n,e)=>{if(e.currency!=="CNY")throw Error("币种待核对");return n+cents(e.amount);},0n)):null,reason:observed?"":"无记录",count:items.length,native:"",estimated:false};}
    catch{return {date,value:null,reason:"金额待核对",count:items.length,native:"",estimated:false};}
  });
  let stale=false,missingRates=false;
  const receipts=await Promise.all(allDates.map(async date=>{
    const items=rows.filter(e=>e.kind==="receipt"&&e.date===date);
    if(!items.length)return {date,value:null,reason:"无记录",count:0,native:"",estimated:false};
    try {
      const totals={CNY:0n,TWD:0n,USD:0n};for(const e of items){if(!units.includes(e.currency))throw Error("币种待核对");totals[e.currency]+=cents(e.amount);}
      const fx=await convertCustomerPayments(items,{CNY:money(totals.CNY),TWD:money(totals.TWD),USD:money(totals.USD)},quote);
      stale ||= fx.stale;missingRates ||= fx.missingDates.length>0;
      return {date,value:fx.cny,reason:fx.cny===null?(fx.incomplete?"明细待补齐":"缺参考汇率"):"",count:items.length,native:units.filter(c=>totals[c]>0n).map(c=>`${money(totals[c])} ${c}`).join(" · "),estimated:fx.hasForeign};
    }catch{return {date,value:null,reason:"金额待核对",count:items.length,native:"",estimated:false};}
  }));
  // Ads are always company scope, including when room filters select a subset of orders.
  const ads=await Promise.all(allDates.map(async date=>{
    const items=data.ads.records.filter(e=>e.date===date);
    if(data.ads.unknownCount)return {date,value:null,reason:"明细待补齐",count:items.length,native:"",estimated:true};
    if(!items.length)return {date,value:null,reason:"无记录",count:0,native:"",estimated:true};
    try {
      const usd=money(items.reduce((n,e)=>n+cents(e.amount),0n));
      const fx=await convertAdSpend(items,usd,d=>quote(d,"USD"));stale ||= fx.stale;missingRates ||= fx.missingDates.length>0;
      return {date,value:fx.cny,reason:fx.cny===null?(fx.incomplete?"明细待补齐":"缺参考汇率"):"",count:items.length,native:`${usd} USD`,estimated:true};
    }catch{return {date,value:null,reason:"金额待核对",count:items.length,native:"",estimated:true};}
  }));
  const all:Record<TrendKey,TrendSeries>={turnover:{key:"turnover",label:"开单营业额",points:rawPoints(allDates,rows,"sale")},receipts:{key:"receipts",label:"客户已付款",points:receipts},ads:{key:"ads",label:"广告消耗",points:ads},expenses:{key:"expenses",label:"业务费用",points:rawPoints(allDates,rows,"expense")}};
  const totals={} as TrendData['totals'],prev={} as TrendData['previous'],series={} as TrendData['series'];
  for(const key of Object.keys(all) as TrendKey[]){const s=all[key];series[key]={...s,points:s.points.filter(p=>p.date>=range.from)};totals[key]=sumPoints(series[key].points);prev[key]=sumPoints(s.points.filter(p=>p.date<range.from));}
  const roomIds=[...new Set(rows.filter(e=>e.kind==="sale").map(e=>e.order.live_room_code||"__unassigned__"))];
  const rooms=roomIds.map(key=>({key,label:key==="__unassigned__"?"未归属直播间":key,points:rawPoints(dates,rows.filter(e=>(e.order.live_room_code||"__unassigned__")===key),"sale")}))
    .sort((a,b)=>Number(sumPoints(b.points)||0)-Number(sumPoints(a.points)||0));
  return {days:dates,series,rooms,rows,ads:data.ads.records,previous:prev,totals,stale,missingRates};
}
