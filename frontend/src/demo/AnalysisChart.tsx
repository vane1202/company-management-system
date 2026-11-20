import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ChartStyle, TrendSeries } from './bossTrendData';
import { lineSegments } from './bossTrendData';
import './analysis-chart.css';
import './chart-style-control.css';

const styleKey='cms-demo-boss-chart-style-v1';
const listeners=new Set<()=>void>();
let chosen:ChartStyle|undefined;
const readStyle=():ChartStyle=>{if(chosen)return chosen;try{return localStorage.getItem(styleKey)==='bar'?'bar':'line';}catch{return 'line';}};
export function useChartStyle(){
  const style=useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},readStyle,()=> 'line' as ChartStyle);
  return [style,(value:ChartStyle)=>{chosen=value;try{localStorage.setItem(styleKey,value);}catch{/* Optional appearance preference. */}listeners.forEach(listener=>listener());}] as const;
}
export function ChartStyleControl({style,onChange}:{style:ChartStyle;onChange:(style:ChartStyle)=>void}){
  return <div className="chart-style-control" role="group" aria-label="图表形式">{(['line','bar'] as const).map(value=><button type="button" key={value} aria-pressed={style===value} onClick={()=>onChange(value)}>{value==='line'?'折线图':'柱状图'}</button>)}</div>;
}
export function chartCeiling(max:number){if(max<=0)return 1;const base=10**Math.floor(Math.log10(max));return [1,2,5,10].map(n=>n*base).find(n=>n>=max)||base*10;}
const palette=['#177564','#3d6a9e','#7d5a9e','#b0742a','#2e8590','#66803a'];
export function seriesColor(key:string){let hash=0;for(const char of key)hash=(hash*31+char.charCodeAt(0))>>>0;return palette[hash%palette.length];}
const rateText=(value:string)=>{const text=Number(value).toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1});return (text.endsWith('.0')?text.slice(0,-2):text)+'%';};
const valueLabel=(value:string|null,unit:'money'|'usd'|'count'|'rate')=>value===null?'—':unit==='money'?`¥${Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`:unit==='usd'?`${Number(value).toLocaleString('zh-CN', {minimumFractionDigits:2,maximumFractionDigits:2})} USD`:unit==='rate'?rateText(value):Number(value).toLocaleString('zh-CN');


/** Match the actual card width so SVG labels retain their physical font size in any column. */
function usePlotWidth(){
  const ref=useRef<HTMLDivElement>(null),[width,setWidth]=useState(640);
  useEffect(()=>{
    const node=ref.current;if(!node)return;
    const measure=()=>{const next=Math.max(200,Math.round(node.getBoundingClientRect().width));setWidth(previous=>previous===next?previous:next);};
    measure();
    if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(measure);observer.observe(node);return()=>observer.disconnect();}
    window.addEventListener('resize',measure);return()=>window.removeEventListener('resize',measure);
  },[]);
  return [ref,width] as const;
}

