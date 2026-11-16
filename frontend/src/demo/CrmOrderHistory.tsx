import {useState} from 'react';
import {CreateOrder,Field} from '../OrderWorkspace';
import {toErrorMessage} from '../errors';
import {centsToYuan,effectiveOrderCents,orderFunds,type CrmAction,type CrmActor,type CrmOrder,type CrmState} from './customerCrm';
import './crm-order-history.css';

export default function CrmOrderHistory({state,customerId,today,actor,dispatch,room,onMessage}:{state:CrmState;customerId:string;today:string;actor?:CrmActor;dispatch?:(action:CrmAction)=>void;room?:{name:string;host:string};onMessage?:(text:string)=>void}) {
  const [transferId,setTransferId]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState('');
  const orders=state.orders.filter(order=>order.customerId===customerId);
  const transferring=orders.find(order=>order.id===transferId);
  return <div className="crm-order-history">
    {!orders.length&&<p className="notice">还没有开单。售后费用不增加订单笔数。</p>}
    {orders.map(order=>{const funds=orderFunds(order);return <details className="crm-order-row" key={order.id}>
      <summary><span><strong>{order.id}</strong><small>{order.businessDate} · {order.channel==='private'?'私推':'直播间'} · {order.employeeName}{order.materialRef?' · 料号 '+order.materialRef:''}</small></span><span><b>¥{centsToYuan(effectiveOrderCents(order))}</b><small>{order.replacedById?'换料取消':order.cancelled?'已跑单':funds.balance===0?'客户已付清':'待付款'}</small></span></summary>
      <div className="crm-order-body">
        <p>原开单价 ¥{centsToYuan(order.materialCents)} · 代购费 ¥{centsToYuan(order.feeCents)}</p>
        {!!order.items?.length&&<ul>{order.items.map((item,i)=><li key={i}>{item.kind==='material'?'翡翠原石':'翡翠成品'} · {item.materialRef||'未填料号'} · ¥{item.priceCny} + 代购费 ¥{item.buyingFeeCny}</li>)}</ul>}
        {order.replacedById?<p className="notice">换料取消 · 有效成交金额 ¥0.00。原定金已转入 {order.replacedById}，不再催收本单尾款。<br/>{order.transferredOn} · {order.transferredBy} · {order.transferReason}</p>:<p>约定应收 {centsToYuan(funds.due)} {funds.currency} · 已抵扣 {centsToYuan(funds.allocated)} · 剩余 {centsToYuan(funds.balance)} {funds.currency}</p>}
        {order.replacesId&&<p className="notice">承接原订单 {order.replacesId} 定金 {centsToYuan(funds.carried)} {funds.currency}。转入抵扣不计新增收款。</p>}
        <h3>客户付款报送记录</h3>
        {!order.receipts?.length&&<p className="hint">本单尚无新增付款报送；转入定金另列，不生成收款流水。</p>}
        {order.receipts?.map(row=><p key={row.id}>{row.date} · {row.purpose==='deposit'?'定金':'尾款'} {centsToYuan(row.amountMinor)} {funds.currency} · {row.channel}<br/><small>凭证 {row.reference} · 报送人 {row.reportedBy}{order.replacedById?' · 已转入关联新单':''}</small></p>)}
        {actor&&dispatch&&!order.cancelled&&funds.balance>0&&<>
          <ReceiptForm key={order.id} today={today} order={order} onSave={values=>{dispatch({type:'recordReceipt',actor,orderId:order.id,...values});onMessage?.('已记录客户付款报送。财务实际到账与第三方结算仍需分别核实。');}}/>
          {!order.receipts?.some(row=>row.purpose==='balance')&&funds.allocated>0&&<button type="button" className="secondary" onClick={()=>{setTransferId(order.id);setReason('');setError('');}}>换料／定金转单</button>}
        </>}
      </div>
    </details>;})}
    {transferring&&actor&&dispatch&&<section className="card crm-transfer" aria-label="换料转单">
      <div className="commerce-line"><h3>换料转单 · {transferring.id}</h3><button type="button" className="secondary" onClick={()=>setTransferId('')}>取消换料</button></div>
      <p className="notice">提交后，原单有效成交金额归零并回冲原开单日；保留原始记录。定金 {centsToYuan(orderFunds(transferring).allocated)} {orderFunds(transferring).currency} 全额转入下方同一客户的新单，不生成退款或新增收款。请核对新开单日期、料号、价格及约定币种。</p>
      <Field label="换料原因"><input required maxLength={500} value={reason} onChange={e=>setReason(e.target.value)}/></Field>
      {error&&<p className="error" role="alert">{error}</p>}
      <CreateOrder customerName={state.customers.find(c=>c.id===customerId)?.name} key={transferring.id} today={today} operator={actor.employeeName} channel={transferring.channel} registeredRoom={room} previewOnly practiceLabel="确认换料并转入定金" onSaved={()=>{}} onPractice={draft=>{try{dispatch({type:'transferOrder',actor,orderId:transferring.id,draft:{...draft,channel:transferring.channel},reason});setTransferId('');setError('');onMessage?.('换料转单完成：旧单保留并归零，新单已承接原定金，可继续报送尾款。');}catch(cause){setError(toErrorMessage(cause));}}}/>
    </section>}
  </div>;
}

function ReceiptForm({today,order,onSave}:{today:string;order:CrmOrder;onSave:(values:{date:string;amount:string;purpose:'deposit'|'balance';channel:string;reference:string})=>void}) {
  const [form,setForm]=useState({date:today,amount:'',purpose:'deposit' as 'deposit'|'balance',channel:'',reference:''}),[error,setError]=useState('');
  const funds=orderFunds(order);
  function save(){try{onSave(form);setForm({...form,amount:'',reference:''});setError('');}catch(cause){setError(toErrorMessage(cause));}}
  return <details className="crm-receipt-form"><summary>＋ 登记客户付款报送</summary><p className="hint">仅保存本浏览器演练记录，供财务核对，不等于公司人民币到账。币种按订单约定，跨币种收款由财务处理。</p><form onSubmit={e=>{e.preventDefault();save();}}><div className="grid two">
    <Field label="付款日期"><input required type="date" min={order.businessDate} max={today} value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></Field>
    <Field label="付款类型"><select value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value as 'deposit'|'balance'})}><option value="deposit">定金</option><option value="balance">尾款</option></select></Field>
    <Field label={'客户付款金额 · '+funds.currency}><input required inputMode="decimal" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/></Field>
    <Field label="付款方式／账户"><input required maxLength={128} value={form.channel} onChange={e=>setForm({...form,channel:e.target.value})}/></Field>
    <Field label="流水号／凭证编号"><input required maxLength={128} value={form.reference} onChange={e=>setForm({...form,reference:e.target.value})}/></Field>
  </div>{error&&<p role="alert" className="error">{error}</p>}<button type="button" onClick={e=>{if(e.currentTarget.form?.reportValidity())save();}}>保存付款报送（演练）</button></form></details>;
}
