const test=require('node:test'),assert=require('node:assert/strict');
const {build}=require('./live-room-operations.js');
const period={from:'2026-11-11',to:'2026-11-11'};
const record=(id,changes={})=>({legacy:false,order:{id,order_ref:id,customer_label:id,business_date:period.from,status:'placed'},details:{customerCurrency:'CNY',baseCustomerDue:'100.00',customerDue:'100.00',liveRoomCode:'room-a'},payments:[],charges:[],...changes});
test('付款进展按同单约定币种计算，第三方是否结汇不影响客户结清',()=>{
 const a=record('a',{payments:[{payment_date:period.to,credit_amount:'100.00',third_party:true,settled_amount:'0.00'}]});
 const b=record('b',{payments:[{payment_date:period.to,credit_amount:'20.00'}]});
 const c=record('c');const result=build([a,b,c],period);
 assert.deepEqual(result.summary,{unpaid:1,partial:1,settled:1,unknown:0,total:3,followupCount:2});
 assert.equal(result.orders.find(o=>o.id==='b').balance,'80.00');
});
test('历史待付单保留跟进，但不混入当期开单进度，截止日后收款不提前结清',()=>{
 const old=record('old');old.order.business_date='2026-11-10';
 old.payments=[{payment_date:'2026-11-12',credit_amount:'100.00'},{payment_date:'2026-11-11',credit_amount:'100.00',voided_at:'2026-11-11'}];
 const data=build([old,record('new')],period);
 assert.equal(data.summary.total,1);assert.equal(data.summary.unpaid,1);assert.equal(data.summary.followupCount,2);
 assert.equal(data.orders[0].bookedInPeriod,false);assert.equal(data.orders[0].balance,'100.00');
});
test('追加应收和付款按截止日计入，作废收费不再计入',()=>{
 const r=record('a',{charges:[{business_date:'2026-11-11',customer_amount:'20.00'},{business_date:'2026-11-12',customer_amount:'50.00'},{business_date:'2026-11-11',customer_amount:'30.00',voided_at:'x'}],payments:[{payment_date:'2026-11-11',credit_amount:'110.00'}]});
 const d=build([r],period).orders[0];assert.equal(d.due,'120.00');assert.equal(d.balance,'10.00');assert.equal(d.status,'partial');
});
test('缺失金额、旧简版、错币种不冒充未付款；跑单、退款和未来开单排除',()=>{
 const legacy=record('legacy',{legacy:true}),bad=record('bad',{payments:[{payment_date:period.to,credit_amount:'10.00',customer_currency:'USD'}]});
 const cancelled=record('cancelled');cancelled.order.cancelled=true;
 const refunded=record('refunded');refunded.order.status='refunded';
 const future=record('future');future.order.business_date='2026-11-12';
 const d=build([legacy,bad,cancelled,refunded,future],period);
 assert.equal(d.summary.unknown,2);assert.equal(d.summary.followupCount,0);assert.equal(d.orders[0].balance,null);
});
test('多币种余额保持逐单原币，不与第三方手续费、结汇或别单收款混算',()=>{
 const r=record('twd');r.details={...r.details,customerCurrency:'TWD',baseCustomerDue:'3200.00'};r.payments=[{payment_date:period.to,credit_amount:'1200.00',customer_currency:'TWD'}];
 const zero=record('zero');zero.details.baseCustomerDue='0.00';
 const d=build([r,zero],period);assert.equal(d.orders.find(o=>o.id==='twd').balance,'2000.00');assert.equal(d.orders.find(o=>o.id==='twd').currency,'TWD');assert.equal(d.orders.find(o=>o.id==='zero').status,'settled');
});
