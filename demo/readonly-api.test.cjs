const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const script=fs.readFileSync(require('node:path').join(__dirname,'readonly-api.js'),'utf8');
function environment(role){
 const storage=new Map();let networkRequests=0;
 const window={location:{origin:'https://fictional.example',search:'?role='+role,assign(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},fetch:async()=>{networkRequests++;throw Error('Unexpected backend network request');}};
 window.CmsBossOverview=require('./boss-overview-metrics.js');
 window.CmsOpsAnalysis=require('./ops-analysis-metrics.js');
 window.CmsLiveRoomOperations=require('./live-room-operations.js');
 vm.runInNewContext(script,{window,document:{addEventListener(){}},URL,URLSearchParams,Response,Date});
 return {fetch:window.fetch,json:async(path,method='GET',body)=>{const response=await window.fetch(path,{method,body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},network:()=>networkRequests};
}

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
 const one=(await e.json('/api/dashboard/live-business?host='+encodeURIComponent('演示主播甲'))).body;
 assert.deepEqual(one.rooms.map(r=>r.key),['DEMO-LIVE-01']);
 assert.ok(one.operations.orders.every(o=>o.hostName==='演示主播甲'));
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
 assert.equal(d.version,'boss-overview-p0/v1');assert.equal(d.metrics.turnover.value,old.totals.performanceCny);
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
  const expected=(sales.reduce((n,e)=>n+Math.round(Number(e.amount)*100),0)/100).toFixed(2);
  assert.equal(mine.totals.turnover,expected,day);assert.equal(mine.totals.turnoverCount,sales.length,day);
 }
 const t=(await sup.json(`/api/orders?from=${today}&to=${today}`)).body.totals;assert.equal(t.turnover,'1770.50');assert.equal(t.amount,'1970.50');
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
 const e=environment('cs_supervisor');const orders=await e.json('/api/orders');assert.equal(orders.body.orders.length,4);assert.ok(orders.body.orders.every(row=>row.userId==='demo-wechat-1'));assert.deepEqual(orders.body.totals,{amount:'2850.50',refunds:'0.00',cancelled:'330.00',turnover:'2320.50',turnoverCount:3});
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
test('finance preview separates customer credit from fictional company settlement and keeps costs private',async()=>{
 const finance=environment('finance'),result=await finance.json('/api/finance');assert.equal(result.status,200);assert.equal(result.body.summary.totalCny,'1613.90');assert.deepEqual(result.body.summary.pending,{CNY:'0.00',TWD:'1200.00',USD:'90.00'});assert.equal((await finance.json('/api/order-records/demo-order-1')).status,403);assert.equal((await finance.json('/api/admin/users')).status,403);
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
 const prior=d.rooms.find(r=>r.roomCode==='DEMO-LIVE-02');assert.equal(prior.totals.performanceCny,'0.00');assert.equal(prior.totals.expenseCny,'15.00');assert.equal(prior.totals.newOrderCount,0);
 assert.equal(d.rooms.find(r=>r.roomCode==='DEMO-LIVE-01').personas.length,1);
 const sum=key=>d.rooms.reduce((n,r)=>n+Math.round(Number(r.totals[key])*100),0);assert.equal(sum('performanceCny'),177050);assert.equal(sum('expenseCny'),141500);
 assert.equal(e.network(),0);
});
test('直播间毛利优先开单卡料本、缺省回退供货款；跑单料本不计入且不改经营总览毛利（估）',async()=>{
 const e=environment('boss'),d=(await e.json('/api/dashboard/live-business')).body;
 assert.equal(d.profitMethod,'turnover_minus_material_and_entered_staff_costs');
 assert.equal(d.totals.performanceCny,'1770.50');assert.equal(d.totals.expenseCny,'1415.00');
 const a=d.rooms.find(r=>r.roomCode==='DEMO-LIVE-01'),b=d.rooms.find(r=>r.roomCode==='DEMO-LIVE-02');
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
 const y1=y.rooms.find(r=>r.roomCode==='DEMO-LIVE-01');
 assert.equal(y1.profit.materialCostCny,'0.00');
 assert.equal(y1.profit.materialCostSources.excludedCancelledCny,'200.00');
 const overview=(await e.json('/api/demo/boss-overview')).body;
 assert.equal(overview.metrics.estimatedContribution.value,'2213.26');
 assert.equal(overview.finalContribution.status,'pending_finance');
 assert.equal(e.network(),0);
});
test('live-room filters leave company advertising scoped to the same dates; other roles cannot read the home endpoint',async()=>{
 const e=environment('boss'),r=(await e.json('/api/dashboard/live-business?room=DEMO-LIVE-02&host='+encodeURIComponent('演示主播乙'))).body;
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
