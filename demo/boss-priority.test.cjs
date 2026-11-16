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
