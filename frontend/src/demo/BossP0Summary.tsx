import { useEffect, useRef, useState } from 'react';
import { InfoTip } from '../InfoTip';
import { defaultLiveView, type LiveView } from '../liveBusinessNavigation';
import './boss-p0.css';

type Comparison = { label:string; from:string; to:string; baseValue:string|null; baseStatus:string; absolute:string|null; percent:string|null; status:string };
type Metric = { value:string|null; unit:string; status:string; nativeTotals:Record<string,string>; definition:string; source:string; comparisons:Comparison[] };
type Ledger = { id:string; kind:string; bucket:string; date:string; label:string; amount:string; currency:string; cny:string|null; rate:string|null; rateDate:string|null; reason:string };
type Data = {
  version:string; demo:boolean; scope:string;
  period:{from:string;to:string;asOf:string;cutoff:string};
  metrics:Record<string,Metric>;
  finalContribution:{value:string|null;status:string;missingDays:string[];deductions:Record<string,string|null>};
  ledger:Ledger[];
  fx:{missing:string[];ratesUsed:{currency:string;cnyPerUnit:string;effectiveFrom:string}[]};
  sources:{name:string;updatedAt:string|null}[];
  paidPerformance:{date:string;amount:string;label:string}[];
  target:{month:string;amountCny:string}|null;
};
type Props = {preset:string;range?:{from:string;to:string};tick:number;onOpenBusiness:(view:LiveView)=>void};
const names:Record<string,string>={turnover:'开单营业额',receipts:'客户已收款',visibleCost:'可见成本',estimatedContribution:'预估净贡献',roi:'收款／广告消耗'};
const format=(value:string|null|undefined)=>value==null?'—':Number(value).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const rateFormat=(value:string)=>Number(value).toLocaleString('zh-CN',{maximumFractionDigits:6});
const signed=(value:string)=>`${Number(value)>0?'+':''}${format(value)}`;
const messages:Record<string,string>={missing_rate:'缺参考汇率',incomplete:'数据待补齐',unclassified_cost:'费用分类待确认',no_spend:'无广告消耗'};
function Compare({metric}:{metric:Metric}){
  return <div className="p0-comparisons">{metric.comparisons.map(c=><span key={c.label} title={`${c.from} 至 ${c.to}；基期 ${c.baseValue??(messages[c.baseStatus]??'数据待补')}；按同一已过去时段比较`}><span>{c.label}</span><b>{c.status==='unavailable'?(c.baseStatus==='no_spend'?'基期无消耗':'待补数据'):c.percent!=null&&Number(c.baseValue)>0&&Number(metric.value)>=0?`${Number(c.percent)>0?'+':''}${c.percent}%`:c.absolute!=null?`${signed(c.absolute)}${metric.unit==='倍'?'倍':'元'}`:'—'}</b></span>)}</div>;
}

/* Demo-only screen. The project's jade theme is retained. The one explanatory
 * line under contribution is intentional: the user requires excluded costs to
 * stay visible, rather than leaving the caveat in a tooltip. No production API. */
