const {test}=require('node:test'),assert=require('node:assert/strict');
const {build,expense}=require('./boss-priority.js');
const date='2026-11-16';
const base={from:date,to:date,people:[{id:'a',name:'客服',room:'overseas-one',team:'秋菊组'},{id:'new',name:'新客服',room:'overseas-one',team:'秋菊组'}],orders:[{date,room:'overseas-one',employeeId:'a',amount:'1000.00',channel:'live'},{date,room:'overseas-one',employeeId:'a',amount:'500.00',channel:'private'},{date,room:'overseas-one',employeeId:'a',amount:'900.00',channel:'live',cancelled:true},{date,room:'unassigned',employeeId:'',amount:'100.00',channel:'live'},{date,room:'overseas-one',employeeId:'a',amount:'200.00',status:'refunded'}],fans:[{date,employeeId:'a',total:7,effective:5,invalid:null,pendingInvalid:1}],expenses:[]};
test('总业绩包含私推，跑单退款排除，房间合计一致且二线不借用一线',()=>{
 const result=build(base);assert.equal(result.performance.total,'1600.00');assert.equal(result.performance.private,'500.00');
 assert.equal(result.rooms.reduce((n,r)=>n+Number(r.total),0),1600);
 const one=result.rooms.find(r=>r.id==='overseas-one');assert.equal(one.total,'1500.00');assert.equal(one.privateShare,33.33);
 assert.equal(one.members[0].total,'1500.00');assert.equal(one.members[0].fans,7);assert.equal(one.members[0].invalid,null);
 assert.equal(one.members[1].fans,null);assert.equal(one.members[1].privateShare,null);
 const two=result.rooms.find(r=>r.id==='overseas-two');assert.equal(two.status,'pending');assert.equal(two.members.length,0);
 assert.equal(result.days.reduce((n,row)=>n+Number(row.total||0),0),Number(result.performance.total));
});
test('首页总业绩趋势包含私推，冲抵为零，未填报断点不作零',()=>{
 const data=build({...base,from:'2026-11-14',orders:[{date:'2026-11-15',amount:'500.00',channel:'private',room:'overseas-one',employeeId:'a'},{date:'2026-11-16',amount:'100.00',channel:'live',cancelled:true}]});
 assert.deepEqual(data.days.map(row=>row.total),[null,'500.00','0.00']);
 assert.ok(data.days.every(row=>row.operatingCost===null));
});
test('日常费用只计已登记范围，未录入不当0，工资不重复估算',()=>{
 const row=expense({date,category:'rent',amount:'1000',purpose:'办公室',operator:'财务'},date,'财务','e');
 const result=build({...base,expenses:[row,{...row,id:'old',date:'2026-11-15',amount:'400.00'},{...row,id:'void',amount:'200.00',voided:true}]});
 assert.equal(result.expenses.registered,'1000.00');assert.equal(result.expenses.categories.find(r=>r.key==='salary').status,'pending_payroll');assert.equal(result.expenses.categories.find(r=>r.key==='utilities').amount,null);
 assert.equal(build(base).expenses.registered,null);
 for(const patch of [{category:'salary'},{category:'ads'},{category:'goods'},{amount:'-1'},{date:'2026-02-30'},{purpose:''}])assert.throws(()=>expense({date,category:'rent',amount:'1',purpose:'租金',operator:'财务',...patch},date,'财务','e'));
});
test('口径 A 经营毛利、7 日趋势自动展开及直播间渠道毛利严格自洽',()=>{
 const result=build({
  from:date,to:date,people:base.people,
  orders:[
   {id:'o1',date,room:'overseas-one',employeeId:'a',amount:'1000.00',materialCost:'600.00',channel:'live'},
   {id:'o2',date,room:'overseas-one',employeeId:'a',amount:'500.00',materialCost:null,channel:'private'}
  ],
  fans:[{date,employeeId:'a',total:10,effective:6,invalid:null,pendingInvalid:1}],
  expenses:[expense({date,category:'rent',amount:'100.00',purpose:'房租',operator:'财务'},date,'财务','e1')],
  reimbursements:[{id:'r1',date,amount:'50.00',status:'approved',postedExpenseId:''}],
  orderExpenses:[{orderId:'o1',date,category:'shipping',amount:'20.00',room:'overseas-one',channel:'live'}],
  settlementFees:[{date,amount:'10.00',currency:'CNY',fxRate:null}],
  adSpends:[{date,spendUsd:'10.00'}],
  fxUsdRate:7.24
 });
 // 有效业绩 1500.00, 料本 600.00 (缺本价 1 单), 售后 20.00, 扣点 10.00, 投流 72.40 => 毛利 797.60
 assert.equal(result.performance.total,'1500.00');
 assert.equal(result.performance.avgOrder,'750.00');
 assert.equal(result.grossProfit.amount,'797.60');
 assert.equal(result.grossProfit.missingMaterialCostCount,1);
 assert.equal(result.grossProfit.adSpendCny,'72.40');
 // 运营成本 = 100.00 + 50.00 = 150.00; 预估净利 = 797.60 - 150.00 = 647.60
 assert.equal(result.expenses.recordedSubtotal,'150.00');
 assert.equal(result.structure.estimatedNetProfit,'647.60');
 assert.equal(result.structure.includesPayroll,false);
 // 今日选中自动返回 7 天趋势
 assert.equal(result.trend.length,7);
 assert.equal(result.trend[6].date,date);
 assert.equal(result.trend[6].operatingCost,'150.00');
 // 渠道毛利总和严格等于全局毛利
 const channelGpSum=result.channelProfits.reduce((s,c)=>s+Math.round(Number(c.grossProfit)*100),0);
 assert.equal(channelGpSum,79760);
});
