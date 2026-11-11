const test=require('node:test'),assert=require('node:assert/strict');
const {build,convert,periodOf,comparisonPeriods}=require('./boss-overview-metrics.js');
const clock={today:'2026-11-11',localTime:'14:00:00',asOf:'2026-11-11T06:00:00Z'};
let sequence=0;
const row=(kind,amount,currency='CNY',extra={})=>({id:'fictional-'+(++sequence),kind,amount,currency,date:clock.today,localTime:'10:00:00',label:'虚构记录',...extra});
function fixture(rows=[],extra={}){return {rows,coverage:{from:'2025-01-01',to:clock.today},rates:[{currency:'TWD',cnyPerUnit:'0.200000',effectiveFrom:'2025-01-01'},{currency:'USD',cnyPerUnit:'7.200000',effectiveFrom:'2025-01-01'}],finance:[],paidPerformance:[],sources:[],targets:[],...extra};}
const run=(data,query={})=>build(data,query,clock);

test('分开开单、定金尾款、追加收费及财务业绩：收款不再增加开单额',()=>{
 const data=fixture([row('booking','1100.00'),row('booking','330.00','CNY',{excluded:'跑单'}),row('payment','200.00'),row('payment','900.00'),row('charge','100.00')],{paidPerformance:[{date:clock.today,amount:'800.00'}]});
 const d=run(data);assert.equal(d.metrics.turnover.value,'1100.00');assert.equal(d.metrics.receipts.value,'1100.00');assert.equal(d.paidPerformance[0].amount,'800.00');assert.equal(d.ledger.find(r=>r.excluded).bucket,'excludedBooking');
});
test('跨币种收款及消耗逐笔折算：商品采购只在财务扣一次',()=>{
 const data=fixture([row('payment','1290.50'),row('payment','1200.00','TWD'),row('payment','140.00','USD'),row('cost','1300.00','CNY',{category:'goods'}),row('cost','115.00','CNY',{category:'shipping'}),row('ad','29.20','USD')]);
 const d=run(data);assert.equal(d.metrics.receipts.value,'2538.50');assert.equal(d.metrics.visibleCost.value,'325.24');assert.equal(d.metrics.estimatedContribution.value,'2213.26');assert.equal(d.metrics.roi.value,'12.07');assert.equal(d.finalContribution.value,null);assert.equal(d.finalContribution.status,'pending_finance');
 data.finance=[{date:clock.today,materialCost:'1300.00',commission:'180.00',collectionFee:'15.00'}];
 const f=run(data);assert.equal(f.finalContribution.value,'718.26');assert.equal(f.ledger.find(r=>r.category==='goods').bucket,'excludedCost');assert.equal(f.metrics.visibleCost.nativeTotals.USD,'29.20');
});
test('无广告消耗的人设场景不生成Infinity；缺失汇率不冒充已知小计',()=>{
 const a=run(fixture([row('payment','600.00')]));assert.equal(a.metrics.roi.value,null);assert.equal(a.metrics.roi.status,'no_spend');
 const b=run(fixture([row('payment','100.00'),row('payment','10.00','USD'),row('ad','2.00','USD')],{rates:[]}));
 assert.equal(b.metrics.receipts.value,null);assert.equal(b.metrics.receipts.nativeTotals.CNY,'100.00');assert.equal(b.metrics.estimatedContribution.value,null);assert.equal(b.metrics.roi.value,null);assert.ok(b.fx.missing.includes('USD / 2026-11-11'));
});
test('费用不清楚不猜；配货采购、提成、代收手续费均排除；充值不算消耗',()=>{
 const d=run(fixture([row('payment','100.00'),...['sourcing','commission','collection_fee'].map(category=>row('cost','10.00','CNY',{category})),row('topup','1000.00','USD')]));
 assert.equal(d.metrics.visibleCost.value,'0.00');assert.equal(d.metrics.estimatedContribution.value,'100.00');assert.equal(d.metrics.roi.status,'no_spend');
 const x=run(fixture([row('cost','5.00','CNY',{category:'other'})]));assert.equal(x.metrics.visibleCost.value,null);assert.equal(x.metrics.visibleCost.status,'unclassified_cost');
});
test('财务未填与明确0分开；区间缺一日不可算最终净贡献',()=>{
 const data=fixture([row('payment','10.00')],{finance:[{date:clock.today,materialCost:'0.00',commission:'0.00',collectionFee:'0.00'}]});
 assert.equal(run(data).finalContribution.value,'10.00');
 const d=run(data,{from:'2026-11-10',to:clock.today});assert.equal(d.finalContribution.value,null);assert.deepEqual(d.finalContribution.missingDays,['2026-11-10']);
 delete data.finance[0].commission;assert.equal(run(data).finalContribution.status,'pending_finance');
});
test('按费用发生日选择有效汇率，原币保留，半分四舍五入',()=>{
 const rates=[{currency:'USD',cnyPerUnit:'7.100000',effectiveFrom:'2026-11-01',effectiveTo:'2026-11-10'},{currency:'USD',cnyPerUnit:'7.200000',effectiveFrom:clock.today}];
 assert.equal(convert(row('payment','10.00','USD',{date:'2026-11-10'}),rates).cny,'71.00');assert.equal(convert(row('payment','10.00','USD'),rates).cny,'72.00');
 assert.equal(convert(row('payment','0.01','USD'),[{currency:'USD',cnyPerUnit:'0.500000',effectiveFrom:'2026-11-01'}]).cny,'0.01');assert.equal(convert(row('payment','10.00','USD',{date:'2026-10-31'}),rates).cny,null);
});
test('同期按相同已过去时刻；未来发生记录不进入当前，负净贡献不造误导百分比',()=>{
 const data=fixture([row('payment','100.00'),row('cost','200.00','CNY',{category:'design'}),row('payment','900.00','CNY',{date:'2026-11-10',localTime:'18:00:00'}),row('payment','50.00','CNY',{date:'2026-11-10',localTime:'10:00:00'})]);
 const d=run(data);assert.equal(d.metrics.receipts.comparisons[0].baseValue,'50.00');assert.equal(d.metrics.receipts.comparisons[0].percent,'100.00');assert.equal(d.metrics.estimatedContribution.value,'-100.00');
 assert.equal(d.metrics.estimatedContribution.comparisons[1].status,'nonpositive_base');
});
test('月初、短月、周一、自定义范围及非法日期边界',()=>{
 assert.deepEqual(periodOf({preset:'week'},'2026-11-09').from,'2026-11-09');
 const p=periodOf({preset:'month'},'2026-03-31');assert.equal(comparisonPeriods(p)[0].to,'2026-02-28');
 assert.equal(comparisonPeriods(periodOf({preset:'month'},'2026-01-01'))[0].from,'2025-12-01');
 assert.equal(comparisonPeriods(periodOf({from:'2026-11-05',to:'2026-11-07'},clock.today))[0].from,'2026-11-02');
 for(const query of [{from:'2026-11-01'},{from:'2026-11-12',to:'2026-11-12'},{from:'2026-02-30',to:'2026-11-11'},{from:'2026-11-11',to:'2026-11-10'},{preset:'bad'},{from:'2024-01-01',to:clock.today}])assert.throws(()=>run(fixture(),query));
});
test('数据覆盖不完整、当日缺发生时刻，合计和对比均不伪造0',()=>{
 const a=run(fixture([],{coverage:{from:clock.today,to:clock.today}}));assert.equal(a.metrics.turnover.comparisons[0].status,'unavailable');
 const b=run(fixture([row('payment','10.00','CNY',{localTime:null})]));assert.equal(b.metrics.receipts.value,null);assert.equal(b.metrics.receipts.status,'incomplete');
});
