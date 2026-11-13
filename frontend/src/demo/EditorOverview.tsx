import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {toErrorMessage} from '../errors';
import {editorNames,type ProductionRow} from '../productionGroups';
import {detailLines,editorNote} from '../dailyDetail';
import {InfoTip} from '../InfoTip';
import {shift} from './bossTrendData';
import {AnalysisPlot,ChartStyleControl,Ranking,useChartStyle} from './AnalysisChart';
import {editorAnalysis} from './editorAnalysisData';
import './editor-overview.css';

const count=(value:number|null)=>value===null?'—':value.toLocaleString('zh-CN');
export default function EditorOverview({today}:{today:string}){
  const [rows,setRows]=useState<ProductionRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0);
  const [range,setRange]=useState({from:shift(today,-6),to:today}),[draft,setDraft]=useState(range),[filters,setFilters]=useState({editor:'',persona:''}),[dimension,setDimension]=useState<'editor'|'persona'>('editor');
  const [metric,setMetric]=useState<'shoot'|'edit'|'sent'|'inventory'>('edit'),[selected,setSelected]=useState(today),[view,setView]=useState<'summary'|'records'>('summary'),[page,setPage]=useState(0);
  const [style,setStyle]=useChartStyle(),returnY=useRef(0),heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');setRows([]);void api.editorReports().then(data=>{if(active)setRows(data.reports as unknown as ProductionRow[]);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[tick]);
  const valid=!!range.from&&range.from<=range.to&&range.to<=today&&(Date.parse(range.to)-Date.parse(range.from))/86400000<31;
  const data=valid?editorAnalysis(rows,range,filters,dimension):null;
  const sorted=[...(data?.groups||[])].sort((a,b)=>{const av=a[metric],bv=b[metric];return av===null?bv===null?a.name.localeCompare(b.name,'zh-CN'):1:bv===null?-1:bv-av||a.name.localeCompare(b.name,'zh-CN');});
  const records=data?.period||[],lastPage=Math.max(0,Math.ceil(records.length/20)-1),currentPage=Math.min(page,lastPage);
  function pick(from:string,to=today){setRange({from,to});setDraft({from,to});setSelected(to);setPage(0);}
  function openRecords(){returnY.current=window.scrollY;setView('records');setPage(0);requestAnimationFrame(()=>heading.current?.focus());}
  function back(){setView('summary');requestAnimationFrame(()=>window.scrollTo({top:returnY.current}));}
  return <section className="editor-overview" aria-label="拍剪汇总" aria-busy={loading}>
    <header className="analysis-toolbar"><h1 ref={heading} tabIndex={-1}>拍剪汇总 <InfoTip label="拍剪统计口径" text={editorNote+' 期间拍摄、剪辑、交付按日报累加；库存从各拍剪师与人设组合取截止日期之前最近一次快照，可能早于区间开始日。未填报不当作零。'}/></h1><button type="button" className="secondary" disabled={loading} onClick={()=>setTick(n=>n+1)}>刷新</button></header>
    <div className="analysis-toolbar"><div className="analysis-tabs" aria-label="拍剪日期范围">{[['今日',today],['近7天',shift(today,-6)],['本月',today.slice(0,8)+'01']].map(([label,from])=><button type="button" key={label} aria-pressed={range.from===from&&range.to===today} onClick={()=>pick(from)}>{label}</button>)}</div><details className="eo-custom"><summary>自定义日期</summary><form onSubmit={e=>{e.preventDefault();pick(draft.from,draft.to);}}><label>开始<input type="date" required max={draft.to||today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束<input type="date" required min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit">应用</button><small>最多31天</small></form></details></div>
    <p className="analysis-caption">{range.from} 至 {range.to}</p>
    <details className="eo-filters"><summary>拍剪师／人设筛选{filters.editor||filters.persona?' · 已设置':''}</summary><div className="grid two"><label className="row">拍剪师<select aria-label="拍剪师筛选" value={filters.editor} onChange={e=>{setFilters({...filters,editor:e.target.value});setPage(0);}}><option value="">全部拍剪师</option>{editorNames.map(name=><option key={name}>{name}</option>)}<option value="legacy">历史未归类</option></select></label><label className="row">人设／主页<select aria-label="拍剪人设筛选" value={filters.persona} onChange={e=>{setFilters({...filters,persona:e.target.value});setPage(0);}}><option value="">全部人设</option>{[...new Set(rows.map(r=>String(r.personaName||'')))].filter(Boolean).sort().map(name=><option key={name}>{name}</option>)}</select></label></div><button type="button" className="text-action" onClick={()=>{setFilters({editor:'',persona:''});setPage(0);}}>清除筛选</button></details>
    {(filters.editor||filters.persona)&&<p className="analysis-caption">{filters.editor==='legacy'?'历史未归类':filters.editor} {filters.persona}</p>}
    {!valid&&<p className="error" role="alert">请选择1至31天的有效区间，结束日期不能晚于今天。</p>}
    {error?<p className="error" role="alert">{error}</p>:loading?<p role="status">正在读取拍剪日报…</p>:data&&<>
      {view==='summary'?<>
        <div className="eo-kpis" aria-label="全组拍剪概况">{[['shoot','拍摄'],['edit','剪辑'],['sent','发给运营'],['inventory','期末库存']] .map(([key,label])=><article key={key}><span>{label}</span><strong>{count(data.summary[key as typeof metric])}</strong><small>{key==='inventory'?data.summary.snapshotDates.length?`快照 ${data.summary.snapshotDates[0].slice(5)}${data.summary.snapshotDates.length>1?` 至 ${data.summary.snapshotDates.at(-1)!.slice(5)}`:''}`:'快照待补':'期间已登记'}</small></article>)}</div>
        {data.summary.snapshotDates.some(date=>date<range.to)&&<p className="data-flag">部分库存沿用较早快照；不是截止日全部同步盘点。</p>}
        <div className="eo-main-layout"><section className="analysis-panel"><div className="analysis-toolbar"><h2>产出对比</h2><label>分类<select aria-label="拍剪分类方式" value={dimension} onChange={e=>setDimension(e.target.value as typeof dimension)}><option value="editor">按拍剪师</option><option value="persona">按人设／主页</option></select></label></div>
          <nav className="analysis-tabs eo-metrics" aria-label="拍剪对比指标">{([['shoot','拍摄'],['edit','剪辑'],['sent','交付'],['inventory','库存']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={metric===value} onClick={()=>setMetric(value)}>{label}</button>)}</nav>
          <Ranking label="拍剪产出排名" rows={sorted.map(g=>({key:g.name,label:g.name,value:g[metric],display:count(g[metric]),note:`拍 ${count(g.shoot)} · 剪 ${count(g.edit)} · 交付 ${count(g.sent)} · 库存 ${count(g.inventory)}`}))}/>
        </section><section className="analysis-panel"><div className="analysis-toolbar"><h2>{data.series[metric].label}{metric==='inventory'?'轨迹':'趋势'}</h2><ChartStyleControl style={style} onChange={setStyle}/></div><p className="analysis-caption">{metric==='inventory'?'各师／人设最近快照 · 未同步不推算新增':'按日报日期 · 数量'}</p><AnalysisPlot series={[data.series[metric]]} unit="count" label={`拍剪${data.series[metric].label}`} style={style} today={today} selected={selected} onSelect={setSelected}/></section></div>
        <button type="button" className="secondary eo-record-entry" onClick={openRecords}>查看原始日报 · {records.length} 条 →</button>
      </>:<><button type="button" className="secondary analysis-back" onClick={back}>← 返回拍剪汇总</button><h2>原始拍剪日报 · {records.length} 条</h2><div className="analysis-records">{records.slice(currentPage*20,(currentPage+1)*20).map(row=><details className="eo-record" key={row.id}><summary><strong>{row.editorName?String(row.editorName):'历史未归类'}</strong><span>{String(row.personaName||'未命名人设')} · {row.businessDate}</span></summary>{detailLines('editor_report',row).map(line=><p key={line}>{line}</p>)}</details>)}</div>{!records.length&&<p className="empty-state">当前范围暂无日报。</p>}{lastPage>0&&<div className="analysis-pagination"><button type="button" className="secondary" disabled={!currentPage} onClick={()=>setPage(currentPage-1)}>上一页</button>{currentPage+1}/{lastPage+1}<button type="button" className="secondary" disabled={currentPage===lastPage} onClick={()=>setPage(currentPage+1)}>下一页</button></div>}</>}
    </>}
  </section>;
}