/** One time axis, explicit gaps and a keyboard date selector; source values are never interpolated. */
export function AnalysisPlot({series,style,today,selected,onSelect,label,unit='money'}:{series:TrendSeries[];style:ChartStyle;today:string;selected:string;onSelect:(day:string)=>void;label:string;unit?:'money'|'usd'|'count'|'rate'}){
  const id=useId(),[plotRef,W]=usePlotWidth(),days=series[0]?.points.map(p=>p.date)||[];
  const top=20,bottom=190,left=64,width=W-74,group=width/Math.max(1,days.length);
  const labelEvery=Math.max(1,Math.ceil(days.length/Math.max(2,Math.floor(width/60))));
  const max=Math.max(0,...series.flatMap(s=>s.points.map(p=>p.value===null?0:Number(p.value))));
  const step=unit==='rate'?(max<=100?25:chartCeiling(max/4)):unit==='count'?Math.max(1,chartCeiling(max/4)):chartCeiling(max/4),ceiling=unit==='rate'&&max<=100?100:Math.max(step,Math.ceil(max/step)*step);
  const ticks=Array.from({length:Math.round(ceiling/step)+1},(_,i)=>i*step);
  const x=(i:number)=>left+(i+.5)*group,y=(v:number)=>bottom-v/ceiling*(bottom-top);
  const hasData=series.some(s=>s.points.some(p=>p.value!==null));
  const selectedDay=days.includes(selected)?selected:days.at(-1)||'';
  return <div className="analysis-plot" ref={plotRef}><svg viewBox={`0 0 ${W} 234`} style={{height:234}} role="img" aria-labelledby={id}><title id={id}>{label}，{style==='line'?'折线图':'柱状图'}，{unit==='money'?'人民币':unit==='usd'?'USD':unit==='rate'?'百分比':'数量'}；无记录断开，今日未结束。</title>
    {ticks.map(tick=><g key={tick}><line x1={left} x2={W-10} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeDasharray={tick?'3 4':undefined}/><text x="55" y={y(tick)+4} textAnchor="end" className="ac-axis">{tick>=10000?`${Number((tick/10000).toFixed(1))}万`:tick.toLocaleString('zh-CN',{maximumFractionDigits:2})}</text></g>)}
    {hasData?series.map((s,n)=>{const color=seriesColor(s.key);return <g key={s.key}>
      {style==='line'?<>{lineSegments(s.points).flatMap(segment=>segment.slice(1).map((i,j)=><line key={i} x1={x(segment[j])} y1={y(Number(s.points[segment[j]].value))} x2={x(i)} y2={y(Number(s.points[i].value))} stroke={color} strokeWidth="2" strokeDasharray={days[i]===today?'5 4':undefined}/>))}{s.points.map((p,i)=>p.value===null?null:<circle key={p.date} cx={x(i)} cy={y(Number(p.value))} r={selectedDay===p.date?4.5:3} fill={color} stroke="var(--card)" strokeWidth="1"/>)}</>:
      s.points.map((p,i)=>p.value===null?null:<rect key={p.date} x={x(i)-group*.36+n*group*.72/series.length} width={Math.max(.5,group*.72/series.length-1)} y={y(Number(p.value))} height={Math.max(1,bottom-y(Number(p.value)))} fill={color} opacity={days[i] === today ? .45 : .8} stroke={days[i]===today?color:undefined} strokeDasharray={days[i]===today?'3 3':undefined}/>)}
    </g>;}):<text x={W/2+25} y="104" textAnchor="middle" className="ac-empty">该区间暂无可绘制的已登记数据</text>}
    {days.map((day,i)=><g key={day}><title>{day}{day===today?'（今日未结束）':''}{series.map(s=>{const p=s.points[i];return `；${s.label}：${p.value===null?p.reason:valueLabel(p.value,unit)}${p.native?'；'+p.native:''}`;}).join('')}</title><rect x={left+i*group} y={top} width={group} height={bottom-top+8} fill={selectedDay===day?'var(--jade)':'transparent'} fillOpacity={selectedDay === day ? .06 : 0} onClick={()=>onSelect(day)} className="ac-hit"/>{series.every(s=>s.points[i].value===null)&&<text x={x(i)} y={bottom-4} textAnchor="middle" className="ac-axis">—</text>}{(i===0||i===days.length-1||(i%labelEvery===0&&days.length-1-i>=labelEvery))&&<text x={x(i)} y="217" textAnchor="middle" className="ac-axis">{day.slice(5)}</text>}</g>)}
  </svg><div className="ac-legend">{series.map(s=><span key={s.key}><i style={{background:seriesColor(s.key)}}/>{s.label}</span>)}</div>
  {!!days.length&&<div className="ac-selection"><label>查看日期<select aria-label={`${label}查看日期`} value={selectedDay} onChange={e=>onSelect(e.target.value)}>{days.map(date=><option key={date}>{date}</option>)}</select></label><output aria-live="polite">{series.map(s=>{const p=s.points.find(p=>p.date===selectedDay);return <span key={s.key}>{s.label} <b>{p?.value!=null?valueLabel(p.value,unit):p?.reason||'无记录'}</b>{(unit==='usd'||unit==='count'||unit==='rate')&&p?.native&&<small className="ac-provenance">{p.native}</small>}</span>;})}{selectedDay===today&&<small>今日未结束</small>}</output></div>}
  </div>;
}

type RankRow={key:string;label:string;value:number|null;display:string;note?:string};
export function Ranking({rows,onOpen,label}:{rows:RankRow[];onOpen?:(key:string)=>void;label:string}){
  const max=Math.max(0,...rows.map(row=>row.value??0));
  return <div className="analysis-ranking" aria-label={label}>{rows.map((row,index)=>{const content=<><span className="ar-name"><small>{index+1}</small><strong>{row.label}</strong></span><b>{row.display}</b>{row.note&&<small className="ar-note">{row.note}</small>}<span className="ar-track" aria-hidden="true"><i style={{width:`${row.value===null||!max?0:Math.max(0,row.value)/max*100}%`,background:seriesColor(row.key)}}/></span></>;return onOpen?<button type="button" className="ar-row" key={row.key} onClick={()=>onOpen(row.key)}>{content}</button>:<div className="ar-row" key={row.key}>{content}</div>;})}{!rows.length&&<p className="empty-state">当前范围暂无已登记数据</p>}</div>;
}
