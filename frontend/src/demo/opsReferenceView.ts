import { convertAdSpend, getReferenceQuote, type FxQuote, type FxCurrency } from "./adExchangeRates";

export type OpsTotals = {spendUsd:string|null;spendCny:string|null;consultCount:number|null;clickCount:number|null;consultationCostUsd:string|null;costStatus:string;recordCount:number;reportedDays:number;missingSpendCount:number;missingConsultCount:number;missingClickCount:number};
type Row={businessDate:string;spendUsd:string|null;personaName:string;platform:string;adAccountRef:string};
type Base={summary:OpsTotals;groups:(OpsTotals&{key:string;name:string})[];records:Row[];comparison:{totals:OpsTotals;records?:Row[]};trend:{days:(OpsTotals&{date:string})[]}};
type Quote=(date:string,currency:FxCurrency)=>Promise<FxQuote|null>;
const sum=(values:string[])=>values.reduce((n,v)=>{const [a,b='']=v.split('.');return n+BigInt(a)*100n+BigInt(b.padEnd(2,'0'));},0n);
const money=(n:bigint)=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
export async function buildOpsReference(data:Base,dimension:'persona'|'platform'|'account',quote:Quote=getReferenceQuote) {
  const quotes=new Map<string,FxQuote>(),missing=new Set<string>();let stale=false;
  // One quote per date for the entire current/comparison/group/trend presentation.
  const snapshots=new Map<string,Promise<FxQuote|null>>();
  const lookup=(date:string)=>{if(!snapshots.has(date))snapshots.set(date,quote(date,'USD'));return snapshots.get(date)!;};
  async function price(t:OpsTotals,records:Row[]) {
    const rows=records.filter(r=>r.spendUsd!==null).map(r=>({date:r.businessDate,amount:r.spendUsd!}));
    const fx=await convertAdSpend(rows,t.spendUsd??'0.00',lookup,t.missingSpendCount+(t.spendUsd===null?1:0));
    fx.quotes.forEach(q=>quotes.set(q.date,q));fx.missingDates.forEach(d=>missing.add(d));stale ||=fx.stale;
    const cost=fx.cny!==null&&t.consultCount!==null&&t.consultCount>0&&t.costStatus==='ready'
      ? money((sum([fx.cny])+BigInt(Math.floor(t.consultCount/2)))/BigInt(t.consultCount)):null;
    return {...t,spendCny:t.recordCount?fx.cny:null,consultationCostCny:cost};
  }
  const field=dimension==='persona'?'personaName':dimension==='platform'?'platform':'adAccountRef';
  const [summary,comparison,groups,days]=await Promise.all([
    price(data.summary,data.records),
    price(data.comparison.totals,data.comparison.records||[]),
    Promise.all(data.groups.map(async g=>({...await price(g,data.records.filter(r=>(r[field]||'__unassigned__')===g.key)),key:g.key,name:g.name}))),
    Promise.all(data.trend.days.map(async d=>({...await price(d,d.spendUsd===null?[]:[{businessDate:d.date,spendUsd:d.spendUsd,personaName:'',platform:'',adAccountRef:''}]),date:d.date})))
  ]);
  return {summary,comparison,groups,days,quotes:[...quotes.values()],missing:[...missing],stale};
}
