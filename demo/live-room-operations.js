(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CmsLiveRoomOperations=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const cents=v=>typeof v==='string'&&/^\d+(?:\.\d{1,2})?$/.test(v)?BigInt(v.split('.')[0])*100n+BigInt((v.split('.')[1]||'').padEnd(2,'0')):null;
  const money=n=>`${n/100n}.${String(n%100n).padStart(2,'0')}`;
  const empty=()=>({unpaid:0,partial:0,settled:0,unknown:0,total:0,followupCount:0});
  function build(records,period){
    const orders=[],rooms=Object.create(null),summary=empty();
    for(const record of records){
      const o=record.order,d=record.details,i=record.identity||{};
      if(o.cancelled||o.status==='refunded'||o.business_date>period.to)continue;
      const bookedInPeriod=o.business_date>=period.from;
      const currency=d?.customerCurrency;
      const base=cents(d?.baseCustomerDue);
      const charges=(record.charges||[]).filter(r=>!r.voided_at&&r.business_date<=period.to);
      const payments=(record.payments||[]).filter(r=>!r.voided_at&&r.payment_date<=period.to);
      let due=base,paid=0n;
      if(base!==null){for(const r of charges){const n=cents(r.customer_amount);if(n===null){due=null;break;}due+=n;}}
      else if(!(record.charges||[]).some(r=>!r.voided_at&&r.business_date>period.to))due=cents(d?.customerDue);
      for(const r of payments){const n=cents(r.credit_amount);if(n===null||(r.customer_currency&&r.customer_currency!==currency)){paid=null;break;}paid+=n;}
      const known=!record.legacy&&['CNY','TWD','USD'].includes(currency)&&due!==null&&paid!==null;
      const balance=known?(due>paid?due-paid:0n):null;
      const status=!known?'unknown':balance===0n?'settled':paid===0n?'unpaid':'partial';
      const roomCode=d?.liveRoomCode||i.liveRoomCode||'',roomKey=roomCode||'__unassigned__';
      const row={id:o.id,reference:o.order_ref,customerLabel:o.customer_label||'客户待补',customerCode:d?.customerCode||i.customerCode||'',operatorName:d?.operatorName||i.operatorName||'',serviceAccount:o.wechat_id||'',roomKey,roomCode:roomCode||'未归属直播间',hostName:d?.hostName||i.hostName||'',personaName:d?.personaName||i.personaName||'',bookingDate:o.business_date,currency:currency||null,due:known?money(due):null,paid:known?money(paid):null,balance:balance===null?null:money(balance),status,bookedInPeriod};
      orders.push(row);
      const room=rooms[roomKey]||(rooms[roomKey]=empty());
      if(bookedInPeriod){for(const target of [summary,room]){target[status]++;target.total++;}}
      if(status==='unpaid'||status==='partial'){summary.followupCount++;room.followupCount++;}
    }
    orders.sort((a,b)=>a.bookingDate.localeCompare(b.bookingDate)||a.reference.localeCompare(b.reference));
    return {asOf:period.to,summary,rooms,orders,cohort:'bookings_in_selected_period',followupScope:'all_active_orders_booked_on_or_before_end',basis:'agreed_currency_credits_including_additional_charges_as_of_end'};
  }
  return {build};
});
