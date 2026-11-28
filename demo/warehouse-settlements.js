(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CmsWarehouse=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const kinds={goods:'原石出库结账',sourcing:'售后接待结账',design:'设计雕刻',labor:'加工工费',accessory:'配件',certificate:'证书',box:'包装',shipping:'运费',other:'其他对外结账'};
 const fail=(message,status=400)=>{const error=Error(message);error.status=status;throw error;};
 const cents=value=>{if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(value))fail('金额格式无效');const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
 const money=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
 function text(value,label,max=128){if(typeof value!=='string'||!value.trim()||value.length>max)fail('请填写'+label);return value.trim();}
 function date(value,today){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value>today)fail('日期无效或晚于今日');return value;}
 function ensure(state){const next=JSON.parse(JSON.stringify(state));if(!Array.isArray(next.lines))next.lines=[];if(!Array.isArray(next.batches))next.batches=[];if(!Array.isArray(next.bills))next.bills=[];if(!Array.isArray(next.payments))next.payments=[];return next;}
 function qualifies(record,item){
  if(!record||record.legacy||!record.details||!item)return null;
  const order=record.order;
  if(order.cancelled||order.status==='refunded')return null;
  if(item.kind==='material'&&!item.sourcing_no_settle&&cents(record.balance)<=0n)return 'material';
  if(item.kind==='finished'&&record.details.shippedOn)return 'finished';
  return null;
 }
 function trigger(kind,record){return kind==='material'?'已付全款 · 非PH 自动推入':'已发货 '+record.details.shippedOn+' 自动推入';}
 function shippingProofs(record){return ((record&&record.attachments)||[]).filter(row=>row.kind==='shipping_proof').map(row=>({id:row.id,url:row.url||''}));}
 function findRecord(records,line){return (records||[]).find(record=>record.order&&record.order.id===line.orderId);}
 function offset(line,records){
  if(line.status!=='batched'||line.queueKind==='other')return '';
  const record=findRecord(records,line);if(!record||record.legacy)return '';
  const item=(record.items||[]).find(row=>row.id===line.itemId);
  const cancelled=record.order.cancelled||record.order.status==='refunded';
  if(line.queueKind==='material'){
   if(cancelled)return '订单已跑单或退款，请冲抵';
   if(item&&item.sourcing_no_settle)return '已补标接待（PH），请冲抵';
   if(cents(record.balance)>0n)return '尾款未结清，请冲抵';
  }
  if(line.queueKind==='finished'){
   if(cancelled)return '订单已作废，请冲抵';
   if(!record.details.shippedOn)return '发货日期已取消，请冲抵';
  }
  return '';
 }
 function project(records,state){
  const lines=state.lines||[],batches=(state.batches||[]).filter(batch=>batch.status!=='withdrawn'),bills=state.bills||[];
  const batchOf=new Map(batches.map(batch=>[batch.id,batch]));
  const held=new Set();
  for(const line of lines){
   if(!line.itemId)continue;
   const record=findRecord(records,line),item=record&&(record.items||[]).find(row=>row.id===line.itemId);
   const live=line.status==='priced'?!!qualifies(record,item):line.status==='batched'&&batchOf.has(line.batchId);
   if(live)held.add(line.itemId);
  }
  const queue=[];
  for(const record of records||[]){
   if(record.legacy||!record.details)continue;
   for(const item of record.items||[]){
    const kind=qualifies(record,item);
    if(!kind||held.has(item.id))continue;
    if(bills.some(bill=>bill.status!=='rejected'&&bill.orderId===record.order.id&&bill.materialRef===item.material_ref&&['goods','sourcing'].includes(bill.category)))continue;
    queue.push({key:item.id,orderId:record.order.id,itemId:item.id,queueKind:kind,label:item.label,materialRef:item.material_ref||'',referenceCny:record.order.material_cost_cny||null,customerLabel:record.order.customer_label,operatorName:record.details.operatorName||'',orderRef:record.order.order_ref,triggerLabel:trigger(kind,record),attachmentId:null,shippingProofs:kind==='finished'?shippingProofs(record):[],businessDate:record.order.business_date});
   }
  }
  const visible=lines.flatMap(line=>{
   if(line.status==='batched'&&!batchOf.has(line.batchId))return [];
   if(line.status==='priced'&&line.queueKind!=='other'){
    const record=findRecord(records,line),item=record&&(record.items||[]).find(row=>row.id===line.itemId);
    if(!qualifies(record,item))return [];
   }
   return [{...line,offsetNote:offset(line,records),shippingProofs:line.queueKind==='finished'?shippingProofs(findRecord(records,line)):[]}];
  });
  return {queue,lines:visible,batches:batches.map(batch=>({...batch,lineIds:visible.filter(line=>line.batchId===batch.id).map(line=>line.id)}))};
 }
 function seen(next,requestKey){return next.bills.some(row=>row.requestKey===requestKey)||next.lines.some(row=>row.requestKey===requestKey)||next.batches.some(row=>row.requestKey===requestKey);}
 function apply(state,input,ctx){
  const {role,today,actor,orders,expenses,id,now,records}=ctx;
  if(!['warehouse','finance'].includes(role))fail('无库房结账权限',403);
  const next=ensure(state);
  if(input.action==='price'||input.action==='manual'||input.action==='pack'||input.action==='recall'||input.action==='resubmitBatch'){
   if(role!=='warehouse')fail('仅库房可核价和打包',403);
   const requestKey=text(input.requestKey,'提交标识');if(seen(next,requestKey))return next;
   if(input.action==='price'){
    const record=(records||[]).find(row=>row.items&&row.items.some(item=>item.id===input.itemId));
    const item=record&&record.items.find(row=>row.id===input.itemId);
    const kind=qualifies(record,item);if(!kind)fail('这笔货目前不满足自动推送条件',409);
    if(next.bills.some(bill=>bill.status!=='rejected'&&bill.orderId===record.order.id&&bill.materialRef===item.material_ref&&['goods','sourcing'].includes(bill.category)))fail('同一料号已有未退回的库房结账单',409);
    const open=next.lines.find(line=>line.itemId===item.id&&(line.status==='priced'||line.status==='batched'));
    if(open&&open.status==='batched')fail('这笔货已在结算单中',409);
    const amount=cents(input.amount);if(amount<=0n)fail('结算金额必须大于0');
    const saved={queueKind:kind,orderId:record.order.id,itemId:item.id,orderRef:record.order.order_ref,label:item.label,materialRef:item.material_ref||'',referenceCny:record.order.material_cost_cny||null,customerLabel:record.order.customer_label,operatorName:record.details.operatorName||'',triggerLabel:trigger(kind,record),attachmentId:null,counterparty:text(input.counterparty,'结算供应商'),amount:money(amount),date:date(input.date,today),status:'priced',batchId:null,version:(open?.version||0)+1,requestKey,source:'auto'};
    if(saved.date<record.order.business_date)fail('费用日期不能早于开单日期');
    if(open)Object.assign(open,saved);else next.lines.push({id, ...saved});
    return next;
   }
   if(input.action==='manual'){
    const amount=cents(input.amount);if(amount<=0n)fail('结算金额必须大于0');
    next.lines.push({id,requestKey,source:'manual',queueKind:'other',orderId:null,itemId:null,orderRef:'',label:text(input.label,'费用名称'),materialRef:'',referenceCny:null,customerLabel:'',operatorName:actor,triggerLabel:'手动补录',attachmentId:null,counterparty:text(input.counterparty,'供应商／收款方'),amount:money(amount),date:date(input.date,today),status:'priced',batchId:null,version:1});
    return next;
   }
   if(input.action==='pack'){
    const ids=Array.isArray(input.lineIds)?input.lineIds:[];
    const rows=ids.map(lineId=>next.lines.find(line=>line.id===lineId));
    if(!ids.length||rows.some(line=>!line||line.status!=='priced'))fail('只能合并尚未提交的待结账目',409);
    if(new Set(rows.map(line=>line.counterparty)).size!==1)fail('请按同一供应商分别打包');
    for(const line of rows){if(!line.itemId)continue;const record=findRecord(records,line),item=record&&(record.items||[]).find(row=>row.id===line.itemId);if(!qualifies(record,item))fail('有账目已不再满足推送条件',409);}
    const total=rows.reduce((sum,line)=>sum+cents(line.amount),0n),batchId=id;
    next.batches.push({id:batchId,requestKey,batchRef:'WH-'+today.replaceAll('-','')+'-'+String(id).slice(-4).toUpperCase(),counterparty:rows[0].counterparty,status:'submitted',amount:money(total),date:today,version:1,reviewNote:'',createdBy:actor,createdAt:now,lineIds:ids});
    for(const line of rows){line.status='batched';line.batchId=batchId;line.version++;}
    return next;
   }
   const batch=next.batches.find(row=>row.id===input.id);if(!batch||batch.status==='withdrawn')fail('结算单不存在',404);
   if(input.version!==batch.version)fail('记录已更新，请刷新后重试',409);
   const batchLines=next.lines.filter(line=>line.batchId===batch.id);
   if(input.action==='recall'){
    if(batch.status!=='submitted')fail('仅待财务审核的结算单可撤回',409);
    for(const line of batchLines){line.status='priced';line.batchId=null;line.version++;}
    batch.status='withdrawn';batch.version++;return next;
   }
   if(batch.status!=='rejected')fail('仅已退回的结算单可修改重提',409);
   const supplier=text(input.counterparty,'结算供应商'),edits=Array.isArray(input.lines)?input.lines:[];
   if(edits.length!==batchLines.length)fail('请保持结算明细完整');
   let total=0n;
   for(const edit of edits){const line=batchLines.find(row=>row.id===edit.id);if(!line)fail('结算明细不存在');const amount=cents(edit.amount);if(amount<=0n)fail('结算金额必须大于0');line.amount=money(amount);line.counterparty=supplier;line.version++;total+=amount;}
   Object.assign(batch,{counterparty:supplier,amount:money(total),status:'submitted',reviewNote:'',version:batch.version+1});
   return next;
  }
  if(input.action==='batchReview'||input.action==='markPaid'){
   if(role!=='finance')fail('仅财务可审核和标记打款',403);
   const requestKey=text(input.requestKey,'提交标识');if(seen(next,requestKey))return next;
   const batch=next.batches.find(row=>row.id===input.id);if(!batch)fail('结算单不存在',404);
   if(input.version!==batch.version)fail('记录已更新，请刷新后重试',409);
   if(input.action==='batchReview'){
    if(batch.status!=='submitted')fail('此单已处理',409);
    if(!['approved','rejected'].includes(input.decision))fail('审核结果无效');
    batch.status=input.decision;batch.reviewNote=text(input.reason,'审核说明',500);batch.version++;batch.requestKey=requestKey;return next;
   }
   if(batch.status!=='approved')fail('仅已审核的结算单可标记打款',409);
   batch.status='paid';batch.paidOn=date(input.date,today);batch.payee=text(input.payee,'实际收款方');batch.payAccount=text(input.account,'公司付款账户');batch.payReference=text(input.reference,'付款流水号');batch.version++;batch.requestKey=requestKey;
   next.payments.push({id,billId:'',batchId:batch.id,amount:batch.amount,date:batch.paidOn,payee:batch.payee,account:batch.payAccount,reference:batch.payReference,createdBy:actor,createdAt:now});
   return next;
  }
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
 return {kinds,cents,money,apply,project};
});
