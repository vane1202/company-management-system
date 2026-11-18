import type {Currency,FinanceData,FinancePayment,LiveOperationOrder,SettlementRecord} from '../api';
import {cents,money} from '../commerceUi';
import {isIsoDate} from '../dates';
import {convertCustomerPayments,getReferenceQuote,type CustomerPaymentFx} from './adExchangeRates';

export type CashAmounts=Record<Currency,string|null>;
export type HeldPayment=FinancePayment&{pendingAsOf:string|null;heldDays:number};
export type AgencyGroup={key:string;channel:string;currency:Currency;pending:string|null;count:number;oldestDate:string;heldDays:number;lastTransferDate:string|null;payments:HeldPayment[]};
export type CashArrival={id:string;date:string;channel:string;kind:'direct'|'agency';amountCny:string|null;reference:string;payments:FinancePayment[];settlement?:SettlementRecord};
const currencies:Currency[]=['CNY','TWD','USD'];
const initial=():CashAmounts=>({CNY:'0.00',TWD:'0.00',USD:'0.00'});
// Aggregate totals may exceed the per-entry 12-digit input limit.
function aggregateCents(v:string|null):bigint|null{
  if(v===null||!/^\d+(?:\.\d{1,2})?$/.test(v))return null;
  const [whole,fraction='']=v.split('.');return BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
}
function add(a:string|null,b:string|null):string|null{const x=aggregateCents(a),y=aggregateCents(b);return x===null||y===null?null:money(x+y);}
export function formatCashValue(v:string){
  const n=aggregateCents(v);if(n===null)return '待核对';
  return `${(n/100n).toLocaleString('zh-CN')}.${String(n%100n).padStart(2,'0')}`;
}

export function buildOutstandingPayments(date: string, orders: readonly Pick<LiveOperationOrder, 'currency' | 'balance'>[]) {
  const balances: Record<Currency, bigint> = { CNY: 0n, TWD: 0n, USD: 0n };
  let incomplete = false;
  for (const order of orders) {
    const balance = aggregateCents(order.balance);
    if (!order.currency || balance === null) {
      incomplete = true;
      continue;
    }
    balances[order.currency] += balance;
  }
  const totals = { CNY: money(balances.CNY), TWD: money(balances.TWD), USD: money(balances.USD) };
  return { totals, records: balanceRows(date, totals), incomplete };
}

function balanceRows(date: string, totals: CashAmounts) {
  return currencies.flatMap(currency => {
    const amount = totals[currency];
    return amount && amount !== '0.00' ? [{date,currency,amount}] : [];
  });
}

export async function convertPendingCash(
  date: string,
  orders: readonly Pick<LiveOperationOrder, 'currency' | 'balance'>[],
  agency: CashAmounts,
  getQuote = getReferenceQuote,
) {
  const unpaid = buildOutstandingPayments(date, orders);
  const [customer, held] = await Promise.all([
    convertCustomerPayments(unpaid.records, unpaid.totals, getQuote),
    convertCustomerPayments(balanceRows(date, agency), agency, getQuote),
  ]);
  const customerBalance = unpaid.incomplete ? {...customer, cny: null, incomplete: true} : customer;
  const total = {
    cny: add(customerBalance.cny, held.cny),
    hasForeign: customerBalance.hasForeign || held.hasForeign,
    incomplete: customerBalance.incomplete || held.incomplete,
  };
  return {customer:customerBalance,held,total};
}

export function formatPendingCash(value: Pick<CustomerPaymentFx, 'cny' | 'hasForeign' | 'incomplete'> | undefined) {
  if (!value) return '—';
  if (value.incomplete) return '待核对';
  if (value.cny === null) return '待折算';
  return `${value.hasForeign ? '约 ' : ''}¥${formatCashValue(value.cny)}`;
}
function clean(v:string):string|null{const n=cents(v);return n===null?null:money(n);}
function days(from:string,to:string){return Math.max(0,Math.floor((Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))/86400000));}

/** Recompute registered flows and end-date held funds from source rows.
 * Current pendingAmount / settled_amount snapshots cannot answer historical dates. */
