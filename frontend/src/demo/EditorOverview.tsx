import {useEffect,useRef,useState} from 'react';
import {api} from '../api';
import {toErrorMessage} from '../errors';
import {editorNames,type ProductionRow} from '../productionGroups';
import {detailLines,editorNote} from '../dailyDetail';
import {InfoTip} from '../InfoTip';
import {shift} from './bossTrendData';
import {AnalysisPlot,ChartStyleControl,useChartStyle} from './AnalysisChart';
import {editorAnalysis} from './editorAnalysisData';
import './editor-overview.css';

const count=(value:number|null)=>value===null?'—':value.toLocaleString('zh-CN');
export default function EditorOverview({today}:{today:string}){
  const [rows,setRows]=useState<ProductionRow[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0);
  const [range,setRange]=useState({from:shift(today,-6),to:today}),[draft,setDraft]=useState(range),[filters,setFilters]=useState({editor:'',persona:''}),[dimension,setDimension]=useState<'editor'|'persona'>('editor');
  const [metric,setMetric]=useState<'shoot'|'edit'|'sent'|'inventory'>('edit'),[selected,setSelected]=useState(today),[page,setPage]=useState(0);
  const [style,setStyle]=useChartStyle(),drawer=useRef<HTMLDialogElement>(null);
  useEffect(()=>{let active=true;setLoading(true);setError('');setRows([]);void api.editorReports().then(data=>{if(active)setRows(data.reports as unknown as ProductionRow[]);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[tick]);
  const valid=!!range.from&&range.from<=range.to&&range.to<=today&&(Date.parse(range.to)-Date.parse(range.from))/86400000<31;
  const data=valid?editorAnalysis(rows,range,filters,dimension):null;
  const sorted=[...(data?.groups||[])].sort((a,b)=>{const av=a[metric],bv=b[metric];return av===null?bv===null?a.name.localeCompare(b.name,'zh-CN'):1:bv===null?-1:bv-av||a.name.localeCompare(b.name,'zh-CN');});
  const records=data?.period||[];
  function pick(from:string,to=today){setRange({from,to});setDraft({from,to});setSelected(to);setPage(0);}
  const [recordGroup,setRecordGroup]=useState<string|null>(null);
  const visibleRecords=recordGroup===null?records:records.filter(row=>String(dimension==='editor'?row.editorName||'历史未归类':row.personaName||'未命名人设')===recordGroup);
  const recordPages=Math.max(0,Math.ceil(visibleRecords.length/20)-1);
  function openRecords(group:string|null=null){
    setRecordGroup(group);
    setPage(0);
    drawer.current?.showModal();
  }
  return <section className="editor-overview" aria-label="拍剪汇总" aria-busy={loading}>
    <header className="analysis-toolbar"><h1>拍剪汇总 <InfoTip label="拍剪统计口径" text={editorNote+' 期间拍摄、剪辑、交付按日报累加；库存只加最近一次填报当天表格里的屯量，更早的人设不带入当天。未填报不当作零。'}/></h1><button type="button" className="secondary" disabled={loading} onClick={()=>setTick(n=>n+1)}>刷新</button></header>
    <div className="analysis-toolbar eo-toolbar"><div className="eo-period"><div className="analysis-tabs" aria-label="拍剪日期范围">{[['今日',today],['近7天',shift(today,-6)],['本月',today.slice(0,8)+'01']].map(([label,from])=><button type="button" key={label} aria-pressed={range.from===from&&range.to===today} onClick={()=>pick(from)}>{label}</button>)}</div><details className="eo-custom"><summary>自定义日期</summary><form onSubmit={e=>{e.preventDefault();pick(draft.from,draft.to);}}><label>开始<input type="date" required max={draft.to||today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束<input type="date" required min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit">查询</button><small>最多31天</small></form></details>
    <p className="analysis-caption">{range.from} 至 {range.to}</p></div>
    <div className="eo-filter-fields"><label className="row">拍剪师<select aria-label="拍剪师筛选" value={filters.editor} onChange={e=>{setFilters({...filters,editor:e.target.value});setPage(0);}}><option value="">全部拍剪师</option>{editorNames.map(name=><option key={name}>{name}</option>)}<option value="legacy">历史未归类</option></select></label><label className="row">人设／主页<select aria-label="拍剪人设筛选" value={filters.persona} onChange={e=>{setFilters({...filters,persona:e.target.value});setPage(0);}}><option value="">全部人设</option>{[...new Set(rows.map(r=>String(r.personaName||'')))].filter(Boolean).sort().map(name=><option key={name}>{name}</option>)}</select></label></div><button type="button" className="text-action" onClick={()=>{setFilters({editor:'',persona:''});setPage(0);}}>清除筛选</button></div>
    {(filters.editor||filters.persona)&&<p className="analysis-caption">{filters.editor==='legacy'?'历史未归类':filters.editor} {filters.persona}</p>}
    {!valid&&<p className="error" role="alert">请选择1至31天的有效区间，结束日期不能晚于今天。</p>}
    {error?<p className="error" role="alert">{error}</p>:loading?<p role="status">正在读取拍剪日报…</p>:data&&<>
        <div className="eo-kpis" aria-label="全组拍剪概况">
          {([['sent','发给运营（交付）'],['shoot','拍摄素材'],['edit','剪辑完成'],['inventory','期末成片库存']] as const).map(([key,label])=>
            <article key={key} className={key==='sent'?'eo-hero':''}>
              <header><span>{label}</span><small className="eo-chip">{key==='inventory'?(data.summary.snapshotDates.at(-1)?'截至 '+data.summary.snapshotDates.at(-1)!.slice(5):'快照待补'):key==='edit'&&data.summary.shoot&&data.summary.edit!==null?`剪辑／拍摄 ${(data.summary.edit/data.summary.shoot*100).toFixed(1)}%`:'本期累计'}</small></header>
              <strong>{count(data.summary[key])}{data.summary[key]!==null&&<> <span className="eo-unit">条</span></>}</strong>
              <small className="eo-kpi-note">{{sent:'期间已登记交付',shoot:'期间已登记素材',edit:'期间已登记成片',inventory:'可供运营排期储备'}[key]}</small>
            </article>)}
        </div>
        {data.summary.snapshotDates[0]&&data.summary.snapshotDates[0]<range.to&&<p className="data-flag">库存按最近填报日 {data.summary.snapshotDates[0].slice(5)} 的当日屯量计算，这一天之后还没有新填报。</p>}
        <div className="eo-main-layout">
          <section className="analysis-panel"><div className="analysis-toolbar"><h2>产出趋势</h2><div className="eo-trend-controls"><nav className="analysis-tabs eo-metrics" aria-label="拍剪对比指标">{([['sent','交付'],['shoot','拍摄'],['edit','剪辑'],['inventory','库存']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={metric===value} onClick={()=>setMetric(value)}>{label}</button>)}</nav><ChartStyleControl style={style} onChange={setStyle}/></div></div><p className="analysis-caption">{metric==='inventory'?'当天屯量相加 · 不带入更早人设':'按日报日期 · 数量'}</p><AnalysisPlot series={[data.series[metric]]} unit="count" label={`拍剪${data.series[metric].label}`} style={style} today={today} selected={selected} onSelect={setSelected}/></section>
          <section className="analysis-panel"><div className="analysis-toolbar"><h2>产出对比</h2><label>分类<select aria-label="拍剪分类方式" value={dimension} onChange={e=>setDimension(e.target.value as typeof dimension)}><option value="editor">按拍剪师</option><option value="persona">按人设／主页</option></select></label><button type="button" className="secondary eo-record-entry" onClick={()=>openRecords()}>查看原始日报 · {records.length} 条 →</button></div>
            <div className="eo-table-scroll"><table className="eo-table" aria-label="拍剪产出对比">
              <thead><tr><th scope="col">{dimension==='editor'?'拍剪师':'人设／主页'}</th>{['拍摄','剪辑','交付','库存','操作'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead>
              <tbody>{sorted.map(g=><tr key={g.name}>
                <th scope="row">{g.name}</th><td>{count(g.shoot)}</td><td>{count(g.edit)}</td><td className="eo-delivery">{count(g.sent)}</td><td>{count(g.inventory)}</td>
                <td><button type="button" className="text-action" onClick={()=>openRecords(g.name)}>看日报 →</button></td>
              </tr>)}</tbody>
            </table></div>
            {!sorted.length&&<p className="empty-state">当前范围暂无日报。</p>}
          </section>
        </div>
        <dialog className="eo-drawer" aria-labelledby="eo-drawer-title" ref={drawer} onClick={e=>{if(e.target===e.currentTarget) e.currentTarget.close();}}><div className="eo-drawer-body"><header className="analysis-toolbar"><h2 id="eo-drawer-title">{recordGroup?`${recordGroup} · `:""}原始拍剪日报 · {visibleRecords.length} 条</h2><button type="button" className="secondary" onClick={()=>drawer.current?.close()}>关闭</button></header><div className="analysis-records">{visibleRecords.slice(Math.min(page,recordPages)*20,(Math.min(page,recordPages)+1)*20).map(row=><details className="eo-record" key={row.id}><summary><strong>{row.editorName?String(row.editorName):'历史未归类'}</strong><span>{String(row.personaName||'未命名人设')} · {row.businessDate}</span></summary>{detailLines('editor_report',row).map(line=><p key={line}>{line}</p>)}</details>)}</div>{!visibleRecords.length&&<p className="empty-state">当前范围暂无日报。</p>}{recordPages>0&&<div className="analysis-pagination"><button type="button" className="secondary" disabled={page<=0} onClick={()=>setPage(Math.min(page,recordPages)-1)}>上一页</button>{Math.min(page,recordPages)+1}/{recordPages+1}<button type="button" className="secondary" disabled={page>=recordPages} onClick={()=>setPage(Math.min(page,recordPages)+1)}>下一页</button></div>}</div></dialog>
    </>}
  </section>;
}
