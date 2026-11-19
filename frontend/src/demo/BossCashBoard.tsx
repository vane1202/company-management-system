import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {api,type FinanceData} from '../api';
import {InfoTip} from '../InfoTip';
import {dashboardPresetRange} from '../dates';
import {toErrorMessage} from '../errors';
import {PeriodToolbar,type StandardPreset} from '../PeriodToolbar';
import {buildCashBoard,formatCashValue,formatPendingCash} from './cashBoardData';
import {CustomerPaymentSummary} from './CustomerPaymentSummary';
import {loadCashOrderBalances,useBossCashPending,type CashOrderBalances} from './useBossCashPending';
import type {CashView} from '../cashNavigation';
import './boss-cash-board.css';

const amount=(v:string|null|undefined)=>v==null?'待核对':`¥${formatCashValue(v)}`;
const currencyNames={CNY:'人民币',TWD:'台币',USD:'美元'};

function CashCard({title,tip,value,rows,caption,onOpen}:{title:string;tip:string;value:string;rows:[string,string][];caption:string;onOpen:()=>void}){
  return <article>
    <header><h2>{title}</h2><InfoTip label={`${title}口径`} text={tip}/></header>
    <button type="button" className="cb-main-amount" aria-label={`查看${title}明细，${value}`} onClick={onOpen}>{value}</button>
    <div className="cb-split">{rows.map(([label,detail])=><span key={label}>{label}<b>{detail}</b></span>)}</div>
    <small>{caption}</small>
  </article>;
}
type Props={today:string;context?:CashView;financialDetail:(query?:string,range?:{from:string;to:string})=>ReactNode};

/* Independent demo BOSS view. Money positions are separate from customer debt;
 * full accounting forms and permissions stay in the existing ledger view. */