export default function BossP0Summary({preset,range,tick,onOpenBusiness}:Props){
  const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
  const [detail,setDetail]=useState<string|null>(null),dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setData(null);setError('');setDetail(null);
    const q=new URLSearchParams({preset,...range});
    fetch('/api/demo/boss-overview?'+q,{signal:controller.signal,cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('演示指标暂不可用');const d=await r.json() as Data;if(d.version!=='boss-overview-p0/v1'||d.demo!==true)throw Error('演示指标契约不匹配');if(!controller.signal.aborted)setData(d);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'演示指标暂不可用');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[preset,range?.from,range?.to,tick,retry]);
  useEffect(()=>{if(detail&&!dialog.current?.open)dialog.current?.showModal();if(!detail&&dialog.current?.open)dialog.current.close();},[detail]);
  const openBusiness=()=>onOpenBusiness({...defaultLiveView(),preset:preset as LiveView['preset'],range,view:'rooms'});
  const fxText=data?.fx.ratesUsed.map(r=>`1 ${r.currency} = ${rateFormat(r.cnyPerUnit)} CNY（生效 ${r.effectiveFrom}）`).join('；')??'';
  function card(key:string){
    const m=data?.metrics[key];
    return <article className={`p0-kpi p0-${key}`} key={key} aria-label={names[key]}>
      <header><h2>{names[key]}</h2><InfoTip label={`${names[key]}口径`} text={`${m?.definition??'正在读取定义'} 来源：${m?.source??'演示指标服务'}。${key==='roi'?'单位为倍。':'单位 CNY。'}${fxText}；参考折算，不代表实际结汇到账。`}/></header>
      <button className="p0-number" type="button" disabled={!data} aria-label={`查看${names[key]}构成`} onClick={()=>setDetail(key)}><strong>{loading?'…':format(m?.value)}</strong><small>{key==='roi'?'倍':'CNY'}</small></button>
      {m&&Object.keys(m.nativeTotals).length>0&&<div className="p0-native" aria-label={`${names[key]}原币`}>{Object.entries(m.nativeTotals).map(([currency,amount])=><span key={currency}>{currency} {format(amount)}</span>)}</div>}
      {m?.status!=='ready'&&m&&<span className="p0-state">{messages[m.status]??'数据待补'}</span>}
      {m&&<Compare metric={m}/>}
      {key==='turnover'&&data?.target&&<span className="p0-target">月目标 {format(data.target.amountCny)} CNY</span>}
    </article>;
  }
  const m=data?.metrics.estimatedContribution,final=data?.finalContribution;
  const filters:Record<string,string[]>={turnover:['booking','excludedBooking'],receipts:['payment'],visibleCost:['cost','ad','excludedCost','unclassifiedCost'],estimatedContribution:['payment','cost','ad'],roi:['payment','ad']};
  const lines=data?.ledger.filter(r=>(filters[detail??'']??[]).includes(r.bucket))??[];
  return <section className="p0-summary" aria-label="经营首屏结论" aria-busy={loading}>
    {error?<div className="overview-error" role="alert"><strong>{error}</strong><button type="button" onClick={()=>setRetry(n=>n+1)}>重试指标</button></div>:<>
      <div className="p0-scope"><span>全公司 · 参考折算</span><span>{data?data.fx.ratesUsed.filter(r=>r.currency!=='CNY').map(r=>`1 ${r.currency}=${rateFormat(r.cnyPerUnit)} CNY`).join(' · ')||'本币 CNY':'读取参考汇率…'}</span></div>
      <div className="p0-kpis">{['turnover','receipts','visibleCost','roi'].map(card)}
        <article className={`p0-kpi p0-contribution ${m?.value!=null&&Number(m.value)<0?'p0-negative':''}`} aria-label="预估与最终净贡献">
          <div className="p0-contribution-top"><div><header><h2>预估净贡献</h2><InfoTip label="预估净贡献口径" text={`${m?.definition??'客户已收款参考折算－可见成本'} 来源：${m?.source??'演示指标服务'}。${fxText}`}/></header><button className="p0-number" type="button" disabled={!data} aria-label="查看预估净贡献构成" onClick={()=>setDetail('estimatedContribution')}><strong>{loading?'…':format(m?.value)}</strong><small>CNY</small></button></div><span className="p0-signal">{m?.value==null?(m?messages[m.status]??'待补数据':'读取中'):Number(m.value)<0?'预估为负':Number(m.value)>0?'预估为正':'预估持平'}</span></div>
          <p className="p0-exclusions">未扣料成本、提成、代收手续费</p>
          {m&&<Compare metric={m}/>}
          <div className="p0-final"><span>最终净贡献 <InfoTip label="最终净贡献口径" text="预估净贡献－财务专项录入的料成本、提成、代收手续费。每个统计日的三项均须由财务明确录入，0为有效录入；缺项或缺日显示待财务核算，不从费用账猜测、不以预估值代替。财务真实录入格式仍待复核，本页只有虚构只读结果。"/></span><strong>{loading?'读取中':final?.status==='pending_finance'?'待财务核算':final?.value!=null?`${format(final.value)} CNY`:messages[final?.status??'']??'数据待补'}</strong></div>
        </article>
      </div>
      {data?.fx.missing.length? <p className="p0-warning" role="status">参考汇率缺失：{data.fx.missing.join('；')}</p>:null}
      <details className="p0-reference"><summary>参考汇率与数据更新 <span>ⓘ</span></summary><div>{data?.fx.ratesUsed.map(r=><p key={r.currency+r.effectiveFrom}>1 {r.currency} = {rateFormat(r.cnyPerUnit)} CNY <small>生效 {r.effectiveFrom}</small></p>)}<p className="p0-reference-note">虚构参考配置；不代表第三方实际结汇。同期对比截至 {data?.period.cutoff??'—'}，按当前已知记录重算。</p>{data?.sources.map(s=><p className="p0-source" key={s.name}><span>{s.name}</span><time>{s.updatedAt?new Date(s.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'待接入'}</time></p>)}</div></details>
      <div className="p0-followup"><div><span>财务核定已付款业绩 <InfoTip label="财务核定业绩口径" text="财务按开单日、直播间和主播专项核定的业绩，不等于客户已收款，系统不计算主播提成，不参与预估净贡献计算。"/></span><strong>{data?.paidPerformance.length?format((data.paidPerformance.reduce((n,r)=>n+Math.round(Number(r.amount)*100),0)/100).toFixed(2)):'—'} <small>CNY</small></strong></div><button className="text-action" type="button" onClick={openBusiness}>直播间经营明细 →</button></div>
    </>}
    <dialog ref={dialog} className="p0-dialog" aria-labelledby="p0-detail-heading" onClose={()=>setDetail(null)}>
      <header><h2 id="p0-detail-heading">{names[detail??'']} · 构成</h2><button type="button" className="secondary" onClick={()=>{dialog.current?.close();setDetail(null);}}>返回总览</button></header>
      <p>{data?.period.from} 至 {data?.period.to} · 全公司</p>
      <p className="p0-detail-definition">{data?.metrics[detail??'']?.definition}</p>
      {lines.map(r=><article className="p0-ledger-row" key={r.kind+r.id}><div><b>{r.label}</b><small>{r.date}{r.reason?' · '+r.reason:''}</small><small>{r.rate?`1 ${r.currency} = ${rateFormat(r.rate)} CNY · 生效 ${r.rateDate}`:'参考汇率待补'}</small></div><div><strong>{format(r.amount)} {r.currency}</strong><small>{r.bucket.startsWith('excluded')?'排除，不计入':r.bucket==='unclassifiedCost'?'待分类':r.cny!==null?`${format(r.cny)} CNY`:'无法折算'}</small></div></article>)}
      {!lines.length&&<p>该区间没有已登记明细。</p>}
      {detail==='visibleCost'&&<p className="p0-reference-note">排除项原值保留；财务三项扣除另行核算，未从这些费用行自动补值。</p>}
      {detail==='estimatedContribution'&&<div className="p0-deductions"><p>财务专项扣除（CNY）</p>{[['materialCost','料成本'],['commission','提成'],['collectionFee','代收手续费']].map(([key,label])=><p key={key}>{label}<b>{final?.deductions[key]==null?'待财务核算':format(final.deductions[key])}</b></p>)}</div>}
    </dialog>
  </section>;
}
