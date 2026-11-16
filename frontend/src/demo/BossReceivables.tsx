import {useEffect,useState} from 'react';
import type {LiveBusinessData} from '../api';
import {convert} from './supervisorPerformanceData';
import {useReferenceQuotes} from './useReferenceQuotes';
import {yuan} from '../dashboardDisplay';

export default function BossReceivables({data,onOpen}:{data:LiveBusinessData;onOpen:()=>void}){
 const revision=useReferenceQuotes(),[value,setValue]=useState<string|null>(null),[loading,setLoading]=useState(true);
 const pending=data.operations?.orders.filter(o=>o.status==='unpaid'||o.status==='partial')??[];
 const incomplete=!data.operations||pending.some(o=>o.balance==null||!o.currency);
 const unknown=data.operations?.orders.filter(o=>o.status==='unknown').length??0;
 useEffect(()=>{let active=true;setLoading(true);setValue(null);if(incomplete){setLoading(false);return;}
  convert(pending.map(o=>({date:data.period.to,amount:o.balance!,currency:o.currency!}))).then(result=>{if(active)setValue(result.cny);}).catch(()=>{if(active)setValue(null);}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[data,revision]);
 return <div className="lr-receivable-summary" aria-label="待收款汇总"><span>待收款 <b>{loading?'…':incomplete||value===null?'待核对':`约 ${yuan(value)}`}</b><small>{data.operations?`${pending.length} 笔 · 含历史欠款${unknown?` · 另有 ${unknown} 笔付款待核对`:''}`:'付款资料待接入'}</small></span><button type="button" className="text-action" onClick={onOpen}>查看订单明细 →</button></div>;
}
