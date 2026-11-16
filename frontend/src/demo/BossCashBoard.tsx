import {useEffect,useRef,useState,type ReactNode} from 'react';
import {api,type FinanceData} from '../api';
import {InfoTip} from '../InfoTip';
import {dashboardPresetRange,isIsoDate} from '../dates';
import {toErrorMessage} from '../errors';
import {buildCashBoard,formatCashValue,type CashAmounts} from './cashBoardData';
import {CustomerPaymentSummary} from './CustomerPaymentSummary';
import type {CashView} from '../cashNavigation';
import './boss-cash-board.css';

const amount=(v:string|null|undefined)=>v==null?'待核对':`¥${formatCashValue(v)}`;
const currencyNames={CNY:'人民币',TWD:'台币',USD:'美元'};
function Amounts({values,empty}:{values?:CashAmounts;empty:string}){
  const entries=Object.entries(values??{}).filter(([,v])=>v===null||v!=='0.00');
  if(!values)return <strong>—</strong>;
  return entries.length?<div className="cb-currency-list">{entries.map(([cur,v])=><strong key={cur}>{v===null?'待核对':formatCashValue(v)}<small>{currencyNames[cur as keyof typeof currencyNames]} · {cur}</small></strong>)}</div>:<strong className="cb-empty-number">{empty}</strong>;
}
type Props={today:string;context?:CashView;financialDetail:(query?:string,range?:{from:string;to:string})=>ReactNode};

/* Independent demo BOSS view. Money positions are separate from customer debt;
 * full accounting forms and permissions stay in the existing ledger view. */
