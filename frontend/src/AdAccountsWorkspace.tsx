import {useEffect,useRef,useState} from 'react';
import {api,type AdAccountsData} from './api';
import {submissionKey} from './commerceUi';
import {toErrorMessage} from './errors';

export function AdAccountsWorkspace({today,readOnly=false}:{today:string;readOnly?:boolean}) {
 const [data,setData]=useState<AdAccountsData|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [account,setAccount]=useState({code:'',name:'',openedOn:today,openingUsd:'0.00'});
 const [topup,setTopup]=useState({accountRef:'',paidOn:today,creditedUsd:'',paidCny:'',paymentAccount:'',reference:'',note:''});
 const [filter,setFilter]=useState(''),[voidId,setVoidId]=useState(''),[reason,setReason]=useState('');const key=useRef(submissionKey());
 async function load(){setData(await api.adAccounts());}
 useEffect(()=>{let live=true;api.adAccounts().then(d=>{if(live)setData(d);}).catch(e=>{if(live)setError(toErrorMessage(e));});return()=>{live=false;};},[]);
 async function action(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');setMessage('');try{await fn();await load();setMessage('广告台账已更新');}catch(e){setError(toErrorMessage(e));}finally{setBusy(false);}}
 return <section className="card ad-accounts"><header className="commerce-line"><h2>广告预存与消耗</h2><button className="secondary" disabled={busy} onClick={()=>void action(load)}>刷新广告台账</button></header>
 {error&&<p className="error" role="alert">{error}</p>}{message&&<p className="ok" role="status">{message}</p>}
 {!data?(error?<div className="overview-error" role="alert"><p>广告台账暂不可用</p><button type="button" className="secondary" disabled={busy} onClick={()=>void action(load)}>{busy?'读取中…':'重新读取'}</button></div>:<p role="status">正在读取广告台账…</p>):<>
 <div className="commerce-kpis"><div><small>充值实付 · CNY</small><strong>{data.summary.paidCny}</strong></div><div><small>关联日报消耗 · USD</small><strong>{data.summary.spentUsd}</strong></div><div><small>台账余额 · USD</small><strong>{data.summary.balanceUsd}</strong></div></div>
 <p className="notice">充值为预存资金，投放消耗按日报统计，两项不重复计为费用。余额＝期初＋充值入账−已关联消耗；未关联的历史日报不在本台账中。实付与入账金额分别填写，不自动换汇。</p>
 {!data.accounts.length&&<p>尚未建立广告账户。</p>}
 {data.accounts.map(a=><article className="commerce-record" key={a.code}><span><strong>{a.name} · {a.code}</strong><small>{a.opened_on} 期初 USD {a.opening_usd}</small><small>入账 USD {a.topped_usd} · 消耗 USD {a.spent_usd}</small></span><span className="commerce-amount">{a.balance_usd}<small>USD {Number(a.balance_usd)<0?'· 请核对缺失充值/消耗':''}</small></span></article>)}
 {!readOnly&&<>
 <details><summary>＋ 建立广告账户</summary><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api.adAction('',account);setAccount({code:'',name:'',openedOn:today,openingUsd:'0.00'});});}}><div className="grid two">{([['code','账户编号','text'],['name','账户名称','text'],['openedOn','期初日期','date'],['openingUsd','期初余额 · USD','text']] as const).map(([k,label,type])=><label className="row" key={k}>{label}<input required type={type} maxLength={k==='code'?64:128} max={type==='date'?today:undefined} value={account[k]} onChange={e=>setAccount({...account,[k]:e.target.value})}/></label>)}</div><p className="notice">期初包含启用日期之前的余额，不含启用日期当天的充值或消耗。保存后不可直接改写。</p><button disabled={busy}>保存账户</button></form></details>
 <details><summary>＋ 登记实际充值</summary><form onSubmit={e=>{e.preventDefault();void action(async()=>{await api.adAction('topups',{...topup,requestKey:key.current(topup)});setTopup({...topup,creditedUsd:'',paidCny:'',reference:'',note:''});});}}><label className="row">广告账户<select required value={topup.accountRef} onChange={e=>setTopup({...topup,accountRef:e.target.value})}><option value="">选择账户</option>{data.accounts.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</select></label><div className="grid two">{([['paidOn','付款日期','date'],['creditedUsd','广告户实际增加 · USD','text'],['paidCny','公司实际支付 · CNY','text'],['paymentAccount','公司付款账户','text'],['reference','充值流水号','text']] as const).map(([k,label,type])=><label className="row" key={k}>{label}<input required type={type} max={type==='date'?today:undefined} maxLength={128} value={topup[k]} onChange={e=>setTopup({...topup,[k]:e.target.value})}/></label>)}</div><label className="row">备注<textarea maxLength={500} value={topup.note} onChange={e=>setTopup({...topup,note:e.target.value})}/></label><button disabled={busy||!data.accounts.length}>保存充值记录</button></form></details>
 </>}
 <label className="row">充值明细 · 广告账户<select value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部账户</option>{data.accounts.map(a=><option key={a.code}>{a.code}</option>)}</select></label>
 {data.topups.filter(t=>!filter||t.account_ref===filter).map(t=><article key={t.id} className={`commerce-record ${t.voided_at?'commerce-void':''}`}><span><strong>{t.account_ref} · 入账 USD {t.credited_usd}</strong><small>{t.paid_on} · 实付 CNY {t.paid_cny}</small><small>{t.payment_account} · {t.reference}</small>{t.note&&<small>{t.note}</small>}{t.voided_at&&<small>已作废：{t.void_reason}</small>}</span>{!readOnly&&!t.voided_at&&<button className="secondary" disabled={busy} onClick={()=>{setVoidId(t.id);setReason('');}}>纠正充值</button>}</article>)}
 {voidId&&!readOnly&&<form onSubmit={e=>{e.preventDefault();void action(async()=>{await api.adAction(`topups/${voidId}/void`,{reason});setVoidId('');});}}><h3>作废充值登记（仅纠错，不执行退款）</h3><label className="row">原因<textarea required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="actions"><button disabled={busy}>确认作废登记</button><button type="button" className="secondary" onClick={()=>setVoidId('')}>取消</button></div></form>}
 </>}
 </section>;
}
