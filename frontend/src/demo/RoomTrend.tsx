import {useEffect,useState} from 'react';
import {api,type LiveBusinessFilters} from '../api';
import {toErrorMessage} from '../errors';
import {buildTrend,shift,type TrendSeries} from './bossTrendData';
import {AnalysisPlot,ChartStyleControl,useChartStyle} from './AnalysisChart';
import {useReferenceQuotes} from './useReferenceQuotes';

export function RoomTrend({room,to,today,filters}:{room:string;to:string;today:string;filters:LiveBusinessFilters}){
  const [series,setSeries]=useState<TrendSeries|null>(null),[error,setError]=useState(''),[selected,setSelected]=useState(to),[tick,setTick]=useState(0);
  const [style,setStyle]=useChartStyle(),revision=useReferenceQuotes();
  useEffect(()=>{let active=true;setSeries(null);setError('');const range={from:shift(to,-6),to};
    void api.liveBusiness('custom',range,{...filters,room}).then(data=>buildTrend(data,range,room)).then(data=>{if(active)setSeries(data.series.turnover);}).catch(e=>{if(active)setError(toErrorMessage(e,'直播间趋势暂不可用'));});return()=>{active=false;};
  },[room,to,filters.host,filters.persona,filters.operator,revision,tick]);
  return <section className="lr-room-trend"><div className="analysis-toolbar"><h3>近7日开单</h3><ChartStyleControl style={style} onChange={setStyle}/></div><p className="analysis-caption">{shift(to,-6)} 至 {to} · 人民币</p>{error?<p role="alert" className="error">{error}<button type="button" className="text-action" onClick={()=>setTick(n=>n+1)}>重试</button></p>:series?<AnalysisPlot series={[series]} style={style} today={today} selected={selected} onSelect={setSelected} label={`${room}开单营业额`}/>:<p role="status">正在读取趋势…</p>}</section>;
}
