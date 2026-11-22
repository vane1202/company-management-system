import SupervisorOrderFollowup from "./SupervisorOrderFollowup";
import { useEffect, useMemo, useState } from "react";
import { api, type CsAccount, type User } from "../api";
import { OrderWorkspace, Field } from "../OrderWorkspace";
import { InfoTip } from "../InfoTip";
import { toErrorMessage } from "../errors";
import { labelOrderStatus } from "../labels";
import { aggregate, amount, channelOf, convert, money, operatorOf, paymentRows, shiftDay, sortTeamNames, teamOf, teamShare, UNKNOWN, type Selection, type Source } from "./supervisorPerformanceData";
import type { CustomerPaymentFx } from "./adExchangeRates";
import "./supervisor-performance.css";
import { useReferenceQuotes } from "./useReferenceQuotes";
import {AnalysisPlot,ChartStyleControl,Ranking,useChartStyle} from "./AnalysisChart";
import type {TrendSeries} from "./bossTrendData";

type FxSet = { paid:CustomerPaymentFx; base:CustomerPaymentFx; after:CustomerPaymentFx; pending:CustomerPaymentFx; people:Record<string,CustomerPaymentFx>; peoplePending:Record<string,CustomerPaymentFx>; days:CustomerPaymentFx[] };
const yuan = (v:string) => `¥${Number(v).toLocaleString("zh-CN", {minimumFractionDigits:2, maximumFractionDigits:2})}`;
const fxValue = (v:CustomerPaymentFx | undefined, loading:boolean) => loading ? "…" : !v || v.cny === null ? "待折算" : `${v.hasForeign ? "约 " : ""}${yuan(v.cny)}`;
const short = (v:bigint) => yuan(money(v));
const basis = "直播间开单按开单日统计料价＋代购费，跑单回冲原日，追加收费另列。客服私推另列，只计料价，不收代购费，不计入直播间开单，也不进入主播提成；主管提成规则尚未启用。客户已付款按付款日统计，含旧单尾款，不代表公司到账。待收款覆盖截至结束日期的历史有效订单，按约定币种抵扣；未分配的收款先列入原开单款／历史未分类，需财务核对。个人贡献按记录中的经办客服姓名统计，不随当前账号持有人变化；同名人员需在真实资料中补充唯一标识。";

