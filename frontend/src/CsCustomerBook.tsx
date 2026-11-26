import { useEffect, useRef, useState } from "react";
import { api, type Order, type User } from "./api";
import { leadApi, type CustomerLead, type Lead } from "./leadApi";
import { labelOrderStatus } from "./labels";
import { yuan } from "./dashboardDisplay";
import { toErrorMessage } from "./errors";
import { CreateOrder, Field } from "./OrderWorkspace";

function orderStatus(order: Order) {
  return order.cancelled ? "已跑单" : labelOrderStatus(order.status);
}

export function CsCustomerBook({invalid=false,today,user,revision=0,orderRevision=0,onEdit,onOrder}:{
  invalid?:boolean;today:string;user:User;revision?:number;orderRevision?:number;onEdit?:(lead:Lead)=>void;
  onOrder?:(id:string,tab?:"cost"|"payment")=>void;
}) {
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(0);
  const [result,setResult]=useState<{rows:CustomerLead[];hasMore:boolean}|null>(null);
  const [customer,setCustomer]=useState<CustomerLead|null>(null);
  const [openUnlinked,setOpenUnlinked]=useState(false);
  const [orders,setOrders]=useState<Order[]|null>(null);
  const [refresh,setRefresh]=useState(0);
  const [error,setError]=useState("");
  const [orderError,setOrderError]=useState("");
  const [saving,setSaving]=useState(false);
  const [orderId,setOrderId]=useState("");
  const [reason,setReason]=useState("");
  const createDrawer=useRef<HTMLDialogElement>(null);
  const linkDrawer=useRef<HTMLDialogElement>(null);
  const needsOrders=Boolean(customer || openUnlinked);

  useEffect(()=>{
    let active=true;
    setResult(null);setError("");
    leadApi.customerBook(search,page,invalid).then(next=>{
      if(!active)return;
      setResult(next);
      setCustomer(current=>current ? next.rows.find(row=>row.id===current.id)??null : null);
    })
      .catch(cause=>{if(active)setError(toErrorMessage(cause));});
    return ()=>{active=false;};
  },[search,page,invalid,revision,refresh,orderRevision]);

  useEffect(()=>{
    if(!needsOrders)return;
    let active=true;
    setOrders(null);setOrderError("");
    api.orders("",{}).then(next=>{if(active)setOrders(next.orders);})
      .catch(cause=>{if(active)setOrderError(toErrorMessage(cause));});
    return ()=>{active=false;};
  },[needsOrders,refresh,orderRevision]);

  const linked=orders?.filter(row=>row.customerLeadId===customer?.id)??[];
  const unlinked=orders?.filter(row=>!row.customerLeadId)??[];
  function update() { setRefresh(value=>value+1); }
  async function linkOrder() {
    if(!customer||!orderId||!reason.trim()||saving)return;
    setSaving(true);setOrderError("");
    try {
      await api.orderAction(orderId,"customer",{customerLeadId:customer.id,reason});
      linkDrawer.current?.close();
      update();
    } catch(cause) {
      setOrderError(toErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if(customer) return <div className="cs-customer-book">
    <header className="commerce-line"><button type="button" className="secondary" onClick={()=>setCustomer(null)}>← 返回客户列表</button>
      <div className="actions">
        <button type="button" className="secondary" onClick={()=>onEdit?.(customer)}>跟进／修正</button>
        <button type="button" className="secondary" onClick={()=>{setOrderId("");setReason("");setOrderError("");linkDrawer.current?.showModal();}}>关联旧订单</button>
        <button type="button" onClick={()=>createDrawer.current?.showModal()}>＋ 登记成交</button>
      </div>
    </header>
    <div><h3>{customer.customerLabel}</h3><p className="hint">{customer.receivedOn} · {customer.channel==="ms"?"Messenger":"WhatsApp"}{customer.needSummary?` · ${customer.needSummary}`:""}</p></div>
    <h3>历史订单</h3>
    {orderError&&<p className="error" role="alert">{orderError}</p>}
    {orders===null&&!orderError&&<p role="status">正在读取订单…</p>}
    {orders!==null&&!linked.length&&<p className="notice">该客户暂无已关联订单。</p>}
    <div className="commerce-list">{linked.map(row=><article className="commerce-record" key={row.id}>
      <span><strong>{row.orderRef}</strong><small>{row.businessDate} · {orderStatus(row)}</small><small>待收尾款 {row.cancelled||row.status==="refunded"?"—":row.customerBalance==null?"待核对":`${Number(row.customerBalance)<=0?"0.00":row.customerBalance} ${row.customerCurrency??""}`}</small></span>
      <div className="actions"><strong>{yuan(row.amount)}</strong><button type="button" className="secondary" onClick={()=>onOrder?.(row.id)}>查看订单</button>
      {row.workflowEnabled&&!row.cancelled&&row.status!=="refunded"&&<button type="button" className="secondary" onClick={()=>onOrder?.(row.id,"cost")}>办理售后</button>}</div>
    </article>)}</div>
    <dialog className="fill-drawer fill-order-drawer" ref={createDrawer} aria-label="登记成交"><div className="fill-drawer-body">
      <header className="commerce-line"><h3>登记成交 · {customer.customerLabel}</h3><button type="button" className="secondary" onClick={()=>createDrawer.current?.close()}>关闭</button></header>
      <CreateOrder today={today} operator={user.displayName} customerName={customer.customerLabel.slice(0,64)} customerLeadId={customer.id}
        onSaved={id=>{createDrawer.current?.close();update();onOrder?.(id,"payment");}} />
    </div></dialog>
    <dialog className="fill-drawer" ref={linkDrawer} aria-label="关联旧订单"><div className="fill-drawer-body">
      <header className="commerce-line"><h3>关联旧订单 · {customer.customerLabel}</h3><button type="button" className="secondary" disabled={saving} onClick={()=>linkDrawer.current?.close()}>关闭</button></header>
      <p className="notice">请按订单号和客户资料核对原单后再关联。</p>
      {orderError&&<p className="error" role="alert">{orderError}</p>}
      <Field label="待关联订单"><select value={orderId} disabled={saving} onChange={e=>setOrderId(e.target.value)}><option value="">请选择原订单</option>
        {unlinked.map(row=><option key={row.id} value={row.id}>{row.orderRef} · {row.customerLabel || "未登记称呼"} · {row.businessDate} · {yuan(row.amount)}</option>)}</select></Field>
      <Field label="关联原因"><input maxLength={500} value={reason} disabled={saving} onChange={e=>setReason(e.target.value)}/></Field>
      <button type="button" disabled={saving||!reason.trim()||!orderId} onClick={()=>void linkOrder()}>确认关联</button>
    </div></dialog>
  </div>;

  return <div className="cs-customer-book">
    <div className="commerce-line"><Field label="查找客户"><input type="search" value={search} placeholder="输入客户称呼" onChange={e=>{setSearch(e.target.value);setPage(0);}}/></Field>
      <div className="actions"><button type="button" className="secondary" onClick={update}>刷新</button>
        {!invalid&&<button type="button" className="secondary" aria-pressed={openUnlinked} onClick={()=>setOpenUnlinked(v=>!v)}>待关联旧订单</button>}</div>
    </div>
    {openUnlinked&&<div className="cs-unlinked">
      <p className="hint">可先核对旧单，再打开对应客户档案，点击「关联旧订单」。</p>
      {orderError&&<p className="error" role="alert">{orderError}</p>}
      {!orders&&!orderError&&<p role="status">正在读取旧订单…</p>}
      {orders&&unlinked.length===0&&<p>暂无待关联旧订单。</p>}
      <div className="commerce-list">{unlinked.map(row=><button type="button" className="secondary commerce-record" key={row.id} onClick={()=>onOrder?.(row.id)}>
        <span><strong>{row.customerLabel||"未登记称呼"}</strong><small>{row.orderRef} · {row.businessDate}</small></span><b>{yuan(row.amount)}</b>
      </button>)}</div>
    </div>}
    {error&&<p className="error" role="alert">{error}</p>}
    {!result&&!error&&<p role="status">正在读取客户列表…</p>}
    {result&&!result.rows.length&&<p className="notice">{invalid?"没有符合条件的已复核无效粉。":"没有符合条件的客户。"}</p>}
    <div className="commerce-list cs-customer-rows">{result?.rows.map(row=>{
      const subtitle=`${row.receivedOn} · ${row.channel==="ms"?"Messenger":"WhatsApp"}`;
      if(invalid) return <article className="commerce-record" key={row.id}>
        <span><strong>{row.customerLabel}</strong><small>{subtitle}</small><small>{row.invalidReason}</small></span>
        <small>复核 {row.reviewedAt?.slice(0,10)??"—"}</small>
      </article>;
      const contact=row.invalidReviewStatus==="pending"?"待复核":row.invalidReviewStatus==="approved"?"无效标记":
        row.contactStatus==="replied"?"正常沟通":row.contactStatus==="read_no_reply"?"已读不回":"未读／未回复";
      return <button type="button" className="secondary commerce-record" key={row.id} onClick={()=>{setCustomer(row);setOpenUnlinked(false);}}>
        <span><strong>{row.customerLabel}</strong><small>{subtitle} · {contact}</small></span>
        <small>{row.lastOrderCancelled?"最近订单已跑单":row.lastOrderStatus?labelOrderStatus(row.lastOrderStatus):"暂无关联订单"} ›</small>
      </button>;
    })}</div>
    {(page>0||result?.hasMore)&&<div className="actions"><button type="button" className="secondary" disabled={!page} onClick={()=>setPage(n=>n-1)}>上一页</button>
      <span>第 {page+1} 页</span><button type="button" className="secondary" disabled={!result?.hasMore} onClick={()=>setPage(n=>n+1)}>下一页</button></div>}
  </div>;
}