export function buildCashBoard(data:FinanceData,period:{from:string;to:string}){
  if(!isIsoDate(period.from)||!isIsoDate(period.to)||period.from>period.to)throw Error('请选择有效日期范围');
  let issueCount=0,unscopedPayments=0,unscopedSettlements=0;
  const inPeriod=(d:string)=>d>=period.from&&d<=period.to;
  const payments=data.payments.filter(p=>{
    if(p.voided_at)return false;
    if(!isIsoDate(p.payment_date)||!currencies.includes(p.currency)){issueCount++;unscopedPayments++;return false;}
    return p.payment_date<=period.to;
  });
  const paymentMap=new Map(payments.map(p=>[p.id,p]));
  const settlements=data.settlements.filter(s=>{
    if(s.voided_at)return false;
    if(!isIsoDate(s.settled_on)){issueCount++;unscopedSettlements++;return false;}
    return s.settled_on<=period.to;
  });
  const allocated=new Map<string,bigint>(),invalid=new Set<string>();
  for(const s of settlements)for(const a of s.allocations){
    const p=paymentMap.get(a.paymentId),amount=cents(a.foreignAmount);
    if(!p||!p.third_party||p.currency!==s.currency||p.channel!==s.channel||amount===null){issueCount++;if(p)invalid.add(p.id);continue;}
    allocated.set(p.id,(allocated.get(p.id)??0n)+amount);
  }
  const receipts=initial(),pending=initial(),arrivals:CashArrival[]=[];
  let directCny:string|null='0.00',thirdPartyCny:string|null='0.00';
  const groupMap=new Map<string,AgencyGroup>();
  for(const p of payments){
    const amount=clean(p.amount);
    if(amount===null)issueCount++;
    if(inPeriod(p.payment_date)){
      receipts[p.currency]=add(receipts[p.currency],amount);
      if(!p.third_party){
        const cny=p.currency==='CNY'?amount:null;
        if(p.currency!=='CNY')issueCount++; // No invented exchange rate for direct foreign receipts.
        directCny=add(directCny,cny);
        arrivals.push({id:'direct:'+p.id,date:p.payment_date,channel:p.channel,kind:'direct',amountCny:cny,reference:p.reference,payments:[p]});
      }
    }
    if(!p.third_party)continue;
    const paid=amount===null?null:cents(amount),used=allocated.get(p.id)??0n;
    const bad=invalid.has(p.id)||paid===null||(paid!==null&&used>paid);
    if(paid!==null&&used>paid)issueCount++;
    const remaining=bad?null:money(paid!-used);
    pending[p.currency]=add(pending[p.currency],remaining);
    if(remaining==='0.00')continue;
    const key=JSON.stringify([p.channel,p.currency]);
    let group=groupMap.get(key);
    if(!group){
      const dates=settlements.filter(s=>s.channel===p.channel&&s.currency===p.currency).map(s=>s.settled_on).sort();
      group={key,channel:p.channel||'账户待补',currency:p.currency,pending:'0.00',count:0,oldestDate:p.payment_date,heldDays:0,lastTransferDate:dates.at(-1)??null,payments:[]};
      groupMap.set(key,group);
    }
    group.pending=add(group.pending,remaining);group.count++;
    if(p.payment_date<group.oldestDate)group.oldestDate=p.payment_date;
    group.heldDays=days(group.oldestDate,period.to);
    group.payments.push({...p,pendingAsOf:remaining,heldDays:days(p.payment_date,period.to)});
  }
  for(const s of settlements.filter(s=>inPeriod(s.settled_on))){
    const amount=clean(s.net_cny);if(amount===null)issueCount++;
    thirdPartyCny=add(thirdPartyCny,amount);
    arrivals.push({id:'settlement:'+s.id,date:s.settled_on,channel:s.channel,kind:'agency',amountCny:amount,reference:s.reference,payments:s.allocations.flatMap(a=>{const p=paymentMap.get(a.paymentId);return p?[p]:[];}),settlement:s});
  }
  // An unplaceable record must not silently disappear into a confirmed zero.
  if(unscopedPayments){for(const cur of currencies)receipts[cur]=null;directCny=null;}
  if(unscopedSettlements)thirdPartyCny=null;
  if(unscopedPayments||unscopedSettlements)for(const cur of currencies)pending[cur]=null;
  const groups=[...groupMap.values()].sort((a,b)=>b.heldDays-a.heldDays||a.channel.localeCompare(b.channel,'zh-CN')||a.currency.localeCompare(b.currency));
  if(unscopedPayments||unscopedSettlements)for(const g of groups){g.pending=null;for(const p of g.payments)p.pendingAsOf=null;if(unscopedSettlements)g.lastTransferDate='待核对';}
  for(const g of groups)g.payments.sort((a,b)=>a.payment_date.localeCompare(b.payment_date)||a.id.localeCompare(b.id));
  arrivals.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
  return {period,receipts,pending,directCny,thirdPartyCny,totalCny:add(directCny,thirdPartyCny),groups,arrivals,issueCount,pendingIncomplete:currencies.some(c=>pending[c]===null),receiptsIncomplete:currencies.some(c=>receipts[c]===null),paymentCount:payments.filter(p=>inPeriod(p.payment_date)).length,heldCount:groups.reduce((n,g)=>n+g.count,0)};
}
