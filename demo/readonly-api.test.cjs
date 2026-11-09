const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const assert=require('node:assert/strict');
const script=fs.readFileSync(require('node:path').join(__dirname,'readonly-api.js'),'utf8');
function environment(role){
 const storage=new Map();let networkRequests=0;
 const window={location:{origin:'https://fictional.example',search:'?role='+role,assign(){}},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},fetch:async()=>{networkRequests++;throw Error('Unexpected backend network request');}};
 vm.runInNewContext(script,{window,document:{addEventListener(){}},URL,URLSearchParams,Response,Date});
 return {fetch:window.fetch,json:async(path,method='GET',body)=>{const response=await window.fetch(path,{method,body:JSON.stringify(body)});return {status:response.status,body:await response.json()};},network:()=>networkRequests};
}
test('public preview identities are fictional and business access follows the preview role',async()=>{
 for(const role of ['boss','admin','cs_supervisor','finance']){const e=environment(role);const me=await e.json('/api/auth/me');assert.equal(me.body.user.role,role);assert.ok(me.body.user.username.startsWith('demo_'));assert.equal(e.network(),0);}
 const admin=environment('admin');assert.equal((await admin.json('/api/admin/users')).status,200);
 for(const path of ['/api/orders','/api/fan-reports/summary','/api/dashboard/summary','/api/salaries'])assert.equal((await admin.json(path)).status,403);
});
test('supervisor sees one fictional group and cannot query another fictional account',async()=>{
 const e=environment('cs_supervisor');const orders=await e.json('/api/orders');assert.equal(orders.body.orders.length,2);assert.ok(orders.body.orders.every(row=>row.userId==='demo-wechat-1'));assert.deepEqual(orders.body.totals,{amount:'1970.50',refunds:'0.00'});
 assert.deepEqual((await e.json('/api/orders?userId=demo-wechat-2')).body.orders,[]);assert.equal((await e.json('/api/cs-accounts')).body.accounts.length,1);assert.equal((await e.json('/api/fan-reports/summary')).body.teams.length,1);assert.equal((await e.json('/api/admin/users')).status,403);
});
test('BOSS filters dates/statuses and uses the latest monthly snapshot rather than summing snapshots',async()=>{
 const e=environment('boss');const meta=(await e.json('/api/auth/me')).body;const today=meta.today;
 const day=(await e.json('/api/dashboard/summary')).body;assert.deepEqual(day.period,{from:today,to:today});assert.equal(day.metrics.revenue,'2150.50');assert.equal(day.metrics.refunds,'180.00');
 const from=today.slice(0,7)+'-01';const period=(await e.json('/api/dashboard/summary?from='+from+'&to='+today)).body;assert.equal(period.metrics.msMonth,216);assert.equal(period.metrics.wsMonth,83);
 const filtered=(await e.json('/api/orders?status=refunded')).body;assert.equal(filtered.orders.length,1);assert.deepEqual(filtered.totals,{amount:'180.00',refunds:'180.00'});
});
test('all preview writes are refused and never contact the actual backend',async()=>{
 for(const role of ['admin','boss','cs_supervisor','finance']){const e=environment(role);for(const path of ['/api/orders','/api/cs-accounts/registration-codes','/api/admin/users','/api/modules','/api/admin/settings','/api/finance/settlements','/api/order-records']){assert.equal((await e.json(path,'POST',{role:'boss',amount:'999.00'})).status,403);}assert.equal(e.network(),0);}
});
test('finance preview separates customer credit from fictional company settlement and keeps costs private',async()=>{
 const finance=environment('finance'),result=await finance.json('/api/finance');assert.equal(result.status,200);assert.equal(result.body.summary.totalCny,'1613.90');assert.deepEqual(result.body.summary.pending,{CNY:'0.00',TWD:'1200.00',USD:'90.00'});assert.equal((await finance.json('/api/order-records/demo-order-1')).status,403);assert.equal((await finance.json('/api/admin/users')).status,403);
 const boss=environment('boss'),d=(await boss.json('/api/order-records/demo-order-3')).body;assert.equal(d.balance,'0.00');assert.equal(d.payments[0].pendingAmount,'90.00');assert.equal((await environment('cs_supervisor').json('/api/order-records/demo-order-3')).status,404);assert.equal(finance.network(),0);
});
test('fictional CSV export honors the selected group and account without a server',async()=>{
 const e=environment('cs_supervisor');const response=await e.fetch('/api/fan-reports/export');assert.equal(response.status,200);const text=await response.text();assert.ok(text.includes('Demo_WeChat_01'));assert.ok(!text.includes('Demo_WeChat_02'));assert.equal(e.network(),0);
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
