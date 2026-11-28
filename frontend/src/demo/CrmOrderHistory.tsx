import {useState,type ReactNode} from 'react';
import {CreateOrder,Field} from '../OrderWorkspace';
import {PaymentProofField} from '../PaymentProofField';
import {toErrorMessage} from '../errors';
import {centsToYuan,orderFunds,type CrmAction,type CrmActor,type CrmOrder,type CrmState} from './customerCrm';
import {yuan} from '../dashboardDisplay';
import {OrderStatusTags} from '../OrderStatusTagView';
import {classifyOrderStatus,factsFromCrm} from '../orderStatusTags';
import './crm-order-history.css';

export default function CrmOrderHistory({state,customerId,today,actor,dispatch,room,onMessage,onAfterSales}:{state:CrmState;customerId:string;today:string;actor?:CrmActor;dispatch?:(action:CrmAction)=>void;room?:{name:string;host:string};onMessage?:(text:string)=>void;onAfterSales?:(order:CrmOrder)=>ReactNode}) {
  const [transferId,setTransferId]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  const [proofZoom,setProofZoom]=useState('');
  const [resubmit,setResubmit]=useState<{orderId:string;receiptId:string;date:string;amount:string;channel:string;reference:string;remoteUrl:string}|null>(null);
  const [resubmitFile,setResubmitFile]=useState<File|null>(null);
  const orders=state.orders.filter(order=>order.customerId===customerId);
  const transferring=orders.find(order=>order.id===transferId);
  return <div className="crm-order-history">
    {!orders.length&&<p className="notice">还没有开单。售后费用不增加订单笔数。</p>}
    {orders.map(order=>{const funds=orderFunds(order);const facts=factsFromCrm(order);const view=classifyOrderStatus(facts);const shown=order.materialCents+(order.channel==='private'?0:order.feeCents);return <details className="crm-order-row" key={order.id}>
      <summary>
        <span className="order-card-main">
          <span className="order-card-title"><strong>{state.customers.find(item => item.id === customerId)?.name || "客户"}</strong><OrderStatusTags facts={facts} /></span>
          <small>{order.businessDate} · {order.channel === "private" ? "私推" : "直播间"} · {order.employeeName}{order.materialRef ? " · 料号 " + order.materialRef : ""}{order.replacedById ? " · 换料" : ""}</small>
          {view.followup && <small className="order-followup">{view.followup}</small>}
        </span>
        <span className="crm-order-amount"><b className={view.voided ? "is-void" : ""}>{yuan(centsToYuan(shown))}</b></span>
      </summary>
      <div className="crm-order-body">
        <p>原开单价 ¥{centsToYuan(order.materialCents)} · 代购费 ¥{centsToYuan(order.feeCents)}</p>
        {order.sourcingNoSettle&&<p className="notice">此单已标「接待（PH）」，原石未售出、不结供应商料款；实际接待费用在售后费用中按「市场配货采购款」登记。</p>}
        {actor&&dispatch&&!order.cancelled&&!order.replacedById&&<p><button type="button" className="secondary" onClick={()=>{dispatch({type:'toggleSourcingNoSettle',actor,orderId:order.id});onMessage?.(order.sourcingNoSettle?'已取消该订单的「接待（PH）」标记（演练）。':'已将该订单标为「接待（PH）」，原石不结供应商料款（演练）。');}}>{order.sourcingNoSettle?'取消接待（PH）':'标为接待（PH）'}</button></p>}
        {!!order.items?.length&&<ul>{order.items.map((item,i)=><li key={i}>{item.kind==='material'?'翡翠原石':'翡翠成品'} · {item.materialRef||'未填料号'} · ¥{item.priceCny} + 代购费 ¥{item.buyingFeeCny}</li>)}</ul>}
        {order.replacedById?<p className="notice">换料取消 · 有效成交金额 ¥0.00。原定金已转入 {order.replacedById}，不再催收本单尾款。<br/>{order.transferredOn} · {order.transferredBy} · {order.transferReason}</p>:<p>约定应收 {centsToYuan(funds.due)} {funds.currency} · 已抵扣 {centsToYuan(funds.allocated)} · 剩余 {centsToYuan(funds.balance)} {funds.currency}</p>}
        {order.replacesId&&<p className="notice">承接原订单 {order.replacesId} 定金 {centsToYuan(funds.carried)} {funds.currency}。转入抵扣不计新增收款。</p>}
        <h3>客户付款报送记录</h3>
        {!order.receipts?.length&&<p className="hint">本单尚无新增付款报送；转入定金另列，不生成收款流水。</p>}
        {order.receipts?.map(row=><div key={row.id} className={`commerce-record order-pay-card ${row.voidedAt?'commerce-void':''}`}>
          <div className="order-pay-top">
            <div className="order-pay-main">
              <strong className="pay-num">{centsToYuan(row.amountMinor)} {funds.currency}</strong>
              <span className="order-pill">{row.purpose==='deposit'?'定金':row.purpose==='full'?'全款':'尾款'}</span>
              {!row.voidedAt&&row.verifyStatus==='confirmed'&&<span className="order-pill">已到账</span>}
              {!row.voidedAt&&(!row.verifyStatus||row.verifyStatus==='pending')&&<span className="order-pill is-muted">待财务核账</span>}
              {!row.voidedAt&&row.verifyStatus==='rejected'&&<span className="order-pill pay-pill-reject">核账退回</span>}
            </div>
            {actor&&dispatch&&!row.voidedAt&&row.verifyStatus==='rejected'&&<button type="button" className="secondary order-pay-fix" onClick={()=>{dispatch({type:'voidReceipt',actor,orderId:order.id,receiptId:row.id,reason:'退回作废'});onMessage?.('已作废该笔退回收款（演练）。');}}>作废</button>}
          </div>
          <small className="order-pay-meta pay-num">{row.date} · {row.channel}{row.reference?` · ${row.reference}`:''} · {row.reportedBy}</small>
          {row.proofUrl&&<div className="pay-proof-row"><button type="button" className="ship-proof-mini" onClick={()=>setProofZoom(row.proofUrl||'')} aria-label="查看付款凭证"><img src={row.proofUrl} alt=""/></button><button type="button" className="text-action" onClick={()=>setProofZoom(row.proofUrl||'')}>查看付款凭证</button></div>}
          {row.verifyStatus==='rejected'&&!row.voidedAt&&<div className="pay-reject-box"><small className="pay-reject">核账退回{row.verifyReason?`：${row.verifyReason}`:''}</small>{actor&&dispatch&&<button type="button" className="text-action" onClick={()=>{setResubmit({orderId:order.id,receiptId:row.id,date:row.date,amount:centsToYuan(row.amountMinor),channel:row.channel,reference:row.reference,remoteUrl:row.proofUrl||''});setResubmitFile(null);setError('');}}>修改凭证/金额后重新提交</button>}</div>}
          {row.voidedAt&&<small className="order-pay-meta">已作废：{row.voidReason}</small>}
        </div>)}
        {resubmit&&resubmit.orderId===order.id&&actor&&dispatch&&<form className="card pay-resubmit-form" onSubmit={async e=>{e.preventDefault();try{const proofUrl=resubmitFile?await fileToDataUrl(resubmitFile):resubmit.remoteUrl;if(!proofUrl)throw Error('请先上传客户付款凭证截图');dispatch({type:'resubmitReceipt',actor,orderId:order.id,receiptId:resubmit.receiptId,date:resubmit.date,amount:resubmit.amount,channel:resubmit.channel,reference:resubmit.reference,proofUrl});setResubmit(null);setResubmitFile(null);setError('');onMessage?.('已重新提交核账（演练）。');}catch(cause){setError(toErrorMessage(cause));}}}>
          <h3>修改并重新提交核账</h3>
          <div className="grid two">
            <Field label="付款日期"><input required className="pay-num" type="date" min={order.businessDate} max={today} value={resubmit.date} onChange={e=>setResubmit({...resubmit,date:e.target.value})}/></Field>
            <Field label={'付款金额 · '+funds.currency}><input required className="pay-num" inputMode="decimal" value={resubmit.amount} onChange={e=>setResubmit({...resubmit,amount:e.target.value})}/></Field>
            <Field label="付款方式／账户"><input required maxLength={128} value={resubmit.channel} onChange={e=>setResubmit({...resubmit,channel:e.target.value})}/></Field>
            <Field label="流水号（可选）"><input maxLength={128} value={resubmit.reference} onChange={e=>setResubmit({...resubmit,reference:e.target.value})}/></Field>
          </div>
          <PaymentProofField file={resubmitFile} remoteUrl={resubmit.remoteUrl} onChange={setResubmitFile}/>
          {error&&<p className="error" role="alert">{error}</p>}
          <div className="actions"><button type="submit">重新提交核账</button><button type="button" className="secondary" onClick={()=>{setResubmit(null);setResubmitFile(null);}}>取消</button></div>
        </form>}
        {actor&&dispatch&&!order.cancelled&&funds.balance>0&&<>
          <ReceiptForm key={order.id} today={today} order={order} onSave={values=>{dispatch({type:'recordReceipt',actor,orderId:order.id,...values});onMessage?.('已记录客户付款报送。财务实际到账与第三方结算仍需分别核实。');}}/>
          {!order.receipts?.some(row=>row.purpose==='balance')&&funds.allocated>0&&<button type="button" className="secondary" onClick={()=>{setTransferId(order.id);setReason('');setError('');}}>换料／定金转单</button>}
        </>}
        {onAfterSales&&!order.cancelled&&onAfterSales(order)}
      </div>
    </details>;})}
    {transferring&&actor&&dispatch&&<section className="card crm-transfer" aria-label="换料转单">
      <div className="commerce-line"><h3>换料转单 · {transferring.id}</h3><button type="button" className="secondary" onClick={()=>setTransferId('')}>取消换料</button></div>
      <p className="notice">提交后，原单有效成交金额归零并回冲原开单日；保留原始记录。定金 {centsToYuan(orderFunds(transferring).allocated)} {orderFunds(transferring).currency} 全额转入下方同一客户的新单，不生成退款或新增收款。请核对新开单日期、料号、价格及约定币种。</p>
      <Field label="换料原因"><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
      {error&&<p className="error" role="alert">{error}</p>}
      <CreateOrder customerName={state.customers.find(c=>c.id===customerId)?.name} key={transferring.id} today={today} operator={actor.employeeName} channel={transferring.channel} registeredRoom={room} previewOnly practiceLabel="确认换料并转入定金" onSaved={()=>{}} onPractice={draft=>{try{dispatch({type:'transferOrder',actor,orderId:transferring.id,draft:{...draft,channel:transferring.channel},reason});setTransferId('');setError('');onMessage?.('换料转单完成：旧单保留并归零，新单已承接原定金，可继续报送尾款。');}catch(cause){setError(toErrorMessage(cause));}}}/>
    </section>}
    {proofZoom&&<div className="ship-proof-viewer" role="dialog" onClick={()=>setProofZoom('')}><img src={proofZoom} alt=""/></div>}
  </div>;
}