export default function SupervisorPerformance({today,user,selectedId,onSelectOrder}:{today:string;user:User;selectedId:string;onSelectOrder:(id:string)=>void}) {
  const revision=useReferenceQuotes();
  const [chartStyle,setChartStyle]=useChartStyle(),[trendMetric,setTrendMetric]=useState<"turnover"|"receipts">("turnover"),[trendDay,setTrendDay]=useState(today);
  const [data,setData] = useState<{sources:Source[];accounts:CsAccount[]} | null>(null);
  const [error,setError] = useState(""), [version,setVersion] = useState(0), [loading,setLoading] = useState(true);
  const [f,setF] = useState<Selection>({from:today,to:today,operator:"",account:"",persona:"",room:"",team:""});
  const [tab,setTab] = useState<"overview"|"people"|"orders">("overview"), [sort,setSort] = useState("turnover"), [search,setSearch] = useState(""), [archiveStatus,setArchiveStatus] = useState("");
  const [fx,setFx] = useState<FxSet|null>(null), [fxLoading,setFxLoading] = useState(false);
  useEffect(()=>{let active=true;setLoading(true);setError("");setData(null);
    void Promise.all([api.orders(),api.csAccounts()]).then(async ([orders,accounts])=>{
      const sources=await Promise.all(orders.orders.map(async identity=>({identity,record:await api.orderRecord(identity.id)})));
      if(active)setData({sources,accounts:accounts.accounts});
    }).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[version]);
  const validRange=!!f.from&&!!f.to&&f.from<=f.to&&f.to<=today;
  const stats=useMemo(()=>data&&validRange?aggregate(data.sources,f,data.accounts):null,[data,f,validRange]);
  const days=useMemo(()=>Array.from({length:7},(_,i)=>shiftDay(f.to||today,i-6)),[f.to,today]);
  useEffect(()=>{let active=true;setFx(null);if(!stats)return;setFxLoading(true);
    const pending=stats.pending.filter(p=>p.balance!==null&&p.currency).map(p=>({date:f.to,amount:p.balance!,currency:p.currency!}));
    void Promise.all([
      convert(paymentRows(stats.scoped,f.from,f.to)),convert(paymentRows(stats.scoped,f.from,f.to,"base")),convert(paymentRows(stats.scoped,f.from,f.to,"after")),convert(pending),
      Promise.all(stats.contributions.map(async p=>[p.name,await convert(paymentRows(p.sources,f.from,f.to))] as const)),
      Promise.all(days.map(day=>convert(paymentRows(stats.scoped,day,day)))), Promise.all(stats.contributions.map(async p=>[p.name,await convert(p.pending.filter(x=>x.balance!==null&&x.currency).map(x=>({date:f.to,amount:x.balance!,currency:x.currency!})))] as const))
    ]).then(([paid,base,after,pending,people,days,peoplePending])=>{if(active)setFx({paid,base,after,pending,people:Object.fromEntries(people),peoplePending:Object.fromEntries(peoplePending),days});})
      .catch(e=>{if(active)setError(toErrorMessage(e,"金额待核对"));}).finally(()=>{if(active)setFxLoading(false);});
    return()=>{active=false;};
  },[stats,days,revision]);
  const options=(get:(s:Source)=>string)=>[...new Set(data?.sources.map(get).filter(Boolean)||[])].sort();
  const teamOptions=useMemo(()=>sortTeamNames([
    ...(data?.accounts.map(a=>a.teamName||"")||[]),
    ...(data?.sources.map(s=>teamOf(s,data?.accounts||[]))||[])
  ]),[data]);
  const change=(key:keyof Selection,value:string)=>setF(current=>({...current,[key]:value}));
  const people=stats?.contributions.slice().sort((a,b)=>{
    if(sort==="paid") {const av=fx?.people[a.name]?.cny,bv=fx?.people[b.name]?.cny;if(av==null)return bv==null?a.name.localeCompare(b.name):1;if(bv==null)return -1;return Number(amount(bv)-amount(av));}
    return Number(b.turnover-a.turnover)||a.name.localeCompare(b.name);
  })||[];
  const archives=stats?.bookings.filter(s=>(!archiveStatus || (archiveStatus === "cancelled" ? !!s.record.order.cancelled : !s.record.order.cancelled && s.identity.status === archiveStatus)) && `${s.identity.orderRef} ${s.record.order.customer_label} ${operatorOf(s)} ${s.identity.wechatId}`.toLowerCase().includes(search.trim().toLowerCase()))||[];
  const peoplePanel = <section className="card sp-people"><div className="sp-section-title"><h2>客服贡献<InfoTip label="本组贡献口径" text="以同一日期、授权小组及当前直播间／人设范围的开单营业额为分母。选择某位客服或某个接待账号不会改变本组分母；个人金额按业务当时登记的经办人归属。"/></h2><label>排序<select aria-label="客服贡献排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="turnover">开单营业额</option><option value="paid">客户已付款</option></select></label></div>
    {stats&&<p className="sp-team-basis">本组同期营业额 {stats.teamUnknownBookings?"待核对":short(stats.teamTurnover)} · 筛选客服不改变本组基准</p>}
    {!people.length&&<p className="empty-state">当前范围暂无客服记录</p>}
    {people.map((p,index)=><article className="sp-person" key={p.name}><div className="sp-person-title"><strong><span>{index+1}</span> {p.name}</strong><button className="text-action" onClick={()=>{change("operator",p.name);setTab("orders");}}>查看订单 →</button></div>
      <dl className="sp-person-values"><div><dt>有效开单</dt><dd>{p.count} 笔</dd></div><div><dt>直播间开单</dt><dd>{p.unknown?"待核对":short(p.liveTurnover)}</dd></div><div><dt>私推</dt><dd>{short(p.privateTurnover)}<small> · {p.privateCount} 笔</small></dd></div><div><dt>客户已付款</dt><dd>{fxValue(fx?.people[p.name],fxLoading)}</dd></div><div><dt>待收款</dt><dd>{p.pending.some(x=>/应收|付款归属|抵扣|关联/.test(x.missing||""))?"待核对":fxValue(fx?.peoplePending[p.name],fxLoading)}<small> · {p.pending.filter(x=>x.balance!==null).length} 项</small></dd></div><div><dt>本组贡献</dt><dd>{stats&&teamShare(p.turnover,stats.teamTurnover,stats.teamUnknownBookings)!==null?`${teamShare(p.turnover,stats.teamTurnover,stats.teamUnknownBookings)!.toFixed(1)}%`:"—"}</dd></div></dl>
      <progress aria-label={`${p.name}的开单贡献`} max={100} value={stats?teamShare(p.turnover,stats.teamTurnover,stats.teamUnknownBookings)??0:0}/>
      <details><summary>接待账号明细 · {p.accounts.length}</summary>{p.accounts.length?p.accounts.map(account=>{const records=p.sources.filter(s=>(s.record.order.wechat_id||s.identity.wechatId||"原账号")===account);const subtotal=aggregate(records,{...f,operator:p.name});return <p key={account}>{account}<small>开单 {subtotal.valid.length} 笔 · {subtotal.unknownBookings?"金额待核对":short(subtotal.turnover)}</small></p>;}):<p>本期无业务记录</p>}</details>
    </article>)}
  </section>;
  const countPending=stats?.pending.filter(p=>p.balance!==null).length||0;
  const pendingIncomplete=stats?.pending.some(p=>p.kind==="资料待补"&&p.missing!=="经办客服"&&p.missing!=="客户姓名"&&p.missing!=="直播间"&&(/应收|付款归属|抵扣|关联/.test(p.missing||"")));
  return <><div className="sp-workspace" hidden={!!selectedId} aria-busy={loading}>
    <header className="sp-heading"><div><p className="eyebrow">小组业绩 · 客服贡献 · 客户跟进</p><h1>本组业绩 <InfoTip label="业绩统计口径" text={basis}/></h1></div><button className="secondary" disabled={loading} onClick={()=>setVersion(n=>n+1)}>刷新</button></header>
    <div className="sp-dates"><div className="sp-presets">{["今日","昨日","本月"].map(label=><button className="secondary" key={label} aria-pressed={label==="今日"?f.from===today&&f.to===today:label==="昨日"?f.from===shiftDay(today,-1)&&f.to===f.from:f.from===today.slice(0,8)+"01"&&f.to===today} onClick={()=>setF({...f,from:label==="本月"?today.slice(0,8)+"01":label==="昨日"?shiftDay(today,-1):today,to:label==="昨日"?shiftDay(today,-1):today})}>{label}</button>)}</div><small className="sp-range-caption">{f.from===f.to?f.to.slice(5):`${f.from.slice(5)} 至 ${f.to.slice(5)}`}</small><details className="sp-custom-dates"><summary>日期筛选</summary><div className="sp-date-fields"><label>开始<input aria-label="业绩开始日期" type="date" max={f.to||today} value={f.from} onChange={e=>change("from",e.target.value)}/></label><label>结束<input aria-label="业绩结束日期" type="date" min={f.from} max={today} value={f.to} onChange={e=>change("to",e.target.value)}/></label></div></details>
      <details className="sp-filters"><summary>筛选{f.team||f.operator||f.account||f.persona||f.room?" · 已设置":""}</summary><div className="grid two">{teamOptions.length>1&&<Field label="所属小组"><select value={f.team||""} onChange={e=>change("team",e.target.value)}><option value="">全部小组</option>{teamOptions.map(t=><option key={t}>{t}</option>)}</select></Field>}<Field label="经办客服"><select value={f.operator} onChange={e=>change("operator",e.target.value)}><option value="">全部客服</option>{[...new Set([...options(operatorOf),...(data?.accounts.map(a=>a.holderName||"").filter(Boolean)||[])])].map(n=><option key={n}>{n}</option>)}</select></Field><Field label="接待账号"><select value={f.account} onChange={e=>change("account",e.target.value)}><option value="">全部本组账号</option>{data?.accounts.map(a=><option key={a.id} value={a.id}>{a.wechatId}</option>)}</select></Field><Field label="人设／主页"><select value={f.persona} onChange={e=>change("persona",e.target.value)}><option value="">全部人设／主页</option>{options(s=>s.identity.personaCode||s.identity.personaName||"").map(v=><option key={v}>{v}</option>)}</select></Field><Field label="直播间"><select value={f.room} onChange={e=>change("room",e.target.value)}><option value="">全部直播间</option>{options(s=>s.identity.liveRoomCode||"").map(v=><option key={v}>{v}</option>)}</select></Field></div><button className="secondary" onClick={()=>setF({...f,team:"",operator:"",account:"",persona:"",room:""})}>清除分类筛选</button></details></div>
    {teamOptions.length>1&&<div className="sp-presets" role="group" aria-label="按小组分类查看" style={{marginBottom:12}}><button type="button" className={!f.team?"":"secondary"} aria-pressed={!f.team} onClick={()=>change("team","")}>全部小组</button>{teamOptions.map(t=><button type="button" key={t} className={f.team===t?"":"secondary"} aria-pressed={f.team===t} onClick={()=>change("team",t)}>{t}</button>)}</div>}
    {!validRange&&<p className="error" role="alert">请选择有效的起止日期，结束日期不能晚于今日。</p>}{error&&<p className="error" role="alert">{error}<button className="text-action" onClick={()=>setVersion(n=>n+1)}>重新读取</button></p>}
    {loading?<section className="card" role="status">正在读取本组订单与收款…</section>:stats&&<>
      <div className="sp-kpis" aria-label="本组业绩汇总"><article><span>直播间开单</span><strong>{stats.unknownLive?"待核对":short(stats.liveTurnover)}</strong><small>料价＋代购费 · 不含私推</small></article><article><span>客户已付款</span><strong>{fxValue(fx?.paid,fxLoading)}</strong><small>付款日 · 含历史订单收款</small></article><article><span>待收款</span><strong>{pendingIncomplete ? "待核对" : fxValue(fx?.pending,fxLoading)}</strong><small>截至 {f.to.slice(5)} · {countPending} 项</small></article><article><span>有效开单数</span><strong>{stats.valid.length}<small> 笔</small></strong><small>{stats.customers} 位客户</small></article></div>
      <p className="sp-private" aria-label="客服私推">客服私推 {stats.privateCount?short(stats.privateTurnover):"¥0.00"} · {stats.privateCount} 笔 · 只计料价，不计入直播间开单。主管提成尚未计算。</p>
      <nav className="sp-tabs" aria-label="消费业绩视图">{([["overview","业绩总览"],["people","客服贡献"],["orders","订单档案"]] as const).map(([value,label])=><button aria-pressed={tab===value} key={value} onClick={()=>setTab(value)}>{label}</button>)}</nav>
      {tab==="overview"&&<><div className="sp-receipts"><span>开单款／历史未分类 <b>{fxValue(fx?.base,fxLoading)}</b></span><span>售后收款 <b>{fxValue(fx?.after,fxLoading)}</b></span><span>跑单冲抵 <b>{short(stats.cancelled)}</b></span></div><SupervisorOrderFollowup pending={stats.pending} today={today} asOf={f.to} onOpen={onSelectOrder} onArchive={()=>setTab("orders")}/>
        <section className="card sp-compact-contribution"><div className="sp-section-title"><h2>客服贡献</h2><button type="button" className="text-action" onClick={()=>setTab('people')}>查看全部 →</button></div><p className="sp-team-basis">本组同期营业额 {stats.teamUnknownBookings?'待核对':short(stats.teamTurnover)}</p><Ranking label="客服贡献前三名" rows={people.slice(0,3).map(p=>({key:p.name,label:p.name,value:p.unknown?null:Number(p.turnover)/100,display:p.unknown?'待核对':short(p.turnover),note:`私推 ${short(p.privateTurnover)} · 本组贡献 ${teamShare(p.turnover,stats.teamTurnover,stats.teamUnknownBookings)===null?'—':teamShare(p.turnover,stats.teamTurnover,stats.teamUnknownBookings)!.toFixed(1)+'%'} · 有效开单 ${p.count} 笔`}))} onOpen={name=>{change('operator',name);setTab('orders');}}/></section>
        <section className="card sp-trend"><div className="analysis-toolbar"><h2>近七日趋势</h2><ChartStyleControl style={chartStyle} onChange={setChartStyle}/></div><nav className="analysis-tabs sp-trend-metrics" aria-label="本组趋势指标">{([['turnover','开单营业额'],['receipts','客户已付款']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={trendMetric===key} onClick={()=>setTrendMetric(key)}>{label}</button>)}</nav><p className="analysis-caption">{days[0]} 至 {f.to} · 人民币{trendMetric==='receipts'?'参考折算':''}</p><AnalysisPlot series={[{key:trendMetric,label:trendMetric==='turnover'?'开单营业额':'客户已付款',points:days.map((date,i)=>{const day=aggregate(stats.scoped,{...f,from:date,to:date}),items=trendMetric==='turnover'?day.bookings.filter(s=>channelOf(s)!=='private').length:paymentRows(stats.scoped,date,date).length;return {date,value:!items?null:trendMetric==='turnover'?day.unknownLive?null:money(day.liveTurnover):fx?.days[i]?.cny??null,reason:!items?'无记录':trendMetric==='turnover'?'金额待核对':'待折算',count:items,native:'',estimated:trendMetric==='receipts'};})} satisfies TrendSeries]} style={chartStyle} today={today} selected={trendDay} onSelect={setTrendDay} label="本组业绩"/></section></>}

      {tab==="people"&&peoplePanel}
      {tab==="orders"&&<section className="card"><div className="sp-section-title"><h2>订单档案 · {archives.length} 笔</h2></div><div className="grid two"><Field label="搜索客户／订单／经办客服"><input type="search" value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field label="订单状态"><select value={archiveStatus} onChange={e=>setArchiveStatus(e.target.value)}><option value="">全部状态</option>{["placed","in_production","shipped","refunded"].map(s=><option value={s} key={s}>{labelOrderStatus(s)}</option>)}<option value="cancelled">已跑单</option></select></Field></div>{!archives.length&&<p className="empty-state">所选开单日期与分类下暂无订单；历史欠款可从「业绩总览」的待跟进列表进入。</p>}{archives.map(s=><button key={s.identity.id} className="sp-followup secondary" onClick={()=>onSelectOrder(s.identity.id)}><span><strong>{s.record.order.customer_label||"客户待补"}</strong><small>{s.identity.orderRef} · {s.identity.businessDate} · {operatorOf(s)}</small><small>{channelOf(s)==="private"?"客服私推 · 不计代购费":s.identity.wechatId} · {s.record.order.cancelled?"已跑单":labelOrderStatus(s.identity.status)}</small></span><b>{yuan(s.identity.amount)}<small>订单合计 · 查看档案 ›</small></b></button>)}</section>}
      <footer className="sp-notes"><details><summary>统计口径与数据说明</summary><p>{basis}</p><p>历史范围按当前有效记录重算，不能还原当时录入进度。未设约定付款日的订单仅标待跟进，不判逾期。姓名相同的经办人暂按同一人汇总；缺失姓名归入「{UNKNOWN}」。</p><p>外币收款按付款日参考汇率；待收款按所选结束日期参考汇率，仅供管理查看。各分项独立四舍五入，可能有分位差异；明细保留原币。</p><p>待补资料 {stats.pending.filter(p=>p.kind==="资料待补").length} 项 · 开单金额待核对 {stats.unknownBookings} 笔</p></details>{(fx?.paid.hasForeign||fx?.pending.hasForeign)&&<small>人民币参考折算{fx?.paid.stale||fx?.pending.stale?" · 行情更新延迟":""} · <a href="https://exchangerate.dev" target="_blank" rel="noreferrer">Rates by Exchangerate.dev</a></small>}</footer>
    </>}
  </div>{selectedId&&<OrderWorkspace today={today} user={user} selectedId={selectedId} onSelectOrder={onSelectOrder}/>}</>;
}
