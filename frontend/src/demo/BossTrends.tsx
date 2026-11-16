import { useEffect, useRef, useState } from "react";
import { api, type LiveBusinessData } from "../api";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import { buildTrend, daysIn, previousRange, shift, sumPoints, type TrendData, type TrendKey } from "./bossTrendData";
import "./boss-trends.css";
import { useReferenceQuotes } from "./useReferenceQuotes";
import type { CashView } from "../cashNavigation";
import type { WorkspaceRoute } from "../workspaceHistory";
import { defaultLiveView } from "../liveBusinessNavigation";

import { AnalysisPlot as TrendPlot, ChartStyleControl, Ranking, useChartStyle } from './AnalysisChart';
export { chartCeiling } from './AnalysisChart';
const currency=(value:string|null)=>value===null?'—':`¥${Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2})}`;

const definitions:Record<TrendKey,string>={turnover:"按开单日期统计料价＋代购费；排除当前已跑单、退款标记的源订单，后续追加收费另列。",receipts:"按实际付款日统计客户付款，含历史订单定金、尾款及售后收费；公司到账与第三方结算不替代客户付款。外币按付款日参考汇率折算。",ads:"全公司实际广告消耗，按消耗日美元参考汇率折算人民币；不是广告充值。选择直播间也不分摊广告。",expenses:"已登记的供货、加工、接待、证书、包装和运输等售后费用，按发生日统计；不是财务实际付款，不包含另行核算的工资与提成。"};