export default function BossCashBoard({today,financialDetail,context}:Props){
  const [data,setData]=useState<FinanceData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [preset,setPreset]=useState('day'),[custom,setCustom]=useState<{from:string;to:string}|null>(null);
  const period=custom??dashboardPresetRange(today,preset);
  const [draft,setDraft]=useState(()=>dashboardPresetRange(today,'day')),[dateError,setDateError]=useState('');
  const [channel,setChannel]=useState(''),[currency,setCurrency]=useState(''),[detailOpen,setDetailOpen]=useState(false),[query,setQuery]=useState('');
  const [detailPeriodOnly,setDetailPeriodOnly]=useState(false);
  const [focused,setFocused]=useState<'arrivals'|'held'|'payments'|null>(null);
  const heldRef=useRef<HTMLElement>(null),arrivalsRef=useRef<HTMLElement>(null),detailRef=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{
    if(!context || context.to>today)return;
    const inherited={from:context.from,to:context.to};
    const matching=['day','week','month'].find(key=>{const range=dashboardPresetRange(today,key);return range.from===inherited.from&&range.to===inherited.to;});
    setPreset(matching??'day');setCustom(matching?null:inherited);setDraft(inherited);setDateError('');
    setChannel('');setCurrency('');setQuery('');setDetailOpen(false);setDetailPeriodOnly(true);setFocused('payments');
  },[context,today]);
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');api.finance().then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[refresh]);
  const board=data?buildCashBoard(data,period):null;
  const groups=board?.groups.filter(g=>(!channel||g.channel===channel)&&(!currency||g.currency===currency))??[];
  const accountOptions=[...new Set([...(data?.payments.filter(p=>p.third_party&&!p.voided_at).map(p=>p.channel||'账户待补')??[]),...(channel?[channel]:[])])];
  function pickPreset(value:string){setPreset(value);setCustom(null);setDateError('');setDraft(dashboardPresetRange(today,value));setFocused(null);}
  function showDetails(search='',periodOnly=false){setQuery(search);setDetailPeriodOnly(periodOnly);setDetailOpen(true);detailRef.current?.scrollIntoView({block:'start'});}
  function jump(section:'arrivals'|'held'){setFocused(section);(section==='held'?heldRef:arrivalsRef).current?.scrollIntoView({block:'start'});}
  return <div className="cb-board" aria-label="BOSS收款与到账" aria-busy={loading}>
    <header className="cb-heading"><div><h1>收款与到账</h1><p>{period.from} 至 {period.to}</p></div><button type="button" className="secondary" disabled={loading} onClick={()=>{setDetailOpen(false);setRefresh(v=>v+1);}}> {loading?'读取中…':'刷新'}</button></header>
    <section className="cb-toolbar" aria-label="资金日期筛选"><div className="overview-segments">{[['day','今日'],['week','本周'],['month','本月']].map(([key,label])=><button key={key} type="button" className={!custom&&preset===key?'selected':''} aria-pressed={!custom&&preset===key} onClick={()=>pickPreset(key)}>{label}</button>)}</div><details><summary>自定义日期{custom?' · 已设置':''}</summary><form onSubmit={e=>{e.preventDefault();if(!isIsoDate(draft.from)||!isIsoDate(draft.to)||draft.from>draft.to||draft.to>today){setDateError('请选择有效日期，结束日期不能晚于今天');return;}setCustom({...draft});setDateError('');setFocused(null);}}><label>开始日期<input type="date" required max={today} value={draft.from} onChange={e=>setDraft({...draft,from:e.target.value})}/></label><label>结束日期<input type="date" required min={draft.from} max={today} value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><button type="submit" className="secondary">查询</button></form></details></section>
    {context&&<p className="cb-detail-note">客户付款 · 全公司 · 按付款日 · {period.from} 至 {period.to}</p>}
    {dateError&&<p role="alert" className="error">{dateError}</p>}
    {error&&<div className="overview-error" role="alert"><strong>资金数据暂不可用</strong><p>{error}</p><button type="button" onClick={()=>setRefresh(v=>v+1)}>重新读取</button></div>}
    <section className="cb-kpis" aria-label="资金位置概览">
      <article><header><h2>公司已到账</h2><InfoTip label="公司已到账口径" text="所选区间登记的人民币直接收款＋第三方实际人民币净到账；直接收款按付款日，代收转回按公司到账日。净到账已反映扣费，不再重复扣费。这是已登记流入，不是银行账户余额，不含退款流出或利润。"/></header><button type="button" className="cb-main-amount" disabled={!board} onClick={()=>jump('arrivals')}>{loading?'…':board?amount(board.totalCny):'—'}</button><div className="cb-split"><span>直接收款 <b>{board?amount(board.directCny):'—'}</b></span><span>代收转回 <b>{board?amount(board.thirdPartyCny):'—'}</b></span></div><small>所选期间 · 人民币</small></article>
      <article><header><h2>代收未转回</h2><InfoTip label="代收未转回口径" text="已登记客户付款中，截至所选结束日尚未由代收方转回的原币余额，包含开始日期之前的历史付款。按实际结算分配重算，不沿用当前快照；台币与美元不相加、不估算人民币。不代表客户欠款，最终人民币到账由财务实际登记。"/></header><button type="button" className="cb-money-list" disabled={!board} onClick={()=>jump('held')}>{loading?'…':<Amounts values={board?.pending} empty="无待转回款"/>}</button><span className="cb-kpi-context">{board?(board.pendingIncomplete?'含待核对记录':`${board.groups.length} 个账户／币种 · ${board.heldCount} 笔收款`):'—'}</span><small>截至 {period.to} · 包含历史款</small></article>
      <article aria-label="客户已付款"><CustomerPaymentSummary loading={loading} records={data?.payments.filter(p=>!p.voided_at&&p.payment_date>=period.from&&p.payment_date<=period.to).map(p=>({date:p.payment_date,amount:p.amount,currency:p.currency}))??[]} totals={board?.receipts} onOpen={()=>{setFocused('payments');showDetails('',true);}} detailLabel="查看付款明细 →"/><span className="cb-kpi-context">{board?(board.receiptsIncomplete?'含待核对记录':`${board.paymentCount} 笔有效付款`):'—'}</span></article>
    </section>
    {!!board?.issueCount&&<p className="cb-data-note" role="status">{board.issueCount} 处记录需财务核对，相关金额未推测补齐。</p>}
    <section ref={heldRef} className={`cb-section ${focused==='held'?'cb-focused':''}`} aria-label="代收跟进">
      <header className="cb-section-heading"><div><h2>代收跟进</h2><small>截至 {period.to}</small></div><InfoTip label="代收天数说明" text="从尚未转回款项的最早客户付款日算至所选结束日，只表示代收天数。未登记约定转款期限，不判定逾期。这里只看客户已经支付的钱，客户未付款请到直播间经营的订单跟进查看。"/></header>
      <div className="cb-filters"><label>代收账户<select aria-label="代收账户筛选" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">全部账户</option>{accountOptions.map(c=><option key={c}>{c}</option>)}</select></label><label>币种<select aria-label="代收币种筛选" value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">全部币种</option>{Object.entries(currencyNames).map(([key,label])=><option key={key} value={key}>{label} · {key}</option>)}</select></label>{(channel||currency)&&<button type="button" className="text-action" onClick={()=>{setChannel('');setCurrency('');}}>清除筛选</button>}</div>
      {loading?<p role="status">正在读取代收记录…</p>:!board?<p className="notice">代收数据暂不可用。</p>:!groups.length?<p className="notice">{board.groups.length?'当前筛选没有待转回款项。':board.pendingIncomplete?'有记录待核对，暂不能确认完整代收余额。':'截至所选日期，没有已登记的待转回款项。'}</p>:<div className="cb-agencies">{groups.map(g=><article className="cb-agency" key={g.key}><header><h3>{g.channel}</h3><span>{currencyNames[g.currency]}</span></header><div className="cb-held-value"><small>待转回</small><strong>{g.pending??'待核对'} <small>{g.currency}</small></strong></div><div className="cb-agency-facts"><span>涉及收款 <b>{g.count} 笔</b></span><span>最早代收 <b>{g.oldestDate}</b></span><span>已代收 <b>{g.heldDays} 天</b></span><span>最近转回 <b>{g.lastTransferDate??'尚无记录'}</b></span></div><details><summary>查看相关客户与订单（{g.count}）</summary>{g.payments.map(p=><article className="cb-related-payment" key={p.id}><div><strong>{p.customer_label} · {p.order_ref}</strong><p>{p.payment_date} · {p.live_room_code||'直播间待补'} · 客服 {p.operator_name||'待补'}</p><p>{p.wechat_id||'接待账号待补'}</p></div><div><b>待转回 {p.pendingAsOf??'待核对'} {p.currency}</b><small>客户已付 {p.amount} {p.currency}</small><button type="button" className="text-action" onClick={()=>showDetails(p.reference||p.order_ref)}>查看原收款记录 →</button></div></article>)}</details></article>)}</div>}
    </section>
    <section ref={arrivalsRef} className={`cb-section cb-arrivals ${focused==='arrivals'?'cb-focused':''}`} aria-label="本期公司到账">
      <header className="cb-section-heading"><div><h2>本期公司到账</h2><small>{period.from} 至 {period.to}</small></div><strong>{board?amount(board.totalCny):'—'}</strong></header>
      {!board?<p className="notice">{loading?'正在读取到账记录…':'到账数据暂不可用。'}</p>:!board.arrivals.length?<p className="notice">所选区间暂无已登记的人民币到账。</p>:board.arrivals.map(a=><article className="cb-arrival" key={a.id}><div><strong>{a.channel||'账户待补'}</strong><p>{a.date} · {a.kind==='direct'?'客户直接付款':'代收转回'}</p><details><summary>查看关联订单（{a.payments.length}）</summary>{a.payments.length?a.payments.map(p=><p key={p.id}>{p.order_ref} · {p.customer_label} · {p.live_room_code||'直播间待补'}</p>):<p>关联订单待财务核对。</p>}<button type="button" className="text-action" onClick={()=>showDetails(a.kind==='direct'?a.reference:a.payments[0]?.order_ref??'')}>查看财务原记录 →</button></details></div><strong>{amount(a.amountCny)}</strong></article>)}
    </section>
    <details ref={detailRef} className="cb-section cb-financial" open={detailOpen} onToggle={e=>setDetailOpen(e.currentTarget.open)}><summary>财务明细 · 完整流水与结算记录</summary>{detailOpen&&<div key={`${refresh}:${query}:${detailPeriodOnly?period.from+period.to:''}`}><p className="cb-detail-note">以下累计汇总为全部已登记流水。{detailPeriodOnly?'客户收款列表按上方区间筛选；':'客户收款列表可独立筛选；'}{query?`收款筛选：${query}。`:''}结算、费用等完整记录保留各自查询口径。</p>{financialDetail(query,detailPeriodOnly?period:undefined)}</div>}</details>
  </div>;
}
