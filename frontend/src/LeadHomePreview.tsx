import {useEffect,useState} from 'react';
import {leadApi,leadStats,leadCoverage,percent} from './leadApi';
import {toErrorMessage} from './errors';
export function LeadHomePreview({from,to,today,tick}:{from:string;to:string;today:string;tick:number}){
 const [data,setData]=useState<ReturnType<typeof leadStats>|null>(null),[incomplete,setIncomplete]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');leadApi.list(from,to).then(r=>{if(active){setData(leadStats(r.leads,today));setIncomplete(leadCoverage(r.leads,r.reports).mismatches>0);}}).catch(e=>{if(active)setError(toErrorMessage(e));});return()=>{active=false};},[from,to,today,tick]);
 if(error)return <p className="error" role="alert">客户转化数据读取失败：{error}</p>;
 if(!data)return <p role="status">正在读取客户转化…</p>;
 if(!data.received)return <p className="notice">客户明细尚未登记，初步转化率未记录。</p>;
 return <div className="lead-home-preview"><div><span>明细承接</span><b>{data.received}</b></div><div><span>承接当日明确需求</span><b>{data.sameDay}</b></div><div><span>当日初步转化率</span><b>{incomplete?'待补明细':percent(data.sameDayRate)}</b></div></div>;
}