export default function BossTrends({today,tick,onOpen,onDrill,baseRange}:{today:string;tick:number;onOpen?:(page:"orders"|"finance"|"ops",cash?:CashView)=>void;onDrill?:(route:WorkspaceRoute)=>void;baseRange?:{from:string;to:string}}){
  const revision=useReferenceQuotes();
  const [style,setStyle]=useChartStyle();
  const [group,setGroup]=useState<"operations"|"receipts"|"costs">("operations"),[cost,setCost]=useState<"ads"|"expenses">("ads"),[detail,setDetail]=useState(false);
  const analysisTop=useRef<HTMLDivElement>(null),returnY=useRef(0);
  const [independent,setIndependent]=useState(false);
  const [preset,setPreset]=useState("7"),[customRange,setRange]=useState({from:shift(today,-6),to:today}),[draft,setDraft]=useState({from:shift(today,-6),to:today});
  const range=independent?customRange:baseRange??{from:shift(today,-6),to:today};
  const [room,setRoom]=useState(""),[source,setSource]=useState<LiveBusinessData|null>(null),[data,setData]=useState<TrendData|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState(""),[dateError,setDateError]=useState(""),[retry,setRetry]=useState(0),[selected,setSelected]=useState(today);
  useEffect(()=>{let active=true;setLoading(true);setError("");setData(null);setSource(null);setSelected(range.to);
    const prev=previousRange(range.from,range.to);
    void api.liveBusiness("custom",{from:prev.from,to:range.to},{room:"",host:"",persona:"",operator:""}).then(async live=>{
      const view=await buildTrend(live,range,room);if(active){setSource(live);setData(view);}
    }).catch(e=>{if(active)setError(toErrorMessage(e,"趋势数据暂不可用"));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[range.from,range.to,room,tick,retry,revision]);
  function pick(value:string){setPreset(value);setDateError("");if(value==="custom")return;const next={from:value==="month"?today.slice(0,8)+"01":shift(today,-(Number(value)-1)),to:today};setRange(next);setDraft(next);}
  function openDetail(){returnY.current=window.scrollY;setDetail(true);requestAnimationFrame(()=>analysisTop.current?.focus());}
  function back(){setDetail(false);requestAnimationFrame(()=>window.scrollTo({top:returnY.current}));}
  const metric:TrendKey=group==="operations"?"turnover":group==="receipts"?"receipts":cost;
  const roomOptions=[...new Map((source?.options||[]).map(o=>[o.room||"__unassigned__",[o.room||"未归属直播间",o.host].filter(Boolean).join(" · ")])).entries()];
  const dates=data?.days||[];
  const metrics=(key:TrendKey)=>{
    const series=data?.series[key],total=data?.totals[key],prev=data?.previous[key];
    return <article className="bt-card" aria-label={`${series?.label||key}趋势`} key={key}><header><h3>{series?.label||({turnover:"开单营业额",receipts:"客户已付款",ads:"广告消耗",expenses:"售后费用"}[key])}</h3><InfoTip label={`${key}趋势统计口径`} text={definitions[key]+" 无记录不代表确认填报为零，未发生记录的日期断开显示。合计为已登记金额，汇率或金额不完整时不显示完整总额。"}/></header><div className="bt-amount"><strong>{loading?"…":currency(total??null)}</strong><small>已登记合计{key==="receipts"||key==="ads"?" · 含参考折算":""}</small></div><div className="bt-baseline"><span>上一等长区间 {currency(prev??null)}</span>{range.to===today?<span>本期未结束</span>:total!=null&&prev!=null?<span>{Number(total)>=Number(prev)?"增加":"减少"} {currency((Math.abs(Number(total)-Number(prev))).toFixed(2))}</span>:<span>比较数据待补</span>}</div>{series&&<TrendPlot series={[series]} style={style} today={today} selected={selected} onSelect={setSelected} label={series.label}/>}</article>;
  };
  const dayEvents=data?.rows.filter(e=>e.date===selected&&["sale","receipt","expense"].includes(e.kind))||[];
  const dayAds=data?.ads.filter(e=>e.date===selected)||[];
  return <section className="boss-trends" aria-label="BOSS经营趋势" aria-busy={loading}>
    <header className="bt-heading"><div><h2>经营趋势</h2><p>{independent?"独立日期":"跟随总览"} · {range.from} 至 {range.to}</p></div><ChartStyleControl style={style} onChange={setStyle}/></header>
    <div className="bt-date-mode" role="group" aria-label="趋势日期模式"><button type="button" aria-pressed={!independent} onClick={()=>setIndependent(false)}>跟随总览</button><button type="button" aria-pressed={independent} onClick={()=>setIndependent(true)}>独立查看历史</button></div>
    <div className="bt-toolbar"><div hidden={!independent} role="group" aria-label="趋势日期范围" className="bt-presets">{[["7","近7天"],["30","近30天"],["month","本月"],["custom","自定义"]].map(([key,label])=><button key={key} aria-pressed={preset===key} onClick={()=>pick(key)}>{label}</button>)}</div><label>趋势直播间<select aria-label="趋势直播间范围" value={room} onChange={e=>setRoom(e.target.value)}><option value="">全公司直播间</option>{roomOptions.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><button className="secondary" disabled={loading} onClick={()=>setRetry(n=>n+1)}>刷新趋势</button></div>
    {independent&&preset==="custom"&&<form className="bt-range" onSubmit={e=>{e.preventDefault();try{daysIn(draft.from,draft.to);if(draft.to>today)throw Error("结束日期不能晚于今日");setRange({...draft});setDateError("");}catch(err){setDateError(toErrorMessage(err));}}}><label>开始<input aria-label="趋势开始日期" type="date" required max={draft.to||today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束<input aria-label="趋势结束日期" type="date" required min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit">查询日期</button><small>最多31天</small></form>}
    {dateError&&<p className="error" role="alert">{dateError}</p>}
    {error&&<p className="error" role="alert">{error}<button className="text-action" onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}
    {loading?<div className="bt-loading" role="status">正在读取趋势与参考汇率…</div>:data&&<>
      <div ref={analysisTop} tabIndex={-1} className="bt-analysis-top"/>
      {!detail?<>
        <nav className="analysis-tabs" aria-label="经营图表分组">{([["operations","经营"],["receipts","收款"],["costs","花费"]] as const).map(([key,label])=><button type="button" key={key} aria-pressed={group===key} onClick={()=>setGroup(key)}>{label}</button>)}</nav>
        {group==='costs'&&<label className="bt-cost-choice">查看花费<select aria-label="花费趋势指标" value={cost} onChange={e=>setCost(e.target.value as typeof cost)}><option value="ads">广告消耗 · 全公司</option><option value="expenses">已登记售后费用</option></select></label>}
        <div className="bt-main-layout"><div>{metrics(metric)}<button type="button" className="text-action bt-drill" onClick={openDetail}>查看 {selected.slice(5)} 明细 →</button></div>
          <section className="bt-card bt-rooms"><header><h3>直播间营业额排名</h3><InfoTip label="直播间排名口径" text="当前趋势日期范围的开单营业额；按开单日期，跑单回冲原日。横条按最大已知金额比较，不表示收款率或利润。点击直播间可聚焦同区间趋势，广告始终为全公司。"/></header>
          <Ranking label="直播间营业额排名" rows={data.rooms.map(s=>({key:s.key,label:s.label,value:sumPoints(s.points)===null?null:Number(sumPoints(s.points)),display:currency(sumPoints(s.points)),note:room===s.key?'当前已选 · 选择全公司可返回全部':'查看该直播间趋势 →'}))} onOpen={setRoom}/>
          {room&&<button type="button" className="text-action" onClick={()=>setRoom('')}>返回全部直播间</button>}</section>
        </div>
      </>:<><button type="button" className="secondary analysis-back" onClick={back}>← 返回趋势与排名</button>
      <section className="bt-card bt-detail"><header><h3>按日查看</h3><label>日期<select aria-label="查看趋势日期明细" value={selected} onChange={e=>setSelected(e.target.value)}>{dates.map(day=><option key={day}>{day}</option>)}</select></label></header><div className="bt-day-values">{(Object.keys(data.series) as TrendKey[]).map(key=>{const s=data.series[key],p=s.points.find(p=>p.date===selected);return <span key={key}>{s.label}<b>{p?.value!=null?currency(p.value):p?.reason||"无记录"}</b><small>{p?.count||0} 条记录{key==="ads"?" · 全公司":""}</small>{p?.native&&<small>{p.native}</small>}</span>;})}</div>
        <details><summary>当日已登记明细 · {dayEvents.length+dayAds.length} 条</summary>{dayEvents.map(e=><div className="bt-record" key={e.kind+e.id}><span>{e.order.order_ref} · {e.order.customer_label||"客户待补"}<small>{e.kind==="sale"?"开单":e.kind==="receipt"?"客户付款":"售后费用"} · {e.label}{e.kind==="sale"&&(e.order.cancelled||e.order.status==="refunded")?" · 已冲抵，不计营业额":""}</small></span><b>{e.amount} {e.currency}</b></div>)}{dayAds.map(e=><div className="bt-record" key={e.id}><span>广告消耗 · {e.account}<small>{e.persona} · 全公司</small></span><b>{e.amount} USD</b></div>)}{!dayEvents.length&&!dayAds.length&&<p>当日无已登记明细。</p>}</details>
        <div className="bt-links">{onOpen&&<><button className="text-action" onClick={()=>onDrill?.({page:"orders",live:{...defaultLiveView(),range:{from:selected,to:selected},view:"income",filters:{...defaultLiveView().filters,room}}})}>当日开单明细 →</button><button className="text-action" onClick={()=>onOpen("finance",{from:selected,to:selected,metric:"receipts",scope:"company"})}>当日收款与到账 · 全公司 →</button><button className="text-action" onClick={()=>onDrill?.({page:"ops",ops:{from:selected,to:selected}})}>当日推广明细 · 全公司 →</button></>}</div>
      </section>
      </>}
      <div className="bt-notes"><span>点击图中日期查看明细 · — 无记录／数据待补 · 今日未结束</span>{data.missingRates&&<span role="status">部分日期缺少参考汇率，图表已断开，金额待补。</span>}{data.stale&&<span role="status">行情更新延迟，沿用最近成功的参考汇率。</span>}<details><summary>图表口径与汇率说明</summary><p>趋势默认跟随总览日期；选择独立查看历史后，使用趋势区自己的日期。直播间选择只影响趋势，不改变顶部全公司数据。图表与明细使用同一批记录，切换图表形式不改变金额。开单、付款和费用发生日期分开统计，不能据此推算收款率或利润。没有记录的日期不自动当零；明确记录为零、或开单全部冲抵时才显示零。</p><p>外币客户付款按付款日、广告按消耗日参考折算；原币保留，折算不代表公司人民币到账。当前示例历史记录较少，空白和断点如实保留。上一等长区间为 {previousRange(range.from,range.to).from} 至 {previousRange(range.from,range.to).to}，按当前有效记录重算；今日未结束时只并列金额，不显示整日增减结论。</p><a href="https://exchangerate.dev" target="_blank" rel="noreferrer">Rates by Exchangerate.dev</a></details></div>
    </>}
  </section>;
}
