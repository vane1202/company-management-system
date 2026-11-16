const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const script=fs.readFileSync(require('node:path').join(__dirname,'readonly-api.js'),'utf8');
test('财务报销登记核对分次付款独立汇总，不增加运营成本或重复业务成本',async()=>{
 const store=new Map(),f=environment('finance','',undefined,store),boss=environment('boss','',undefined,store),path='/api/demo/reimbursements';
 const expense=(await f.json('/api/finance/payables')).body.expenses.find(e=>e.id==='demo-expense-0'),date=expense.business_date;
 const before=(await boss.json('/api/demo/boss-priority')).body.expenses;
 const input={action:'create',claimant:'演示员工',department:'演示小组',category:'temporary',purpose:'临时支出报销',amount:'100.00',expenseDate:date,claimDate:date,expenseId:'',receiptRef:'REIM-01',note:'测试',requestKey:'reim-key-1'};
 for(const role of ['boss','warehouse','admin','cs_supervisor','cs','editor','ops']){
  assert.equal((await environment(role).json(path)).status,403);assert.equal((await environment(role).json(path,'POST',input)).status,403);
 }
 assert.equal((await f.json(path,'POST',{...input,amount:'-1'})).status,400);
 assert.equal((await f.json(path,'POST',{...input,expenseDate:'2026-02-30'})).status,400);
 const created=await f.json(path,'POST',input);assert.equal(created.status,200);let claim=created.body.state.claims[0];
 assert.equal((await f.json(path,'POST',input)).body.state.claims.length,1);
 assert.equal((await f.json(path,'POST',{...input,requestKey:'another-key'})).status,400);
 const pay={action:'pay',id:claim.id,version:1,amount:'40.00',date,payee:'演示员工',account:'公司账户',reference:'REIM-PAY-1'};
 assert.equal((await f.json(path,'POST',pay)).status,400);
 let r=await f.json(path,'POST',{action:'review',id:claim.id,version:1,decision:'approved',reason:'凭证已核对'});assert.equal(r.status,200);
 assert.equal((await f.json(path,'POST',pay)).status,409);
 r=await f.json(path,'POST',{...pay,version:2});assert.equal(r.status,200);assert.equal(r.body.state.payments[0].amount,'40.00');
 assert.equal((await f.json(path,'POST',{...pay,version:3,amount:'61.00',reference:'OVER'})).status,400);
 assert.equal((await f.json(path,'POST',{...pay,version:3})).status,400);
 assert.equal((await f.json(path,'POST',{...pay,version:3,reference:'DEMO-SUP-PAY-001'})).status,400);
 r=await f.json(path,'POST',{...pay,version:3,amount:'60.00',reference:'REIM-PAY-2'});assert.equal(r.status,200);
 assert.equal((await environment('finance','',undefined,store).json(path)).body.state.payments.length,2);
 assert.deepEqual((await boss.json('/api/demo/boss-priority')).body.expenses,before);
 const base=(await f.json('/api/finance/payables')).body.summary.costCny;
 r=await f.json(path,'POST',{...input,requestKey:'linked-key',receiptRef:'REIM-LINK-1',expenseId:expense.id,amount:expense.pending_cny});assert.equal(r.status,200);claim=r.body.state.claims.at(-1);
 await f.json(path,'POST',{action:'review',id:claim.id,version:1,decision:'approved',reason:'原费用关联核对'});
 r=await f.json(path,'POST',{...pay,id:claim.id,version:2,amount:expense.pending_cny,reference:'REIM-LINK-PAY'});assert.equal(r.status,200);
 const current=(await f.json('/api/finance/payables')).body;assert.equal(current.summary.costCny,base);assert.equal(current.expenses.find(e=>e.id===expense.id).pending_cny,'0.00');
 assert.equal((await f.json(path,'DELETE')).status,405);assert.equal(f.network()+boss.network(),0);
});
test('库房提交、财务审核分次付款共享台账，关联成本不重复，新成本审核后入账',async()=>{
 const store=new Map(),w=environment('warehouse','',undefined,store),f=environment('finance','',undefined,store),boss=environment('boss','',undefined,store),path='/api/demo/warehouse';
 const initial=(await w.json(path)).body,expense=initial.expenses.find(e=>e.id==='demo-expense-0');
 assert.equal((await w.json('/api/finance')).status,403);assert.equal((await w.json('/api/salaries')).status,403);
 for(const role of ['boss','admin','cs_supervisor','cs','editor','ops'])assert.equal((await environment(role).json(path)).status,403);
 const date=expense.business_date,input={action:'create',orderId:expense.order_id,expenseId:expense.id,category:expense.category,label:expense.label,counterparty:'演示供货方',amount:expense.pending_cny,date,materialRef:'D-001',proof:'P-001',note:'测试库房',requestKey:'request-1'};
 assert.equal((await f.json(path,'POST',input)).status,403);
 assert.equal((await w.json(path,'POST',{...input,amount:'9999'})).status,400);
 const created=await w.json(path,'POST',input);assert.equal(created.status,200);assert.equal(created.body.state.bills.length,1);
 assert.equal((await w.json(path,'POST',input)).body.state.bills.length,1);
 assert.equal((await w.json(path,'POST',{...input,requestKey:'request-duplicate'})).status,400);
 let bill=created.body.state.bills[0];
 assert.equal((await w.json(path,'POST',{action:'review',id:bill.id,version:1,decision:'approved',reason:'核对'})).status,403);
 assert.equal((await f.json(path,'POST',{action:'pay',id:bill.id,version:1,amount:'1.00',date,payee:'供货方',account:'公司',reference:'X'})).status,400);
 let r=await f.json(path,'POST',{action:'review',id:bill.id,version:1,decision:'approved',reason:'已核对原成本'});assert.equal(r.status,200);
 assert.equal((await f.json(path,'POST',{action:'review',id:bill.id,version:1,decision:'approved',reason:'重复'})).status,409);
 const base=(await boss.json('/api/finance/payables')).body.summary.costCny;
 const pay={action:'pay',id:bill.id,version:2,amount:'100.00',date,payee:'供货方',account:'公司账户',reference:'WAREHOUSE-PAY-1'};
 r=await f.json(path,'POST',pay);assert.equal(r.status,200);assert.equal(r.body.state.payments.length,1);
 assert.equal((await f.json(path,'POST',{...pay,version:3,amount:'99999.00',reference:'OVER'})).status,400);
 assert.equal((await f.json(path,'POST',{...pay,version:3})).status,400);
 const current=(await boss.json('/api/finance/payables')).body;assert.equal(current.summary.costCny,base);assert.equal(current.expenses.find(e=>e.id===expense.id).paid_cny,'700.00');
 assert.equal((await w.json(path)).body.state.payments[0].amount,'100.00');
 const newBill=await w.json(path,'POST',{...input,expenseId:'',category:'sourcing',amount:'400.00',proof:'NEW-2',materialRef:'D-002',requestKey:'request-2'});
 bill=newBill.body.state.bills.at(-1);
 assert.equal((await boss.json('/api/finance/payables')).body.summary.costCny,base);
 r=await f.json(path,'POST',{action:'review',id:bill.id,version:1,decision:'approved',reason:'新成本已核对'});assert.equal(r.status,200);
 const cents=v=>Math.round(Number(v)*100);assert.equal(cents((await boss.json('/api/finance/payables')).body.summary.costCny),cents(base)+40000);
 assert.ok((await f.json('/api/order-records/'+expense.order_id)).body.expenses.some(e=>e.id==='warehouse-exp-'+bill.id));
 assert.equal(w.network()+f.network()+boss.network(),0);
});
test('订单跟进仅本组主管可写，保存备注不改变收款，版本冲突与非法日期拒绝',async()=>{
 const storage=new Map(),e=environment('cs_supervisor','',undefined,storage),path='/api/demo/order-followups';
 const before=(await e.json('/api/order-records/demo-order-2')).body;
 const input={orderId:'demo-order-2',version:0,note:'已联系客户，约定再次确认',nextContactOn:''};
 assert.equal((await e.json(path,'POST',{...input,orderId:'demo-order-3'})).status,404);
 for(const role of ['boss','admin','finance','cs','ops','editor']){
  assert.equal((await environment(role).json(path)).status,403);
  assert.equal((await environment(role).json(path,'POST',input)).status,403);
 }
 assert.equal((await e.json(path,'POST',{...input,nextContactOn:'2026-02-30'})).status,400);
 assert.equal((await e.json(path,'POST',{...input,nextContactOn:'2020-01-01'})).status,400);
 assert.equal((await e.json(path,'POST',{...input,note:''})).status,400);
 const saved=await e.json(path,'POST',{...input,paid:'2300.00',status:'settled'});
 assert.equal(saved.status,200);assert.equal(saved.body.records[0].version,1);
 assert.equal((await e.json(path,'POST',input)).status,409);
 const second=await e.json(path,'POST',{...input,version:1,note:'第二次联系'});
 assert.equal(second.body.records[0].version,2);assert.equal(second.body.records[0].history[0].note,input.note);
 assert.equal((await environment('cs_supervisor','',undefined,storage).json(path)).body.records[0].note,'第二次联系');
 const after=(await e.json('/api/order-records/demo-order-2')).body;
 assert.deepEqual(after.payments,before.payments);assert.equal(after.balance,before.balance);
 assert.equal((await e.json(path,'DELETE')).status,405);
 assert.equal(e.network(),0);
});
function environment(role,pathname="",directory,storage=new Map(),adLinks=[]){
 let networkRequests=0;
 const window={location:{origin:'https://fictional.example',search:role?'?role='+role:'',pathname,assign(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},fetch:async()=>{networkRequests++;throw Error('Unexpected backend network request');}};
 window.CmsBossOverview=require('./boss-overview-metrics.js');
 window.CmsOpsAnalysis=require('./ops-analysis-metrics.js');
 window.CmsLiveRoomOperations=require('./live-room-operations.js');
 window.CmsOpsWorkspace=require('./ops-workspace.js');
 window.CmsBossPriority=require('./boss-priority.js');
 window.CmsWarehouse=require('./warehouse-settlements.js');
 window.CmsReimbursements=require('./reimbursements.js');
 window.CmsEditorHistory=require('./editor-history.js');
 window.CmsSupervisorConsultationCost=require('./supervisor-consultation-cost.js');
 window.CmsSupervisorAdLinks=adLinks;
 window.CmsAssessmentFoundation=require('./assessment-foundation.js');
 window.CmsServiceAccountManagement=require('./service-account-management.js');
 if(directory)window.CmsServiceDirectory=directory;
 vm.runInNewContext(script,{window,document:{addEventListener(){}},URL,URLSearchParams,Response,Date});
 return {fetch:window.fetch,json:async(path,method='GET',body)=>{const response=await window.fetch(path,{method,body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},network:()=>networkRequests};
}

test('BOSS优先卡片与财务日常费用只读写隔离，私推纳入总业绩且费用与广告分开',async()=>{
 const storage=new Map(),boss=environment('boss','',undefined,storage),finance=environment('finance','',undefined,storage);
 const initial=await boss.json('/api/demo/boss-priority?preset=day');assert.equal(initial.status,200);assert.equal(initial.body.performance.total,'2370.50');assert.equal(initial.body.performance.private,'600.00');
 assert.equal(initial.body.expenses.registered,null);
 const date=initial.body.period.to,input={date,category:'utilities',amount:'100.00',purpose:'办公室电费',operator:'财务',proof:'P-01'};
 assert.equal((await boss.json('/api/demo/daily-expenses','POST',input)).status,403);
 assert.equal((await finance.json('/api/demo/daily-expenses','POST',input)).status,200);
 assert.equal((await boss.json('/api/demo/boss-priority?preset=day')).body.expenses.registered,'100.00');
 for(const role of ['admin','cs','cs_supervisor','ops','editor']){
  assert.equal((await environment(role).json('/api/demo/boss-priority')).status,403);
  assert.equal((await environment(role).json('/api/demo/daily-expenses','POST',input)).status,403);
 }
 assert.equal((await finance.json('/api/demo/boss-priority')).status,403);
 assert.equal((await finance.json('/api/demo/daily-expenses','POST',{...input,category:'salary'})).status,400);
 assert.equal(boss.network()+finance.network(),0);
});

test('拍剪本人历史可读改，拒绝修改其他老师记录及通用管理接口',async()=>{
 const e=environment('editor');
 assert.equal((await e.json('/api/demo/editor-history')).status,403);
 assert.equal((await e.json('/api/demo/editor-identity','POST',{editor:'魏磊'})).status,200);
 const first=(await e.json('/api/demo/editor-history')).body.records;
 assert.ok(first.length&&first.every(record=>record.editorName==='魏磊'));
 const original=first[0];
 const saved=await e.json('/api/demo/editor-history','POST',{id:original.id,version:original.version,businessDate:original.businessDate,lines:original.lines.map((line,i)=>({...line,editCount:i===0?8:line.editCount})),reason:'核验补录',editorName:'尚杰'});
 assert.equal(saved.status,200);assert.equal(saved.body.records[0].editorName,'魏磊');assert.equal(saved.body.records[0].version,2);
 assert.equal(saved.body.records[0].history.at(-1).before.lines[0].editCount,original.lines[0].editCount);
 await e.json('/api/demo/editor-identity','POST',{editor:'尚杰'});
 assert.ok((await e.json('/api/demo/editor-history')).body.records.every(record=>record.editorName==='尚杰'));
 assert.equal((await e.json('/api/demo/editor-history','POST',{id:original.id,version:2,businessDate:original.businessDate,lines:original.lines,reason:'越权'})).status,400);
 for(const role of ['boss','cs','cs_supervisor','ops','admin','finance']){assert.equal((await environment(role).json('/api/demo/editor-history')).status,403);assert.equal((await environment(role).json('/api/demo/editor-identity','POST',{editor:'魏磊'})).status,403);}
 assert.equal((await e.json('/api/demo/editor-history','DELETE')).status,405);
 assert.equal((await e.json('/api/editor-reports','POST',{})).status,403);
 assert.equal(e.network(),0);
});

test('主管咨询成本只读且限本组，未关联不回退公司总数，已关联与运营口径一致',async()=>{
 const path='/api/demo/supervisor-consultation-cost';
 const missing=await environment('cs_supervisor').json(path);
 assert.equal(missing.status,200);assert.equal(missing.body.current.status,'unlinked');assert.equal(missing.body.current.spendUsd,null);
 const linked=environment('cs_supervisor','',undefined,new Map(),[{teamId:'demo-team-a',account:'DEMO-ADS-01',from:'2026-01-01'}]);
 const scoped=await linked.json(path);
 assert.equal(scoped.body.current.spendUsd,'22.20');assert.equal(scoped.body.current.consultCount,5);
 const ops=(await environment('ops').json('/api/demo/ops-analysis?account=DEMO-ADS-01')).body;
 assert.equal(scoped.body.current.spendUsd,ops.summary.spendUsd);assert.equal(scoped.body.current.consultCount,ops.summary.consultCount);
 assert.equal(JSON.stringify(scoped.body).includes('DEMO-ADS-02'),false);
 assert.equal((await linked.json(path+'?teamId=demo-team-b')).status,403);
 assert.equal((await linked.json(path+'?date=2026-02-30')).status,400);
 assert.equal((await linked.json(path,'POST',{})).status,403);
 for(const role of ['ops','boss','admin','finance','cs'])assert.equal((await environment(role).json(path)).status,403);
 assert.equal(linked.network(),0);
});

test('四位运营身份、账户范围和反馈按人员隔离，禁止越权及伪造作者', async () => {
 const storage=new Map(),first=environment('ops','',undefined,storage);
 const workspace=(await first.json('/api/demo/ops-workspace')).body;
 assert.deepEqual(workspace.people.map(p=>p.name),['子恒','小蒲','代运营A','代运营B']);
 assert.equal(workspace.accounts.length,2);assert.equal(workspace.loginEnabled,false);
 const today=(await first.json('/api/auth/me')).body.today;
 const input={account:workspace.accounts[0].id,persona:workspace.accounts[0].personas[0],date:today,from:today,to:today,category:'strategy',problem:'测试观察',suggestion:'测试建议',authorId:'forged',authorName:'冒充他人',attachments:[]};
 const saved=await first.json('/api/demo/ops-feedback','POST',input);
 assert.equal(saved.status,200);assert.equal(saved.body.records[0].authorName,'子恒');
 const id=saved.body.records[0].id;
 const second=environment('ops&operator=demo-ops-xiaopu','',undefined,storage);
 assert.equal((await second.json('/api/auth/me')).body.user.displayName,'小蒲');
 assert.equal((await second.json('/api/demo/ops-feedback')).body.records.length,0);
 assert.equal((await second.json('/api/demo/ops-feedback','POST',{kind:'followup',id,status:'done',followup:'越权'})).status,404);
 assert.equal((await second.json('/api/demo/ops-feedback','POST',input)).status,400);
 const rows=(await second.json('/api/ops-reports')).body.reports;
 assert.ok(rows.every(row=>row.userId==='demo-ops-xiaopu'&&row.adAccountRef.startsWith('DEMO-XP-')));
 assert.ok((await second.json('/api/ad-accounts')).body.accounts.every(a=>a.code.startsWith('DEMO-XP-')));
 const returned=environment('ops&operator=demo-ops','',undefined,storage);
 assert.equal((await returned.json('/api/demo/ops-feedback')).body.records.length,1);
 assert.equal((await returned.json('/api/demo/ops-feedback','POST',{kind:'followup',id,status:'done',followup:'已调整素材并观察'})).status,200);
 for(const role of ['boss','admin','finance','cs_supervisor','cs']){
  assert.equal((await environment(role).json('/api/demo/ops-feedback')).status,403);
  assert.equal((await environment(role).json('/api/demo/ops-feedback','POST',input)).status,403);
 }
 assert.equal(returned.network()+second.network()+first.network(),0);
});

test('账号新增与交接只在演示会话内生效，权限与历史归属隔离', async () => {
 const directory={enabled:true,confirmedOn:'2026-11-13',version:'service-directory/v1',people:[{id:'old',name:'原客服'},{id:'next',name:'接手客服'}],team:{id:'scope',name:'本组',roomName:'海外一线',hostName:'主播'},accounts:[{id:'a',registeredHolderId:'old',holderName:'原客服',teamId:'scope',isActive:true,platform:'messenger',accountIdentifier:'10000000001'}]};
 const e=environment('cs_supervisor','',directory),today=(await e.json('/api/auth/me')).body.today;
 const before=(await e.json('/api/orders')).body;
 const created=await e.json('/api/demo/service-directory/manage','POST',{kind:'create',teamId:'scope',employeeId:'next',platform:'whatsapp',identifier:'+8613800000000',effectiveOn:today});
 assert.equal(created.status,200);assert.equal(created.body.directory.accounts.length,2);
 assert.equal((await e.json('/api/cs-accounts')).body.accounts.length,2);
 const moved=await e.json('/api/demo/service-directory/manage','POST',{kind:'handover',teamId:'scope',accountIds:['a'],employeeId:'next',effectiveOn:today,reason:'离职',markLeft:true});
 assert.equal(moved.status,200);assert.equal(moved.body.directory.accounts[0].registeredHolderId,'next');
 assert.equal((await e.json('/api/demo/service-directory')).body.managementHistory.length,2);
 assert.deepEqual((await e.json('/api/orders')).body,before);
 assert.equal(directory.accounts[0].registeredHolderId,'old');
 for(const role of ['cs','boss','finance','ops'])assert.equal((await environment(role,'',directory).json('/api/demo/service-directory/manage','POST',{kind:'reset'})).status,403);
 assert.equal((await e.json('/api/demo/service-directory/manage','POST',{kind:'handover',teamId:'other',effectiveOn:today})).status,400);
 assert.equal((await e.json('/api/demo/service-directory/manage','POST',{kind:'reset'})).body.directory.accounts.length,1);
 assert.equal(e.network(),0);
});

test('客服填报演示提供固定接待账号，不创建客服员工账号且拒绝业务写入和管理读取',async()=>{
 const e=environment('cs');
 assert.equal((await e.json('/api/auth/me')).body.user.role,'cs');
 const accounts=await e.json('/api/cs-accounts');assert.equal(accounts.status,200);assert.equal(accounts.body.accounts.length,3);
 assert.ok(accounts.body.accounts.every(a=>['whatsapp','messenger'].includes(a.platform)));
 for(const path of ['/api/orders','/api/finance','/api/salaries','/api/admin/users'])assert.equal((await e.json(path)).status,403);
 for(const path of ['/api/order-records','/api/fan-reports','/api/order-records/1/expenses'])assert.equal((await e.json(path,'POST',{amount:'600'})).status,403);
 const admin=environment('admin');assert.ok(!(await admin.json('/api/admin/users')).body.users.some(u=>u.role==='cs'&&u.accountKind==='employee'));
 assert.equal(e.network(),0);
});

test('经营看板分开当期开单进度和历史待收款，保持原币且不受结汇影响',async()=>{
 const e=environment('boss'),data=(await e.json('/api/dashboard/live-business')).body;
 assert.equal(data.operations.summary.total,2);
 assert.equal(data.operations.summary.partial,1);assert.equal(data.operations.summary.settled,1);
 assert.equal(data.operations.summary.followupCount,2);
 const pending=data.operations.orders.find(o=>o.id==='demo-order-2');
 assert.equal(pending.balance,'2000.00');assert.equal(pending.currency,'TWD');
 const historical=data.operations.orders.find(o=>o.id==='demo-order-6');
 assert.equal(historical.bookedInPeriod,false);assert.equal(historical.status,'unpaid');
 assert.equal(data.operations.orders.find(o=>o.id==='demo-order-3').status,'settled');
 assert.ok(!data.operations.orders.some(o=>['demo-order-4','demo-order-5'].includes(o.id)));
 const only=(await e.json('/api/dashboard/live-business?room=DEMO-LIVE-02')).body;
 assert.equal(only.operations.summary.total,0);assert.equal(only.operations.summary.followupCount,0);
 assert.equal(only.ads.scope,'company');assert.equal(only.ads.spendUsd,data.ads.spendUsd);
 assert.equal(e.network(),0);
});

test('按主播筛选不因财务人员费用补入无关直播间，无匹配时返回空看板',async()=>{
 const e=environment('boss');
 const one=(await e.json('/api/dashboard/live-business?host='+encodeURIComponent('甜甜'))).body;
 assert.deepEqual(one.rooms.map(r=>r.key),['DEMO-LIVE-01']);
 assert.ok(one.operations.orders.every(o=>o.hostName==='甜甜'));
 const none=(await e.json('/api/dashboard/live-business?host=NO_MATCH')).body;
 assert.equal(none.rooms.length,0);assert.equal(none.operations.summary.total,0);
 assert.equal(none.operations.orders.length,0);assert.equal(none.ads.spendUsd,'29.20');
});

test('直播间人员成本不按主播、人设或客服维度推测分摊，日期和直播间筛选仍可核算',async()=>{
 const e=environment('boss'),all=(await e.json('/api/dashboard/live-business')).body;
 const option=all.options.find(o=>o.room==='DEMO-LIVE-01');
 for(const key of ['host','persona','operator']){
  assert.ok(option[key]);
  const filtered=(await e.json('/api/dashboard/live-business?'+key+'='+encodeURIComponent(option[key]))).body;
  const room=filtered.rooms.find(r=>r.key==='DEMO-LIVE-01');
  assert.ok(room);
  assert.equal(room.profit.status,'unsupported_scope');
  assert.equal(room.profit.staff.totalCny,null);
  assert.equal(room.profit.liveRoomProfitCny,null);
  assert.equal(room.profit.staff.actorSessionFee.value,null);
 }
 const roomOnly=(await e.json('/api/dashboard/live-business?room=DEMO-LIVE-01')).body;
 assert.equal(roomOnly.rooms[0].profit.staff.totalCny,'240.00');
 assert.equal(roomOnly.rooms[0].profit.liveRoomProfitCny,'230.50');
 assert.equal(e.network(),0);
});

test('P0独立演示首屏与原明细逐笔一致；原币保留；正式后台零请求',async()=>{
 const e=environment('boss'),d=(await e.json('/api/demo/boss-overview')).body;
 const old=(await e.json('/api/dashboard/live-business')).body;
 assert.equal(d.version,'boss-overview-p0/v1');assert.equal(d.metrics.turnover.value,old.totals.performanceCny);assert.equal(d.privatePush.amount,'600.00');assert.equal(d.privatePush.count,1);assert.equal(d.ledger.some(row=>row.bucket==='excludedBooking'&&row.label==='DEMO-P-001'),true);
  assert.equal(d.metrics.receipts.value,'2538.50');assert.equal(d.metrics.visibleCost.value,'325.24');assert.equal(d.metrics.estimatedContribution.value,'2213.26');assert.equal(d.metrics.roi.value,'12.07');
  assert.equal(d.metrics.roi.unit,'倍');
  assert.equal(d.costBreakdown.visibleBusiness.value,'115.00');assert.equal(d.costBreakdown.advertising.value,'210.24');assert.equal(d.costBreakdown.excludedMaterial.value,'1300.00');
  assert.equal(d.receiptSplit.currentBookings.value,'1530.50');assert.equal(d.receiptSplit.historicalOrders.value,'1008.00');
  assert.equal(d.collectionGap.difference,'1248.00');assert.equal(d.collectionGap.paidPerformance,'1290.50');
  assert.equal(d.references.registeredMaterialCost.value,'1300.00');
  assert.ok(d.references.monthToDateRoi && d.references.monthToDateRoi.unit==='倍');
  assert.match(d.metrics.roi.definition,/日 ROI 仅供参考/);
  assert.match(d.metrics.visibleCost.definition,/主播薪酬是否计入原直播间费用：待确认/);
  assert.match(d.metrics.estimatedContribution.definition,/毛利（估）不是公司净利润/);
  assert.match(d.metrics.estimatedContribution.definition,/未扣料成本、提成、代收手续费/);
  assert.equal(d.ledger.filter(r=>r.bucket==='excludedCost').reduce((n,r)=>n+Math.round(Number(r.amount)*100),0),130000);
 assert.equal(d.finalContribution.status,'pending_finance');assert.equal(d.target,null);
 for(const role of ['admin','finance','cs_supervisor'])assert.equal((await environment(role).json('/api/demo/boss-overview')).status,403);
 assert.equal((await e.json('/api/demo/boss-overview','POST',{amount:'1.00'})).status,403);
 for(const q of ['from=2026-02-30&to=2026-03-01','from=2026-01-01','preset=bad','from=2099-01-01&to=2099-01-01'])assert.equal((await e.json('/api/demo/boss-overview?'+q)).status,400);
 assert.equal(e.network(),0);
});

test('投放分析与P0共用日报：29.20/6/4.87/180，余额按账户去重',async()=>{
 const e=environment('boss'),d=(await e.json('/api/demo/ops-analysis')).body;
 assert.equal(d.version,'ops-analysis/v1');assert.equal(d.summary.spendUsd,'29.20');assert.equal(d.summary.consultCount,6);assert.equal(d.summary.consultationCostUsd,'4.87');assert.equal(d.summary.clickCount,180);assert.equal(d.summary.spendCny,'210.24');assert.equal(d.balances.totalUsd,'120.80');assert.equal(d.balances.accounts.length,2);assert.equal(d.groups.length,4);
 const p=(await e.json('/api/demo/boss-overview')).body;
 assert.equal(p.ledger.filter(r=>r.kind==='ad').reduce((n,r)=>n+Math.round(Number(r.amount)*100),0),2920);assert.equal(p.metrics.estimatedContribution.value,'2213.26');
 const f=(await e.json('/api/demo/ops-analysis?platform=Facebook')).body;assert.equal(f.summary.spendUsd,'22.20');assert.equal(f.summary.consultationCostUsd,'4.44');assert.equal(f.balances.totalUsd,'100.80');
 const z=(await e.json('/api/demo/ops-analysis?persona='+encodeURIComponent('演示主页 D'))).body;assert.equal(z.summary.spendUsd,'0.00');assert.equal(z.summary.costStatus,'no_spend');
 const dayMissing=d.trend.days.find(r=>r.recordCount===0);assert.ok(dayMissing);assert.equal(dayMissing.spendUsd,null);
 const dash=(await e.json('/api/dashboard/summary')).body;assert.equal(dash.metrics.opsUsd.endingBalanceUsd,'120.80');
 for(const role of ['admin','finance','cs_supervisor'])assert.equal((await environment(role).json('/api/demo/ops-analysis')).status,403);
 assert.equal((await e.json('/api/demo/ops-analysis','POST',{})).status,403);assert.equal((await e.json('/api/demo/ops-analysis?dimension=constructor')).status,400);assert.equal(e.network(),0);
});
test('财务专项核定与营业额独立；历史未分类收款不冒充售后收入',async()=>{
 const e=environment('boss'),today=(await e.json('/api/auth/me')).body.today;
 const d=(await e.json('/api/dashboard/live-business?from='+today+'&to='+today)).body;
 assert.equal(d.totals.performanceCny,'1770.50');assert.equal(d.paidPerformance.amountCny,'1290.50');
 assert.equal(d.afterSales.recordCount,0);assert.equal(d.afterSales.unclassifiedReceiptCount,3);
 for(const role of ['boss','finance'])assert.equal((await environment(role).json('/api/finance/live-performance')).status,200);
 for(const role of ['admin','cs_supervisor'])assert.equal((await environment(role).json('/api/finance/live-performance')).status,403);
 assert.equal((await environment('finance').json('/api/finance/live-performance','POST',{})).status,403);
 assert.equal(e.network(),0);
});
test('主管首页营业额与BOSS营业额同口径：不含追加收费、扣除跑单与退款标记源单',async()=>{
 const boss=environment('boss'),sup=environment('cs_supervisor'),today=(await boss.json('/api/auth/me')).body.today;
 const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 for(const day of [today,yesterday]){
  const mine=(await sup.json(`/api/orders?from=${day}&to=${day}`)).body,ids=new Set(mine.orders.map(o=>o.id));
  const live=(await boss.json(`/api/dashboard/live-business?from=${day}&to=${day}`)).body;
  const sales=live.events.filter(e=>e.kind==='sale'&&ids.has(e.order_id)&&!e.order.cancelled&&e.order.status!=='refunded');
  const liveExpected=(sales.reduce((n,e)=>n+Math.round(Number(e.amount)*100),0)/100).toFixed(2);
  const privateRows=mine.orders.filter(o=>o.dealChannel==='private'&&!o.cancelled&&o.status!=='refunded');
  const privateExpected=(privateRows.reduce((n,o)=>n+Math.round(Number(o.bookingAmount)*100),0)/100).toFixed(2);
  const combined=((Math.round(Number(liveExpected)*100)+Math.round(Number(privateExpected)*100))/100).toFixed(2);
  assert.equal(live.events.some(e=>e.order_id==='demo-order-7'),false,day);
  assert.equal(mine.totals.turnover,combined,day);assert.equal(mine.totals.turnoverCount,sales.length+privateRows.length,day);
 }
 const t=(await sup.json(`/api/orders?from=${today}&to=${today}`)).body.totals;assert.equal(t.turnover,'2370.50');assert.equal(t.amount,'2570.50');
 const y=(await sup.json(`/api/orders?from=${yesterday}&to=${yesterday}`)).body.totals;assert.deepEqual([y.turnover,y.cancelled,y.turnoverCount],['550.00','330.00',1]);
 const cancelled=(await sup.json('/api/order-records/demo-order-5')).body;assert.equal(cancelled.order.cancelled,true);assert.equal(cancelled.cancellations.length,1);
 assert.equal((await sup.json('/api/order-records/demo-order-6/cancellations','POST',{version:1,reason:'演示'})).status,403);
 assert.equal(sup.network(),0);assert.equal(boss.network(),0);
});
test('线索演示按接待账号与承接日期隔离，旧客今日明确需求仍归原批次',async()=>{
 const boss=environment('boss'),today=(await boss.json('/api/auth/me')).body.today;
 const a=(await boss.json('/api/fan-leads?from='+today+'&to='+today)).body;
 assert.equal(a.leads.length,12);assert.equal(a.leads.filter(l=>l.qualifiedOn===l.receivedOn).length,4);assert.equal(a.reports.reduce((n,r)=>n+r.addedCount,0),12);
 const sup=(await environment('cs_supervisor').json('/api/fan-leads')).body;assert.equal(sup.leads.length,7);assert.ok(sup.leads.every(l=>l.wechatId==='Messenger · demo.messenger.01'));
 assert.equal((await environment('admin').json('/api/fan-leads')).status,403);assert.equal((await environment('finance').json('/api/fan-leads')).status,403);
 assert.equal((await boss.json('/api/fan-leads','POST',{})).status,403);assert.equal(boss.network(),0);
 const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10),old=(await boss.json('/api/fan-leads?from='+yesterday+'&to='+yesterday)).body;
 assert.equal(old.leads.length,4);assert.equal(old.leads.filter(l=>l.qualifiedOn===today).length,1);
});
test('public preview identities are fictional and business access follows the preview role',async()=>{
 for(const role of ['boss','admin','cs_supervisor','finance']){const e=environment(role);const me=await e.json('/api/auth/me');assert.equal(me.body.user.role,role);assert.ok(me.body.user.username.startsWith('demo_'));assert.equal(e.network(),0);}
 const admin=environment('admin');assert.equal((await admin.json('/api/admin/users')).status,200);
 for(const path of ['/api/orders','/api/fan-reports/summary','/api/dashboard/summary','/api/salaries'])assert.equal((await admin.json(path)).status,403);
});
test('supervisor sees one fictional group and cannot query another fictional account',async()=>{
 const e=environment('cs_supervisor');const orders=await e.json('/api/orders');assert.equal(orders.body.orders.length,5);assert.ok(orders.body.orders.every(row=>row.userId==='demo-wechat-1'));assert.deepEqual(orders.body.totals,{amount:'3450.50',refunds:'0.00',cancelled:'330.00',turnover:'2920.50',turnoverCount:4});const pushed=orders.body.orders.find(row=>row.orderRef==='DEMO-P-001');assert.equal(pushed.dealChannel,'private');assert.equal(pushed.bookingAmount,'600.00');assert.equal(pushed.liveRoomCode,'');
 assert.deepEqual((await e.json('/api/orders?userId=demo-wechat-2')).body.orders,[]);assert.equal((await e.json('/api/cs-accounts')).body.accounts.length,2);const fans=(await e.json('/api/fan-reports/summary')).body.teams;assert.equal(fans.length,1);assert.equal(fans[0].expectedCount,2);assert.equal(fans[0].reportedCount,1);assert.deepEqual(fans[0].missing.map(m=>m.displayName),['Messenger · demo.messenger.03']);assert.equal(fans[0].totalAdded,7);assert.equal((await e.json('/api/admin/users')).status,403);
});
test('BOSS filters dates/statuses and uses the latest monthly snapshot rather than summing snapshots',async()=>{
 const e=environment('boss');const meta=(await e.json('/api/auth/me')).body;const today=meta.today;
 const day=(await e.json('/api/dashboard/summary')).body;assert.deepEqual(day.period,{from:today,to:today});assert.equal(day.metrics.revenue,'2150.50');assert.equal(day.metrics.refunds,'180.00');
 const from=today.slice(0,7)+'-01';const period=(await e.json('/api/dashboard/summary?from='+from+'&to='+today)).body;assert.equal(period.metrics.msMonth,216);assert.equal(period.metrics.wsMonth,83);
 const filtered=(await e.json('/api/orders?status=refunded')).body;assert.equal(filtered.orders.length,1);assert.deepEqual(filtered.totals,{amount:'180.00',refunds:'180.00',cancelled:'0.00',turnover:'0.00',turnoverCount:0});
});
test('all preview writes are refused and never contact the actual backend',async()=>{
 for(const role of ['admin','boss','cs_supervisor','finance']){const e=environment(role);for(const path of ['/api/orders','/api/cs-accounts/registration-codes','/api/admin/users','/api/modules','/api/admin/settings','/api/finance/settlements','/api/order-records']){assert.equal((await e.json(path,'POST',{role:'boss',amount:'999.00'})).status,403);}assert.equal(e.network(),0);}
});
test('finance preview separates customer credit from settlement and reads order costs for commission',async()=>{
 const finance=environment('finance'),result=await finance.json('/api/finance');assert.equal(result.status,200);assert.equal(result.body.summary.totalCny,'1613.90');assert.deepEqual(result.body.summary.pending,{CNY:'0.00',TWD:'1200.00',USD:'90.00'});assert.equal((await finance.json('/api/order-records/demo-order-1')).status,200);assert.equal((await finance.json('/api/orders')).status,200);assert.equal((await finance.json('/api/admin/users')).status,403);
 const boss=environment('boss'),d=(await boss.json('/api/order-records/demo-order-3')).body;assert.equal(d.balance,'0.00');assert.equal(d.payments[0].pendingAmount,'90.00');assert.equal((await environment('cs_supervisor').json('/api/order-records/demo-order-3')).status,404);assert.equal(finance.network(),0);
});
test('fictional CSV export honors the selected group and account without a server',async()=>{
 const e=environment('cs_supervisor');const response=await e.fetch('/api/fan-reports/export');assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('Messenger · demo.messenger.01'));assert.ok(!text.includes('WhatsApp · +999000000002'));assert.equal(e.network(),0);
});
test('fictional payroll: finance and BOSS read the same payslips; others refused; writes refused',async()=>{
 const finance=environment('finance'),boss=environment('boss');const month=(await finance.json('/api/auth/me')).body.today.slice(0,7);
 const a=(await finance.json('/api/salaries/payroll?month='+month)).body,b=(await boss.json('/api/salaries/payroll?month='+month)).body;
 assert.deepEqual(a,b);assert.equal(a.totals.base,'16000.00');assert.equal(a.totals.net,'12480.50');assert.equal(a.totals.negativeCount,1);assert.equal(a.totals.lockedCount,1);
 const ops=a.employees.find(e=>e.userId==='demo-ops');assert.equal(ops.net,'7180.50');assert.equal(ops.status,'locked');
 const ed=a.employees.find(e=>e.userId==='demo-editor');assert.equal(ed.bonus,'300.00');assert.equal(ed.items.filter(i=>i.voided).length,1);
 assert.equal(a.employees.find(e=>e.userId==='demo-cs_supervisor').net,'-200.00');
 assert.equal((await finance.json('/api/salaries/payroll?month=bad')).status,400);
 assert.equal((await finance.json('/api/salaries/summary')).body.totalAllocated.length>0,true);
 for(const role of ['admin','cs_supervisor']){const e=environment(role);for(const path of ['/api/salaries','/api/salaries/payroll?month='+month,'/api/salaries/employees'])assert.equal((await e.json(path)).status,403);}
 for(const path of ['/api/salaries/payroll/items','/api/salaries/payroll/months/lock','/api/salaries'])assert.equal((await finance.json(path,'POST',{amount:'1.00'})).status,403);
 const dash=(await boss.json('/api/dashboard/summary?from='+month+'-01&to='+month+'-01')).body;assert.equal(dash.overallSalary.payrollItemsIncluded,false);
 assert.equal(finance.network()+boss.network(),0);
});
test('BOSS display inputs: effective order amount, missing reporters and payroll status split stay consistent',async()=>{
 const e=environment('boss');const d=(await e.json('/api/dashboard/summary')).body;
 const c=v=>Math.round(Number(v)*100);assert.equal(c(d.metrics.revenue)-c(d.metrics.refunds),197050);assert.equal(d.metrics.orderCount,2);
 const fans=(await e.json('/api/fan-reports/summary')).body.teams;assert.equal(fans.reduce((n,t)=>n+t.missingCount,0),1);assert.equal(fans.reduce((n,t)=>n+t.expectedCount,0),3);
 assert.equal(d.metrics.fanAddedTotal,12);
 const month=(await e.json('/api/auth/me')).body.today.slice(0,7);const p=(await e.json('/api/salaries/payroll?month='+month)).body;
 const sum=s=>p.employees.filter(x=>x.status===s).reduce((n,x)=>n+c(x.net),0);assert.equal(sum('locked'),718050);assert.equal(sum('draft'),530000);assert.equal(sum('locked')+sum('draft'),c(p.totals.net));
 assert.equal(e.network(),0);
});
test('P1 fictional 7-day fan series: per business day, gap day is null, today partial, BOSS only',async()=>{
 const e=environment('boss');const today=(await e.json('/api/auth/me')).body.today;
 const r=await e.json('/api/dashboard/series?to='+today+'&days=7');assert.equal(r.status,200);
 assert.equal(r.body.days.length,7);assert.equal(r.body.days.at(-1).date,today);assert.equal(r.body.days.at(-1).partial,true);
 assert.deepEqual(r.body.days.map(d=>d.fanAdded),[4,5,null,6,8,4,12]);
 assert.equal(r.body.days.at(-1).fanAdded,(await e.json('/api/dashboard/summary')).body.metrics.fanAddedTotal);
 assert.equal(r.body.days.filter(d=>d.partial).length,1);
 for(const q of ['days=0','days=32','days=x','to=2026-13-01'])assert.equal((await e.json('/api/dashboard/series?'+q)).status,400);
 for(const role of ['admin','cs_supervisor','finance'])assert.equal((await environment(role).json('/api/dashboard/series')).status,403);
 const from=today.slice(0,7)+'-01';const m=(await e.json('/api/dashboard/summary?from='+from+'&to='+today)).body.metrics;assert.equal(m.msMonth,216);assert.equal(m.wsMonth,83);
 assert.equal(e.network(),0);
});
test('P1 supervisor four-state inputs: states never exceed 加粉总数, the gap is left for the grey 未分类 segment',async()=>{
 const t=(await environment('cs_supervisor').json('/api/fan-reports/summary')).body.teams[0];
 const states=t.commReplied+t.commReadNoReply+t.commUnread+t.commInvalid;assert.equal(t.totalAdded,7);assert.equal(states,6);assert.ok(states<=t.totalAdded);
});

test('production fixture has three teachers and multiple personas without duplicating inventory',async()=>{
 const e=environment('boss'),rows=(await e.json('/api/editor-reports')).body.reports;
 assert.deepEqual([...new Set(rows.map(r=>r.editorName))],['魏磊','尚杰','十七']);
 for(const name of ['魏磊','尚杰','十七'])assert.equal(new Set(rows.filter(r=>r.editorName===name).map(r=>r.personaName)).size,2);
 assert.equal(rows.reduce((n,r)=>n+r.inventorySnapshot,0),18);
 assert.equal((await e.json('/api/dashboard/summary')).body.metrics.endingInventory,18);
});
test('sourcing charge, procurement payable, customer balance and actual supplier payment stay independent',async()=>{
 const e=environment('boss'),d=(await e.json('/api/order-records/demo-order-2')).body;
 assert.equal(d.charges[0].amount_cny,'200.00');assert.equal(d.expenses.find(x=>x.category==='sourcing').amount_cny,'250.00');assert.equal(d.details.customerDue,'3200.00');assert.equal(d.balance,'2000.00');
 for(const key of ['personaCode','liveRoomCode','hostName','customerCode','operatorName'])assert.ok(d.details[key]);
 const p=(await environment('finance').json('/api/finance/payables')).body;
 assert.equal(p.summary.costCny,'2045.00');assert.equal(p.summary.paidCny,'600.00');assert.equal(p.summary.pendingCny,'1445.00');
 assert.equal((await environment('cs_supervisor').json('/api/finance/payables')).status,403);assert.equal((await environment('admin').json('/api/ad-accounts')).status,403);
 const a=(await e.json('/api/ad-accounts')).body;assert.equal(a.summary.paidCny,'360.00');assert.equal(a.summary.spentUsd,'29.20');assert.equal(a.summary.balanceUsd,'120.80');
 for(const role of ['boss','finance'])for(const path of ['/api/finance/payables/payments','/api/ad-accounts/topups'])assert.equal((await environment(role).json(path,'POST',{})).status,403);
 assert.equal(e.network(),0);
});

test('BOSS business home counts a prior-day order charge and shipping on their own occurrence dates',async()=>{
 const e=environment('boss'),d=(await e.json('/api/dashboard/live-business')).body;
 assert.equal(d.totals.newSalesCny,'1770.50');assert.equal(d.totals.additionalCny,'300.00');assert.equal(d.totals.performanceCny,'1770.50');assert.equal(d.totals.expenseCny,'1415.00');assert.equal(d.totals.supplierPaidCny,'600.00');assert.equal(d.totals.newOrderCount,2);
 assert.equal(d.totals.excludedSourceCny,'180.00');assert.equal(d.totals.companyReceivedCny,'1613.90');assert.deepEqual(d.totals.customerReceipts,{CNY:'1290.50',TWD:'1200.00',USD:'140.00'});
 assert.equal(d.ads.spendUsd,'29.20');assert.equal(d.legacyCost.count,1);
 const prior=d.rooms.find(r=>r.key==='DEMO-LIVE-02');assert.equal(prior.totals.performanceCny,'0.00');assert.equal(prior.totals.expenseCny,'15.00');assert.equal(prior.totals.newOrderCount,0);
 assert.equal(d.rooms.find(r=>r.key==='DEMO-LIVE-01').personas.length,1);
 const sum=key=>d.rooms.reduce((n,r)=>n+Math.round(Number(r.totals[key])*100),0);assert.equal(sum('performanceCny'),177050);assert.equal(sum('expenseCny'),141500);
 assert.equal(e.network(),0);
});
test('直播间毛利优先开单卡料本、缺省回退供货款；跑单料本不计入且不改经营总览毛利（估）',async()=>{
 const e=environment('boss'),d=(await e.json('/api/dashboard/live-business')).body;
 assert.equal(d.profitMethod,'turnover_minus_material_and_entered_staff_costs');
 assert.equal(d.totals.performanceCny,'1770.50');assert.equal(d.totals.expenseCny,'1415.00');
 const a=d.rooms.find(r=>r.key==='DEMO-LIVE-01'),b=d.rooms.find(r=>r.key==='DEMO-LIVE-02');
 assert.equal(a.totals.performanceCny,'1770.50');
 assert.equal(a.profit.materialCostCny,'1300.00');
 assert.equal(a.profit.materialCostSources.orderCardCny,'900.00');
 assert.equal(a.profit.materialCostSources.expenseFallbackCny,'400.00');
 assert.equal(a.profit.staff.hostCommission.value,'120.00');
 assert.equal(a.profit.staff.assistantCommission.value,'40.00');
 assert.equal(a.profit.staff.actorSessionFee.value,'80.00');
 assert.equal(a.profit.staff.totalCny,'240.00');
 assert.equal(a.profit.liveRoomProfitCny,'230.50');
 assert.equal(a.profit.status,'ok');
 assert.equal(b.totals.performanceCny,'0.00');
 assert.equal(b.profit.materialCostCny,'0.00');
 assert.equal(b.profit.staff.actorSessionFee.value,'60.00');
 assert.equal(b.profit.staff.hostCommission.status,'pending_finance');
 assert.equal(b.profit.staff.assistantCommission.status,'pending_finance');
 assert.equal(b.profit.staff.totalCny,null);
 assert.equal(b.profit.liveRoomProfitCny,null);
 assert.equal(b.profit.status,'pending_finance');
 const card=(await e.json('/api/order-records/demo-order-1')).body;
 assert.equal(card.order.material_cost_cny,'900.00');
 assert.equal(card.order.material_lot_no,'D367-32');
 const fallback=(await e.json('/api/order-records/demo-order-2')).body;
 assert.equal(fallback.order.material_cost_cny,null);
 assert.equal(fallback.order.material_lot_no,null);
 const listed=(await e.json('/api/orders?from=2020-01-01')).body.orders.find(o=>o.id==='demo-order-1');
 assert.equal(listed.materialCost,'900.00');
 assert.equal(listed.materialLotNo,'D367-32');
 const cancelled=(await e.json('/api/order-records/demo-order-5')).body;
 assert.equal(cancelled.order.cancelled,true);
 assert.equal(cancelled.order.material_cost_cny,'200.00');
 assert.equal(cancelled.order.material_lot_no,'D218-07');
 const date=(await e.json('/api/auth/me')).body.today,prior=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const y=(await e.json('/api/dashboard/live-business?from='+prior+'&to='+prior)).body;
 const y1=y.rooms.find(r=>r.key==='DEMO-LIVE-01');
 assert.equal(y1.profit.materialCostCny,'0.00');
 assert.equal(y1.profit.materialCostSources.excludedCancelledCny,'200.00');
 const overview=(await e.json('/api/demo/boss-overview')).body;
 assert.equal(overview.metrics.estimatedContribution.value,'2213.26');
 assert.equal(overview.finalContribution.status,'pending_finance');
 assert.equal(e.network(),0);
});
test('live-room filters leave company advertising scoped to the same dates; other roles cannot read the home endpoint',async()=>{
 const e=environment('boss'),r=(await e.json('/api/dashboard/live-business?room=DEMO-LIVE-02&host='+encodeURIComponent('文强'))).body;
 assert.equal(r.totals.performanceCny,'0.00');assert.equal(r.totals.expenseCny,'15.00');assert.equal(r.ads.spendUsd,'29.20');assert.equal(r.rooms.length,1);
 const date=(await e.json('/api/auth/me')).body.today,prior=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const p=(await e.json('/api/dashboard/live-business?from='+prior+'&to='+prior+'&room=DEMO-LIVE-02')).body;assert.equal(p.totals.performanceCny,'850.00');assert.equal(p.totals.expenseCny,'630.00');assert.equal(p.ads.spendUsd,'30.00');
 for(const role of ['admin','finance','cs_supervisor'])assert.equal((await environment(role).json('/api/dashboard/live-business')).status,403);
 assert.equal((await e.json('/api/dashboard/live-business?from=bad')).status,400);
});
test('同一引流人设可来自不同承接小组和直播间，不构造固定人设直播间关系',async()=>{
 const e=environment('boss'),rows=(await e.json('/api/orders?from=2020-01-01')).body.orders;
 const source=rows.filter(o=>o.personaCode==='DEMO-P-A');assert.equal(new Set(source.map(o=>o.liveRoomCode)).size,2);assert.equal(new Set(source.map(o=>o.userId)).size,2);
});

test('拍剪填报演示只选择预置拍剪师，拒绝读取和保存管理数据',async()=>{
 const e=environment('editor');
 const me=await e.json('/api/auth/me');
 assert.equal(me.body.user.role,'editor');
 assert.equal(me.body.user.displayName,'演示·沈川');
 for(const path of ['/api/editor-reports','/api/orders','/api/admin/users','/api/salaries'])assert.equal((await e.json(path)).status,403);
 assert.equal((await e.json('/api/editor-reports','PUT',{editorName:'demo'})).status,403);
 assert.equal(e.network(),0);
});

test('客服工作台与入场直链自动选用客服演示身份，且不开放写入',async()=>{
 for(const pathname of ['/fill','/fill/','/fill/cs','/fill/cs/','/fill/attendance','/fill/attendance/']){
  const e=environment(null,pathname);
  assert.equal((await e.json('/api/auth/me')).body.user.role,'cs');
  assert.equal((await e.json('/api/cs-accounts')).status,200);
  assert.equal((await e.json('/api/finance')).status,403);
  assert.equal((await e.json('/api/attendance','POST',{count:12})).status,403);
  assert.equal(e.network(),0);
 }
 const editor=environment(null,'/fill/editor');
 assert.equal((await editor.json('/api/auth/me')).body.user.role,'editor');
 const ops=environment(null,'/fill/ops');
 assert.equal((await ops.json('/api/auth/me')).body.user.role,'ops');
});


test('运营演示入口读取本人投放和广告台账，拒绝其他业务与所有写入',async()=>{
 const e=environment('ops');
 const me=await e.json('/api/auth/me');
 assert.equal(me.body.user.role,'ops');assert.equal(me.body.user.displayName,'子恒');
 const reports=await e.json('/api/ops-reports');assert.equal(reports.status,200);
 assert.ok(reports.body.reports.length>0);assert.ok(reports.body.reports.every(r=>r.userId===me.body.user.id));
 const analysis=await e.json('/api/demo/ops-analysis');assert.equal(analysis.status,200);
 assert.equal(analysis.body.summary.spendUsd,'29.20');assert.equal(analysis.body.summary.consultCount,6);assert.equal(analysis.body.summary.clickCount,180);
 assert.equal((await e.json('/api/ad-accounts')).body.summary.balanceUsd,'120.80');
 for(const p of ['/api/orders','/api/order-records/demo-order-1','/api/finance','/api/salaries','/api/admin/users','/api/cs-accounts','/api/cs-accounts/teams','/api/fan-reports/summary','/api/fan-reports/export','/api/dashboard/live-business','/api/editor-reports','/api/demo/boss-overview'])assert.equal((await e.json(p)).status,403,p);
 for(const [p,method] of [['/api/ops-reports','PUT'],['/api/ad-accounts','POST'],['/api/ad-accounts/topups','POST']])assert.equal((await e.json(p,method,{amount:'10.00'})).status,403);
 const users=(await environment('admin').json('/api/admin/users')).body.users;
 assert.equal(users.filter(u=>u.id==='demo-ops').length,1);
 assert.equal(e.network(),0);
});

test('演示发布页在桌面按钮与手机菜单均提供运营入口',()=>{
 const pack=fs.readFileSync(require('node:path').join(__dirname,'../scripts/package-role-demo.cjs'),'utf8');
 assert.match(pack,/<button type="button" data-demo-role="ops">运营端<\/button>/);
 assert.match(pack,/<option value="ops">运营端<\/option>/);
});


test("assessment foundation is scoped by role and keeps sealed staff", async () => {
  const supervisor = environment("cs_supervisor");
  const review = await supervisor.json("/api/assessment/foundation");
  assert.equal(review.status, 200);
  assert.equal(review.body.version, "assessment-foundation/v1");
  assert.equal(review.body.view, "review");
  assert.equal(review.body.holderCheck.every((row) => row.matched), true);
  assert.equal(review.body.employees.some((row) => row.id === "demo-staff-yi"), false);
  const former = review.body.leads.find((row) => row.id === "seal-lead-1");
  assert.equal(former.employeeId, "demo-staff-former");
  assert.equal(review.body.attendance.find((row) => row.id === "seal-attendance-former").orderedCustomerIds.length, 3);
  assert.equal(review.body.attendance.find((row) => row.id === "seal-attendance-jia").orderLink, "unlinked");
  const jiaReplied = review.body.leads.filter((row) => row.employeeId === "demo-staff-jia" && row.contact === "replied");
  assert.equal(jiaReplied.length, 21);
  assert.equal(jiaReplied.filter((row) => row.qualified).length, 10);
  assert.equal(review.body.leads.some((row) => row.employeeId === "demo-staff-yi"), false);
  const boss = await environment("boss").json("/api/assessment/foundation");
  assert.equal(boss.body.leads.filter((row) => row.employeeId === "demo-staff-yi" && row.contact === "replied").length, 3);
  assert.equal(boss.body.orders.some((row) => row.employeeId === "demo-staff-jia"), true);
  assert.equal(boss.body.orders.some((row) => row.accountId === "demo-wechat-2"), true);
  assert.deepEqual(boss.body.teams.map((row) => row.name).sort(), ["演示一组", "演示二组"]);
  assert.deepEqual(review.body.teams.map((row) => row.name), ["演示一组"]);
  const admin = await environment("admin").json("/api/assessment/foundation");
  assert.equal(admin.body.view, "directory");
  assert.equal(admin.body.leads, undefined);
  assert.equal(admin.body.attendance, undefined);
  assert.equal(admin.body.orders, undefined);
  const ops = await environment("ops").json("/api/assessment/foundation");
  assert.equal(ops.body.view, "invalid");
  assert.equal(ops.body.employees, undefined);
  assert.deepEqual(ops.body.invalid, []);
  assert.deepEqual(ops.body.sourceAds, []);
  assert.equal(ops.body.sourceAds.length, 0);
  assert.equal(ops.body.sourceAds.some((row) => row.adAccountId === "9001"), false);
  const capture = await environment("cs").json("/api/assessment/foundation");
  assert.equal(capture.status, 200);
  assert.equal(capture.body.view, "capture");
  assert.equal(capture.body.leads, undefined);
  assert.equal((await environment("cs").json("/api/orders")).status, 403);
  for (const role of ["finance", "editor"]) assert.equal((await environment(role).json("/api/assessment/foundation")).status, 403);
  assert.equal((await environment("boss").json("/api/assessment/foundation", "POST", { employeeId: "x" })).status, 403);
});

test('客服四类历史只返回所选账号；主管限本组；其他岗位与写入均拒绝',async()=>{
 const cs=environment('cs'),supervisor=environment('cs_supervisor');
 assert.equal((await cs.json('/api/demo/report-history')).status,400);
 for(const kind of ['fans','orders','after-sales','attendance']){
  const result=await cs.json('/api/demo/report-history?kind='+kind+'&accountId=demo-wechat-1');
  assert.equal(result.status,200,kind);
  assert.equal(result.body.canPreviewCorrections,false);
  assert.ok(result.body.records.length>0,kind);
  assert.ok(result.body.records.every(row=>row.accountId==='demo-wechat-1'&&row.kind===kind));
  const group=await supervisor.json('/api/demo/report-history?kind='+kind);
  assert.equal(group.body.canPreviewCorrections,true);
  assert.ok(group.body.records.every(row=>row.accountId!=='demo-wechat-2'));
  for(const row of result.body.records){
   assert.equal(row.fields.some(field=>/settled|pending|fee_percent|net_cny|material_cost|supplier/i.test(field.key)),false);
  }
 }
 assert.equal((await supervisor.json('/api/demo/report-history?accountId=demo-wechat-2')).status,404);
 assert.equal((await cs.json('/api/demo/report-history?accountId=unknown')).status,404);
 for(const role of ['admin','boss','finance','ops','editor'])assert.equal((await environment(role).json('/api/demo/report-history?accountId=demo-wechat-1')).status,403);
 for(const role of ['cs','cs_supervisor'])for(const method of ['POST','PATCH','DELETE'])assert.equal((await environment(role).json('/api/demo/report-history',method,{enteredCount:999})).status,403);
 assert.equal(cs.network(),0);assert.equal(supervisor.network(),0);
});

test('历史按业务日期筛选；未填报为空，交接前后归属不同员工',async()=>{
 const supervisor=environment('cs_supervisor');
 const all=await supervisor.json('/api/demo/report-history?kind=attendance&accountId=demo-wechat-3');
 const former=all.body.records.find(row=>row.employeeCode==='CS-DEMO-00');
 const current=all.body.records.find(row=>row.employeeCode==='CS-DEMO-03');
 assert.ok(former);assert.ok(current);
 const day=await supervisor.json('/api/demo/report-history?kind=attendance&accountId=demo-wechat-3&from='+former.businessDate+'&to='+former.businessDate);
 assert.equal(day.body.records.length,1);assert.equal(day.body.records[0].employeeCode,'CS-DEMO-00');
 const empty=await supervisor.json('/api/demo/report-history?kind=orders&accountId=demo-wechat-3');
 assert.deepEqual(empty.body.records,[]);
 for(const query of ['kind=unknown','from=2026-02-30','from=2026-11-10&to=2026-10-01','from=2020-01-01'])assert.equal((await supervisor.json('/api/demo/report-history?'+query)).status,400);
});

test('登记名册仅供客服、主管和管理员；真实登记账号没有虚构历史或考核',async()=>{
 const account={id:'registered-whatsapp-1',holderName:'虚构名册客服',wechatId:'WhatsApp · +999000000011',teamName:'秋菊组'};
 const directory={enabled:true,version:'service-directory/v1',team:{id:'registered-team-qiuju',name:'秋菊组'},accounts:[account],people:[{id:'registered-person',name:'虚构名册客服'}]};
 for(const role of ['cs','cs_supervisor','admin']){
  const result=await environment(role,'',directory).json('/api/demo/service-directory');
  assert.equal(result.status,200);assert.equal(result.body.accounts.length,1);
  const listed=await environment(role,'',directory).json('/api/cs-accounts');assert.equal(listed.body.accounts[0].id,account.id);
  const groups=await environment(role,'',directory).json('/api/cs-accounts/teams');if(role==='cs')assert.equal(groups.status,403);else assert.equal(groups.body.teams[0].name,'秋菊组');
 }
 for(const role of ['boss','finance','ops','editor'])assert.equal((await environment(role,'',directory).json('/api/demo/service-directory')).status,403);
 for(const role of ['cs','cs_supervisor']){
  const env=environment(role,'',directory);
  for(const kind of ['fans','orders','after-sales','attendance']){
   const history=await env.json('/api/demo/report-history?kind='+kind+'&accountId='+account.id);
   assert.equal(history.status,200);assert.deepEqual(history.body.records,[]);
  }
  const foundation=await env.json('/api/assessment/foundation');
  assert.equal((foundation.body.leads||[]).some(row=>row.accountId===account.id),false);
  assert.equal((foundation.body.attendance||[]).some(row=>row.accountId===account.id),false);
  assert.equal((await env.json('/api/demo/service-directory','POST',directory)).status,403);
  assert.equal(env.network(),0);
 }
 assert.deepEqual((await environment('cs').json('/api/demo/service-directory')).body,{enabled:false});
});
