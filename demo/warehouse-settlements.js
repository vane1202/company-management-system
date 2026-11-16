(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CmsWarehouse=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const kinds={goods:'原石出库结账',sourcing:'售后接待结账',design:'设计雕刻',labor:'加工工费',accessory:'配件',certificate:'证书',box:'包装',shipping:'运费',other:'其他对外结账'};
 const fail=(message,status=400)=>{const error=Error(message);error.status=status;throw error;};
 const cents=value=>{if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(value))fail('金额格式无效');const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
 const money=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
 function text(value,label,max=128){if(typeof value!=='string'||!value.trim()||value.length>max)fail('请填写'+label);return value.trim();}
 function date(value,today){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value>today)fail('日期无效或晚于今日');return value;}
 function apply(state,input,ctx){
  const {role,today,actor,orders,expenses,id,now}=ctx;
  if(!['warehouse','finance'].includes(role))fail('无库房结账权限',403);
  const next=JSON.parse(JSON.stringify(state));
  if(input.action==='create'){
   if(role!=='warehouse')fail('仅库房可提交结账单',403);
   const requestKey=text(input.requestKey,'提交标识');const duplicate=next.bills.find(b=>b.requestKey===requestKey);if(duplicate)return next;
   const order=orders.find(o=>o.id===input.orderId);if(!order||order.cancelled||order.status==='refunded')fail('请选择有效订单');
   if(!Object.hasOwn(kinds,input.category))fail('结账类别无效');
   const source=input.expenseId?expenses.find(e=>e.id===input.expenseId&&e.order_id===order.id&&!e.voided_at):null;
   if(input.expenseId&&!source)fail('原成本不属于所选订单');
   if(source&&source.category!==input.category)fail('类别与原成本不一致');
   if(source&&next.bills.some(b=>b.expenseId===source.id&&b.status!=='rejected'))fail('此成本已有关联结账单，请在原单中跟进');
   const amount=cents(input.amount);if(amount<=0n)fail('结账金额必须大于0');
   if(next.bills.some(b=>b.status!=='rejected'&&b.proof===input.proof?.trim()&&b.materialRef===input.materialRef?.trim()&&b.counterparty===input.counterparty?.trim()&&b.category===input.category))fail('同一凭证、料号和收款方已有结账单，请核对');
   if(source&&(source.pending_cny==null||amount>cents(source.pending_cny)))fail('结账金额超过原成本待付金额');
   next.bills.push({id,requestKey,orderId:order.id,expenseId:source?.id||'',category:input.category,label:text(input.label,'结账项目'),counterparty:text(input.counterparty,'供货／服务方'),amount:money(amount),date:date(input.date,today),materialRef:text(input.materialRef,'商品编号／料号'),proof:text(input.proof,'单据或留底凭证编号'),note:typeof input.note==='string'?input.note.slice(0,1000):'',status:'submitted',version:1,createdBy:actor,createdAt:now,history:[]});
   return next;
  }
  if(role!=='finance')fail('仅财务可审核和登记付款',403);
  const bill=next.bills.find(b=>b.id===input.id);if(!bill)fail('结账单不存在',404);
  if(input.version!==bill.version)fail('记录已更新，请刷新后重试',409);
  if(input.action==='review'){
   if(bill.status!=='submitted')fail('此单已处理',409);
   if(!['approved','rejected'].includes(input.decision))fail('审核结果无效');
   if(input.decision==='approved'&&bill.expenseId){const e=expenses.find(e=>e.id===bill.expenseId&&!e.voided_at);if(!e||e.pending_cny==null||cents(bill.amount)>cents(e.pending_cny))fail('原成本待付金额已变化，请核对');}
   bill.status=input.decision;bill.reviewNote=text(input.reason,'审核说明',500);bill.reviewedBy=actor;bill.reviewedAt=now;
  }else if(input.action==='pay'){
   if(bill.status!=='approved')fail('仅已审核的结账单可登记付款');
   const reference=text(input.reference,'付款流水号');
   if(next.payments.some(p=>p.reference===reference)||(ctx.references||[]).includes(reference))fail('此付款流水号已登记，请核对');
   const paid=next.payments.filter(p=>p.billId===bill.id).reduce((n,p)=>n+cents(p.amount),0n),amount=cents(input.amount);
   if(amount<=0n||paid+amount>cents(bill.amount))fail('实际付款超过该结账单剩余应付');
   if(bill.expenseId){const e=expenses.find(e=>e.id===bill.expenseId);if(!e||e.pending_cny==null||amount>cents(e.pending_cny))fail('超过原成本剩余应付，请核对');}
   next.payments.push({id,billId:bill.id,amount:money(amount),date:date(input.date,today),payee:text(input.payee,'实际收款方'),account:text(input.account,'公司付款账户'),reference,createdBy:actor,createdAt:now});
  }else fail('不支持此操作',405);
  bill.history.push({action:input.action,actor,at:now,version:bill.version});bill.version++;return next;
 }
 return {kinds,cents,money,apply};
});