function fileToDataUrl(file:File):Promise<string> {
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function ReceiptForm({today,order,onSave}:{today:string;order:CrmOrder;onSave:(values:{date:string;amount:string;purpose:'deposit'|'balance'|'full';channel:string;reference:string;proofUrl:string})=>void}) {
  const [form,setForm]=useState({date:today,amount:'',purpose:'deposit' as 'deposit'|'balance'|'full',channel:'',reference:''}),[proofFile,setProofFile]=useState<File|null>(null),[error,setError]=useState('');
  const funds=orderFunds(order);
  async function save(){
    try{
      if(!proofFile)throw Error('请先上传客户付款凭证截图');
      const proofUrl=await fileToDataUrl(proofFile);
      onSave({...form,proofUrl});
      setForm({...form,amount:'',reference:''});
      setProofFile(null);
      setError('');
    }catch(cause){setError(toErrorMessage(cause));}
  }
  return <details className="crm-receipt-form"><summary>＋ 登记客户付款报送</summary><form onSubmit={e=>{e.preventDefault();void save();}}><div className="grid two">
    <Field label="付款日期"><input required className="pay-num" type="date" min={order.businessDate} max={today} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
    <Field label="付款类型"><select value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value as 'deposit'|'balance'|'full'})}><option value="deposit">定金</option><option value="balance">尾款</option><option value="full">全款</option></select></Field>
    <Field label={'客户付款金额 · '+funds.currency}><input required className="pay-num" inputMode="decimal" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></Field>
    <Field label="付款方式／账户"><input required maxLength={128} value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}/></Field>
    <Field label="流水号（可选）"><input maxLength={128} value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></Field>
  </div><PaymentProofField file={proofFile} onChange={next=>{setProofFile(next);if(next)setError('');}}/>{error&&<p role="alert" className="error">{error}</p>}<button type="button" onClick={e=>{if(e.currentTarget.form?.reportValidity())void save();}}>保存付款报送（演练）</button></form></details>;
}