export default function BossCashBoard({today,financialDetail,context}:Props){
  const [data,setData]=useState<FinanceData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [orderState,setOrderState]=useState<{key:string;operations?:CashOrderBalances}>();
  const [preset,setPreset]=useState<StandardPreset>('day'),[custom,setCustom]=useState<{from:string;to:string}|null>(null);
  const period=custom??dashboardPresetRange(today,preset);
  const [channel,setChannel]=useState(''),[currency,setCurrency]=useState(''),[detailOpen,setDetailOpen]=useState(false),[query,setQuery]=useState('');
  const [detailPeriodOnly,setDetailPeriodOnly]=useState(true);
  const [focused,setFocused]=useState<'arrivals'|'pending'|null>(null);
  const pendingRef=useRef<HTMLElement>(null),arrivalsRef=useRef<HTMLElement>(null),detailRef=useRef<HTMLDetailsElement>(null);
  const ledgerRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!context || context.to>today)return;
    const inherited={from:context.from,to:context.to};
    const matching=(['day','week','month'] as const).find(key=>{const range=dashboardPresetRange(today,key);return range.from===inherited.from&&range.to===inherited.to;});
    setPreset(matching??'day');setCustom(matching?null:inherited);
    setChannel('');setCurrency('');setQuery('');setDetailOpen(false);setDetailPeriodOnly(true);setFocused(null);
  },[context,today]);
  useEffect(()=>{let active=true;setLoading(true);setData(null);setError('');api.finance().then(d=>{if(active)setData(d);}).catch(e=>{if(active)setError(toErrorMessage(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[refresh]);
  const orderKey=`${period.to}:${refresh}`;
  useEffect(()=>{
    let active=true;
    loadCashOrderBalances(period.to).then(operations=>{
      if(active)setOrderState({key:orderKey,operations});
    }).catch(()=>{if(active)setOrderState({key:orderKey});});
    return()=>{active=false;};
  },[orderKey]);
  const operations=orderState?.key===orderKey?orderState.operations:undefined;
  const orderLoading=orderState?.key!==orderKey;
  const board=useMemo(()=>data?buildCashBoard(data,period):null,[data,period.from,period.to]);
  const pendingCash=useBossCashPending(period.to,operations,board?.pending);
  const pendingLoading=loading||orderLoading||pendingCash.loading;
  const unpaid=operations?.orders.filter(order=>order.status==='unpaid'||order.status==='partial')??[];
  const unknownOrders=operations?.orders.filter(order=>order.status==='unknown').length??0;
  const groups=board?.groups.filter(g=>(!channel||g.channel===channel)&&(!currency||g.currency===currency))??[];
  const accountOptions=[...new Set([...(data?.payments.filter(p=>p.third_party&&!p.voided_at).map(p=>p.channel||'账户待补')??[]),...(channel?[channel]:[])])];
  function pickPreset(value:StandardPreset){setPreset(value);setCustom(null);setFocused(null);}
  function showDetails(search='',periodOnly=false){setQuery(search);setDetailPeriodOnly(periodOnly);setDetailOpen(true);detailRef.current?.scrollIntoView({block:'start'});}
  function jump(section:'arrivals'|'pending'){setFocused(section);(section==='pending'?pendingRef:arrivalsRef).current?.scrollIntoView({block:'start'});}
  return <div className="cb-board" aria-label="BOSS收款与到账" aria-busy={loading}>
    <header className="cb-heading"><div><h1>收款与到账</h1></div></header>
    <PeriodToolbar
      today={today}
      preset={preset}
      custom={custom}
      onPreset={pickPreset}
      onCustom={next=>{setCustom(next);setFocused(null);}}
      caption={`${period.from} 至 ${period.to}`}
      actions={<button type="button" className="secondary" disabled={loading} onClick={()=>{setDetailOpen(false);setRefresh(v=>v+1);}}>{loading?'读取中…':'刷新'}</button>}
      ariaLabel="资金日期筛选"
    />
    {error&&<div className="overview-error" role="alert"><strong>资金数据暂不可用</strong><p>{error}</p><button type="button" onClick={()=>setRefresh(v=>v+1)}>重新读取</button></div>}
    <section className="cb-kpis" aria-label="资金位置概览">
      <CashCard title="实收金额（公司已到账）" tip="所选区间登记的人民币直接到账与第三方代收净到账合计。净到账已包含扣费。"
        value={loading?'…':board?amount(board.totalCny):'—'}
        rows={[[ '直接到账',board?amount(board.directCny):'—'],['第三方代收转回',board?amount(board.thirdPartyCny):'—']]}
        caption="所选期间 · 按到账日" onOpen={()=>jump('arrivals')}/>
      <CashCard title="待收金额" tip="截至所选结束日，客户未付尾款和第三方代收未转回余额合计，包含历史款项。外币按截止日参考汇率折算，明细保留原币。"
        value={pendingLoading?'…':formatPendingCash(pendingCash.value?.total)}
        rows={[[ '客户未付尾款',pendingLoading?'…':formatPendingCash(pendingCash.value?.customer)],['第三方代收未转回',pendingLoading?'…':formatPendingCash(pendingCash.value?.held)]]}
        caption={`截至 ${period.to} · 含历史款`} onOpen={()=>jump('pending')}/>
    </section>
    {!!board?.issueCount&&<p className="cb-data-note" role="status">{board.issueCount} 处记录需财务核对，相关金额未推测补齐。</p>}
    <section ref={pendingRef} className={`cb-section ${focused==='pending'?'cb-focused':''}`} aria-label="待收明细">
      <header className="cb-section-heading"><div><h2>待收明细</h2><small>截至 {period.to} · 按原币</small></div></header>
      <h3>客户未付尾款</h3>
      {orderLoading?<p role="status">正在读取订单余额…</p>:!operations?<p className="notice">订单余额暂不可用。</p>:<>
        {!!unknownOrders&&<p className="cb-data-note">{unknownOrders} 笔订单余额待核对。</p>}
        {!unpaid.length&&!unknownOrders&&<p className="notice">截至所选日期，没有已登记的客户未付余额。</p>}
        {unpaid.map(order=><article className="cb-arrival" key={order.id}>
          <div><strong>{order.reference} · {order.customerLabel}</strong><p>{order.bookingDate} · {order.roomCode}</p></div>
          <strong>{order.balance===null||!order.currency?'待核对':order.currency==='CNY'?amount(order.balance):`${formatCashValue(order.balance)} ${order.currency}`}</strong>
        </article>)}
      </>}
      <div className="cb-held-heading"><h3>第三方代收未转回</h3><InfoTip label="代收天数说明" text="代收天数从尚未转回款项的最早客户付款日算至所选结束日。只有登记约定转款期限后，才能判断是否逾期。"/></div>
      <div className="cb-filters"><label>代收账户<select aria-label="代收账户筛选" value={channel} onChange={e=>setChannel(e.target.value)}><option value="">全部账户</option>{accountOptions.map(c=><option key={c}>{c}</option>)}</select></label><label>币种<select aria-label="代收币种筛选" value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">全部币种</option>{Object.entries(currencyNames).map(([key,label])=><option key={key} value={key}>{label} · {key}</option>)}</select></label>{(channel||currency)&&<button type="button" className="text-action" onClick={()=>{setChannel('');setCurrency('');}}>清除筛选</button>}</div>
      {loading?<p role="status">正在读取代收记录…</p>:!board?<p className="notice">代收数据暂不可用。</p>:!groups.length?<p className="notice">{board.groups.length?'当前筛选没有待转回款项。':board.pendingIncomplete?'有记录待核对，暂不能确认完整代收余额。':'截至所选日期，没有已登记的待转回款项。'}</p>:<div className="cb-agencies">{groups.map(g=><article className="cb-agency" key={g.key}><header><h3>{g.channel}</h3><span>{currencyNames[g.currency]}</span></header><div className="cb-held-value"><small>待转回</small><strong>{g.pending??'待核对'} <small>{g.currency}</small></strong></div><div className="cb-agency-facts"><span>涉及收款 <b>{g.count} 笔</b></span><span>最早代收 <b>{g.oldestDate}</b></span><span>已代收 <b>{g.heldDays} 天</b></span><span>最近转回 <b>{g.lastTransferDate??'尚无记录'}</b></span></div><details><summary>查看相关客户与订单（{g.count}）</summary>{g.payments.map(p=><article className="cb-related-payment" key={p.id}><div><strong>{p.customer_label} · {p.order_ref}</strong><p>{p.payment_date} · {p.live_room_code||'直播间待补'} · 客服 {p.operator_name||'待补'}</p><p>{p.wechat_id||'接待账号待补'}</p></div><div><b>待转回 {p.pendingAsOf??'待核对'} {p.currency}</b><small>客户已付 {p.amount} {p.currency}</small><button type="button" className="text-action" onClick={()=>showDetails(p.reference||p.order_ref)}>查看原收款记录 →</button></div></article>)}</details></article>)}</div>}
    </section>
    <section ref={arrivalsRef} className={`cb-section cb-arrivals ${focused==='arrivals'?'cb-focused':''}`} aria-label="本期公司到账">
      <header className="cb-section-heading"><div><h2>公司到账明细</h2><small>{period.from} 至 {period.to}</small></div><strong>{board?amount(board.totalCny):'—'}</strong></header>
      {!board?<p className="notice">{loading?'正在读取到账记录…':'到账数据暂不可用。'}</p>:!board.arrivals.length?<p className="notice">所选区间暂无已登记的人民币到账。</p>:board.arrivals.map(a=><article className="cb-arrival" key={a.id}><div><strong>{a.channel||'账户待补'}</strong><p>{a.date} · {a.kind==='direct'?'客户直接付款':'代收转回'}</p><details><summary>查看关联订单（{a.payments.length}）</summary>{a.payments.length?a.payments.map(p=><p key={p.id}>{p.order_ref} · {p.customer_label} · {p.live_room_code||'直播间待补'}</p>):<p>关联订单待财务核对。</p>}<button type="button" className="text-action" onClick={()=>showDetails(a.kind==='direct'?a.reference:a.payments[0]?.order_ref??'')}>查看财务原记录 →</button></details></div><strong>{amount(a.amountCny)}</strong></article>)}
    </section>
    <details ref={detailRef} className="cb-section cb-financial" open={detailOpen} onToggle={e=>setDetailOpen(e.currentTarget.open)}>
      <summary>客户付款明细</summary>
      {detailOpen&&<>
        <div className="cb-customer-summary">
          <CustomerPaymentSummary loading={loading} records={data?.payments.filter(p=>!p.voided_at&&p.payment_date>=period.from&&p.payment_date<=period.to).map(p=>({date:p.payment_date,amount:p.amount,currency:p.currency}))??[]} totals={board?.receipts} onOpen={()=>{setQuery('');setDetailPeriodOnly(true);ledgerRef.current?.scrollIntoView({block:'start'});}} detailLabel="查看付款流水 →"/>
        </div>
        <div ref={ledgerRef} className="cb-payment-ledger">
          <div key={`${refresh}:${query}:${detailPeriodOnly?period.from+period.to:''}`}><p className="cb-detail-note">以下累计汇总为全部已登记流水。{detailPeriodOnly?'客户收款列表按上方区间筛选。':'客户收款列表可独立筛选。'}{query?`收款筛选：${query}。`:''}结算、费用等完整记录保留各自查询口径。</p>{financialDetail(query,detailPeriodOnly?period:undefined)}</div>
        </div>
      </>}
    </details>
  </div>;
}
