(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.CmsReimbursements=factory();})(typeof window!=='undefined'?window:globalThis,function(){
 const categories={temporary:'临时支出',advance:'业务垫付',travel:'差旅外出',purchase:'临时采购',other:'其他报销'};
 const claimTypes=new Set(['live_room','business','welfare','office']);
 const fail=(message,status=400)=>{const e=Error(message);e.status=status;throw e;};
 const cents=value=>{if(typeof value!=='string'||!/^\d{1,10}(\.\d{1,2})?$/.test(value))fail('请填写有效人民币金额');const [a,b='']=value.split('.');return BigInt(a)*100n+BigInt(b.padEnd(2,'0'));};
 const money=value=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
 function text(value,label,max=128){if(typeof value!=='string'||!value.trim()||value.length>max)fail('请填写'+label);return value.trim();}
 function date(value,today){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value||value>today)fail('日期无效或晚于今日');return value;}
 function resolveLiveRoom(input,liveRooms){
  const rawId=typeof input.liveRoomId==='string'?input.liveRoomId.trim():'';
  const rawName=typeof input.liveRoomName==='string'?input.liveRoomName.trim():'';
  if(!rawId&&!rawName)return {liveRoomId:'',liveRoomName:''};
  const list=Array.isArray(liveRooms)?liveRooms:[];
  const matched=list.find(r=>r.id===rawId||r.name===rawName||r.name===rawId);
  return {liveRoomId:(matched?.id||rawId||rawName).slice(0,64),liveRoomName:(matched?.name||rawName||rawId).slice(0,128)};
 }
 function apply(state,input,ctx){
  if(!['finance','cs','cs_supervisor'].includes(ctx.role))fail('无报销权限',403);
  const next=JSON.parse(JSON.stringify(state)),{actor,today,id,now,expenses}=ctx;
  if(input.action==='create'){
   const staff=ctx.role==='cs';
   const supervisor=ctx.role==='cs_supervisor';
   const selfApplicant=staff||supervisor;
   const requestKey=text(input.requestKey,'提交标识');if(next.claims.some(c=>c.requestKey===requestKey))return next;
   const claimType=typeof input.claimType==='string'&&input.claimType.trim()
    ? input.claimType.trim()
    : supervisor
     ? 'live_room'
     : (typeof input.orderId==='string'&&input.orderId.trim())||(typeof input.expenseId==='string'&&input.expenseId.trim())
      ? 'business'
      : 'office';
   if(!claimTypes.has(claimType))fail('报销分类无效');
   const welfareCustomer=claimType==='welfare'&&typeof input.welfareCustomer==='string'?input.welfareCustomer.trim().slice(0,128):'';
   if(!staff&&!Object.hasOwn(categories,input.category))fail('报销类别无效');
   const amount=cents(input.amount);if(amount<=0n)fail('报销金额必须大于0');
   const source=!selfApplicant&&claimType==='business'&&input.expenseId?expenses.find(e=>e.id===input.expenseId&&!e.voided_at):null;
   if(!selfApplicant&&claimType==='business'&&input.expenseId&&!source)fail('关联费用不存在');
   if(source&&(source.pending_cny==null||amount>cents(source.pending_cny)))fail('报销金额超过关联费用待付金额');
   if(source&&next.claims.some(c=>c.expenseId===source.id&&c.status!=='rejected'))fail('该费用已有报销单，请勿重复登记');
   const claimant=selfApplicant?actor:text(input.claimant,'报销人');
   const proofs=Array.isArray(input.proofs)?input.proofs:[];
   if(selfApplicant&&!proofs.length)fail('请上传 1 至 3 张付款截图或账单截图');
   if(proofs.length>3||proofs.some(value=>typeof value!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(value)))fail('凭证图片格式无效');
   const receipt=proofs.length?'image:'+requestKey:text(input.receiptRef,'付款截图');

   if(next.claims.some(c=>c.status!=='rejected'&&c.claimant===claimant&&c.receiptRef===receipt))fail('该报销人与凭证已有报销单，请核对');
   const expenseDate=date(input.expenseDate,today),claimDate=selfApplicant?today:date(input.claimDate||today,today);if(expenseDate>claimDate)fail('费用日期不能晚于报销登记日期');
   const teams=Array.isArray(ctx.teams)?ctx.teams:[];
   const orders=Array.isArray(ctx.orders)?ctx.orders:[];
   let pickedTeam=null;
   if(staff){
    if(typeof input.teamId==='string'&&input.teamId.trim()){
     pickedTeam=teams.find(t=>t.id===input.teamId)||null;
     if(!pickedTeam)fail('请选择当前客服所属的小组');
    }else if(teams.length===1){pickedTeam=teams[0];}
    else if(teams.length>1){fail('请选择本次报销所属客服组别');}
   }else if(supervisor){
    if(typeof input.teamId==='string'&&input.teamId.trim()){
     pickedTeam=teams.find(t=>t.id===input.teamId)||null;
     if(!pickedTeam)fail('所选客服组别无效或无权限');
    }else{pickedTeam=teams[0]||null;}
   }else if(typeof input.teamId==='string'&&input.teamId.trim()){
    pickedTeam=teams.find(t=>t.id===input.teamId)||null;
   }
   let linkedOrder=null;
   if(source){
    linkedOrder=orders.find(o=>o.id===source.order_id)||null;
   }else if(claimType==='business'){
    const rawOrderId=typeof input.orderId==='string'?input.orderId.trim():'';
    if(!rawOrderId)fail('业务类报销请选择关联订单；未开单客户请选择「未开单福利品」');
    linkedOrder=orders.find(o=>o.id===rawOrderId)||null;
    if(!linkedOrder)fail(selfApplicant?'所选订单不存在或不在管理范围内':'所选订单不存在');
   }
   const {liveRoomId,liveRoomName}=resolveLiveRoom(input,ctx.liveRooms);
   const stage=staff?'supervisor':'finance';
   next.claims.push({id,requestKey,claimant,teamId:pickedTeam?.id||'',department:pickedTeam?pickedTeam.name:(staff?'演示客服组':supervisor?'客服主管':typeof input.department==='string'?input.department.slice(0,64):''),claimType,welfareCustomer,postedExpenseId:'',orderId:linkedOrder?.id||'',orderRef:linkedOrder?.orderRef||'',customerLabel:linkedOrder?.customerLabel||'',orderDate:linkedOrder?.businessDate||'',liveRoomId,liveRoomName,category:staff?(claimType==='office'?'other':'advance'):input.category,purpose:text(input.purpose,'报销事由',500),amount:money(amount),expenseDate,claimDate,expenseId:source?.id||'',receiptRef:receipt,proofs,stage,ownerRole:ctx.role,createdById:ctx.actorId||'',createdByRole:ctx.role,forwardedBy:supervisor?actor:'',forwardedAt:supervisor?now:'',note:typeof input.note==='string'?input.note.slice(0,1000):'',status:'pending',version:1,createdBy:actor,createdAt:now,history:[]});return next;
  }
  const claimIndex=next.claims.findIndex(c=>c.id===input.id);if(claimIndex<0)fail('报销单不存在',404);
  const claim=next.claims[claimIndex];
  if(input.version!==claim.version)fail('报销单已更新，请刷新后重试',409);
  if(input.action==='withdraw'){
   if(ctx.role!=='cs_supervisor'||claim.ownerRole!=='cs_supervisor')fail('仅报销发起人（客服主管）可撤回本人报销单',403);
   if(claim.stage!=='finance'||claim.status!=='pending')fail('仅待财务核对状态的本人报销单可撤回',409);
   if(next.payments.some(p=>p.claimId===claim.id))fail('该报销单已有付款记录，无法撤回',409);
   next.claims.splice(claimIndex,1);return next;
  }
  if(input.action==='resubmit'){
   if(ctx.role!=='cs_supervisor'||claim.ownerRole!=='cs_supervisor')fail('仅报销发起人（客服主管）可修改重提本人报销单',403);
   if(claim.stage!=='finance'||claim.status!=='rejected')fail('仅财务已退回状态的本人报销单可修改重提',409);
   const claimType=typeof input.claimType==='string'&&input.claimType.trim()?input.claimType.trim():(claim.claimType||'live_room');
   if(!claimTypes.has(claimType))fail('报销分类无效');
   if(!Object.hasOwn(categories,input.category))fail('报销类别无效');
   const amount=cents(input.amount);if(amount<=0n)fail('报销金额必须大于0');
   const expenseDate=date(input.expenseDate,today);
   const purpose=text(input.purpose,'报销事由',500);
   const note=typeof input.note==='string'?input.note.slice(0,1000):'';
   const welfareCustomer=claimType==='welfare'&&typeof input.welfareCustomer==='string'?input.welfareCustomer.trim().slice(0,128):'';
   const orders=Array.isArray(ctx.orders)?ctx.orders:[];
   let linkedOrder=null;
   if(claimType==='business'){
    const rawOrderId=typeof input.orderId==='string'?input.orderId.trim():'';
    if(!rawOrderId)fail('业务类报销请选择关联订单；未开单客户请选择「未开单福利品」');
    linkedOrder=orders.find(o=>o.id===rawOrderId)||null;
    if(!linkedOrder)fail('所选订单不存在或不在管理范围内');
   }
   const {liveRoomId,liveRoomName}=resolveLiveRoom(input,ctx.liveRooms);
   const incomingProofs=Array.isArray(input.proofs)&&input.proofs.length?input.proofs:null;
   if(incomingProofs){
    if(incomingProofs.length>3||incomingProofs.some(value=>typeof value!=='string'||!/^data:image\/(png|jpeg|webp);base64,/.test(value)))fail('凭证图片格式无效');
    claim.proofs=incomingProofs;
    claim.receiptRef='image:'+text(input.requestKey||claim.requestKey,'提交标识');
   }else if(!Array.isArray(claim.proofs)||!claim.proofs.length){
    fail('请上传 1 至 3 张付款截图或账单截图');
   }
   claim.claimType=claimType;
   claim.welfareCustomer=welfareCustomer;
   claim.category=input.category;
   claim.amount=money(amount);
   claim.expenseDate=expenseDate;
   claim.claimDate=today;
   claim.purpose=purpose;
   claim.note=note;
   claim.orderId=linkedOrder?.id||'';
   claim.orderRef=linkedOrder?.orderRef||'';
   claim.customerLabel=linkedOrder?.customerLabel||'';
   claim.orderDate=linkedOrder?.businessDate||'';
   claim.liveRoomId=liveRoomId;
   claim.liveRoomName=liveRoomName;
   claim.status='pending';
   claim.stage='finance';
   claim.forwardedBy=actor;
   claim.forwardedAt=now;
   claim.reviewNote='';
   claim.reviewedBy='';
   claim.reviewedAt='';
   claim.history.push({action:'resubmit',actor,at:now,version:claim.version});
   claim.version++;
   return next;
  }
  if(input.action==='updateTeam'){
   if(ctx.role==='cs'&&!['supervisor','supervisor_returned'].includes(claim.stage))fail('该报销单已提交财务，不能由客服修改组别',409);
   const teams=Array.isArray(ctx.teams)?ctx.teams:[];
   const pickedTeam=teams.find(t=>t.id===input.teamId);
   if(!pickedTeam)fail('所选客服组别无效或无权限');
   claim.teamId=pickedTeam.id;claim.department=pickedTeam.name;claim.history.push({action:'updateTeam',actor,at:now,version:claim.version});claim.version++;return next;
  }
  if(input.action==='bindOrder'){
   if(claim.claimType!=='welfare'||claim.orderId)fail('仅未关联订单的福利品报销可转绑新订单',409);
   if(claim.status==='rejected'||claim.status==='historical')fail('已退回或历史报销单不可转绑订单',409);
   const orders=Array.isArray(ctx.orders)?ctx.orders:[];
   const target=orders.find(o=>o.id===input.orderId);
   if(!target)fail('所选订单不存在或无权绑定');
   claim.claimType='business';
   claim.orderId=target.id;
   claim.orderRef=target.orderRef||'';
   claim.customerLabel=target.customerLabel||'';
   claim.orderDate=target.businessDate||'';
   if(claim.status==='approved'&&!claim.expenseId&&!claim.postedExpenseId)claim.postedExpenseId='reim-exp-'+claim.id;
   claim.history.push({action:'bindOrder',actor,at:now,version:claim.version});claim.version++;return next;
  }
  if(ctx.role==='cs')fail('客服只能发起报销',403);
  if(ctx.role==='cs_supervisor'){
   if(claim.stage!=='supervisor')fail('该报销单已处理',409);
   if(input.action==='forward'){claim.stage='finance';claim.forwardedBy=actor;claim.forwardedAt=now;}
   else if(input.action==='supervisorReturn'){claim.supervisorNote=text(input.reason,'退回说明',500);claim.stage='supervisor_returned';claim.status='rejected';}
   else fail('主管仅可提交财务或退回客服',403);
   claim.version++;return next;
  }
  if(claim.stage&&claim.stage!=='finance')fail('该报销单尚未提交财务',409);
  if(input.action==='review'){
   if(claim.status!=='pending')fail('该报销单已处理',409);
   if(!['approved','rejected'].includes(input.decision))fail('核对结果无效');
   if(input.decision==='approved'&&claim.expenseId){const e=expenses.find(e=>e.id===claim.expenseId&&!e.voided_at);if(!e||e.pending_cny==null||cents(claim.amount)>cents(e.pending_cny))fail('关联费用待付余额已变化，请核对');}
   claim.status=input.decision;claim.reviewNote=text(input.reason,'核对说明',500);claim.reviewedBy=actor;claim.reviewedAt=now;
   if(input.decision==='approved'&&claim.claimType==='business'&&claim.orderId&&!claim.expenseId&&!claim.postedExpenseId)claim.postedExpenseId='reim-exp-'+claim.id;
  }else if(input.action==='pay'){
   if(claim.status!=='approved')fail('请先核对确认报销单');
   const reference=text(input.reference,'付款流水号');if(next.payments.some(p=>p.reference===reference)||(ctx.references||[]).includes(reference))fail('该付款流水号已登记');
   const paid=next.payments.filter(p=>p.claimId===claim.id).reduce((n,p)=>n+cents(p.amount),0n),amount=cents(input.amount);
   if(amount<=0n||amount+paid>cents(claim.amount))fail('付款金额超过剩余待报销金额');
   if(claim.expenseId){const e=expenses.find(e=>e.id===claim.expenseId&&!e.voided_at);if(!e||e.pending_cny==null||amount>cents(e.pending_cny))fail('付款金额超过关联费用剩余待付');}
   const paidOn=date(input.date,today);if(paidOn<claim.expenseDate)fail('付款日期不能早于费用日期');
   next.payments.push({id,claimId:claim.id,amount:money(amount),date:paidOn,payee:text(input.payee,'实际收款人'),account:text(input.account,'公司付款账户'),reference,createdBy:actor,createdAt:now});
  }else fail('不支持此操作',405);
  claim.history.push({action:input.action,actor,at:now,version:claim.version});claim.version++;return next;
 }
 return{categories,cents,money,apply};
});
