const test=require('node:test'),assert=require('node:assert/strict');
const {build,balances}=require('./ops-analysis-metrics.js');
const clock={today:'2026-11-11'};
let sequence=0;
const row=(extra={})=>({id:'fictional-ops-'+(++sequence),businessDate:clock.today,personaName:'演示主页 A',platform:'Facebook',adAccountRef:'DEMO-ADS-A',spendUsd:'10.00',consultCount:2,consultCostUsd:'5.00',clickCount:20,balanceUsd:'100.00',updatedAt:clock.today+'T03:00:00Z',...extra});
const dataset=(rows,extra={})=>({rows,rates:[{currency:'USD',cnyPerUnit:'7.200000',effectiveFrom:'2026-01-01'}],...extra});
const run=(d,q={})=>build(d,q,clock);

test('咨询成本以总消耗除总咨询；保留独立上报值，不平均成本',()=>{
 const rows=[row({spendUsd:'100.00',consultCount:1,consultCostUsd:'99.00'}),row({spendUsd:'10.00',consultCount:10,consultCostUsd:'1.20'})];
 const d=run(dataset(rows));assert.equal(d.summary.spendUsd,'110.00');assert.equal(d.summary.consultCount,11);assert.equal(d.summary.consultationCostUsd,'10.00');assert.equal(d.summary.spendCny,'792.00');assert.equal(d.records[0].consultCostUsd,'99.00');
});
test('共享账户快照跨人设去重；筛选后仍取完整账户最新快照',()=>{
 const rows=[row(),row({personaName:'演示主页 B',balanceUsd:'100.00'}),row({businessDate:'2026-11-10',balanceUsd:'90.00',updatedAt:'2026-11-10T03:00:00Z'})];
 const d=run(dataset(rows),{persona:'演示主页 A'});assert.equal(d.balances.totalUsd,'100.00');assert.equal(d.balances.accounts.length,1);assert.equal(d.balances.accounts[0].shared,true);
 const newer=row({personaName:'演示主页 B',balanceUsd:'80.00',updatedAt:'2026-11-11T04:00:00Z'});
 const n=run(dataset([...rows,newer]),{persona:'演示主页 A'});assert.equal(n.summary.spendUsd,'10.00');assert.equal(n.balances.totalUsd,'80.00');
 const archived=balances([...rows,newer],rows,'2026-11-10');assert.equal(archived[0].amountUsd,'90.00');
});
test('同一时刻余额冲突显示待核对，不挑选一条；缺失余额不当0',()=>{
 const a=run(dataset([row(),row({personaName:'演示主页 B',balanceUsd:'99.00'})]));assert.equal(a.balances.totalUsd,null);assert.equal(a.balances.accounts[0].status,'conflict');
 const b=run(dataset([row({balanceUsd:null})]));assert.equal(b.balances.totalUsd,null);assert.equal(b.balances.accounts[0].status,'missing');
});
test('零咨询与空范围分开；缺字段、缺汇率不冒充已知小计',()=>{
 const zero=run(dataset([row({consultCount:0})]));assert.equal(zero.summary.costStatus,'no_consultation');assert.equal(zero.summary.consultationCostUsd,null);
 const paused=run(dataset([row({spendUsd:'0.00',consultCount:0})]));assert.equal(paused.summary.spendUsd,'0.00');assert.equal(paused.summary.costStatus,'no_spend');
 const empty=run(dataset([]));assert.equal(empty.summary.spendUsd,null);assert.equal(empty.summary.consultCount,null);assert.equal(empty.summary.costStatus,'empty');
 const incomplete=run(dataset([row(),row({consultCount:null,clickCount:null,spendUsd:null})]));assert.equal(incomplete.summary.spendUsd,null);assert.equal(incomplete.summary.consultationCostUsd,null);assert.equal(incomplete.summary.missingSpendCount,1);
 const missingRate=run(dataset([row()],{rates:[]}));assert.equal(missingRate.summary.spendUsd,'10.00');assert.equal(missingRate.summary.spendCny,null);assert.deepEqual(missingRate.fx.missing,['2026-11-11']);
});
test('人设、平台、账户分组相加与汇总一致；筛选作用于表格、原始日报及趋势',()=>{
 const rows=[row(),row({personaName:'演示主页 B',adAccountRef:'DEMO-ADS-B',platform:'TikTok',spendUsd:'20.00',consultCount:4})];
 for(const dimension of ['persona','platform','account']){
  const d=run(dataset(rows),{dimension});assert.equal(d.groups.reduce((n,g)=>n+Number(g.spendUsd),0),30);assert.equal(d.groups.reduce((n,g)=>n+g.consultCount,0),6);
 }
 const d=run(dataset(rows),{platform:'TikTok'});assert.equal(d.records.length,1);assert.equal(d.summary.spendUsd,'20.00');assert.equal(d.trend.days.at(-1).spendUsd,'20.00');assert.equal(d.balances.accounts[0].account,'DEMO-ADS-B');
});
test('趋势缺报为null，明确零值保留；每日基准不伪造小时级同比',()=>{
 const rows=[row(),row({businessDate:'2026-11-09',spendUsd:'0.00',consultCount:0})];
 const d=run(dataset(rows));assert.equal(d.trend.days.length,7);assert.equal(d.trend.days.at(-2).spendUsd,null);assert.equal(d.trend.days.at(-3).spendUsd,'0.00');assert.equal(d.trend.days.at(-1).partial,true);assert.equal(d.comparison.totals.spendUsd,null);assert.equal(d.comparison.percentage,null);assert.equal(d.comparison.label,'昨日已报');
});
test('日期与维度边界、未关联维度、未知筛选不伪造归属',()=>{
 const d=dataset([row({personaName:''})]);assert.equal(run(d,{persona:'__unassigned__'}).groups[0].name,'未关联');assert.equal(run(d,{account:'不存在'}).records.length,0);
 for(const q of [{from:'2026-02-30',to:'2026-03-01'},{from:'2026-11-12',to:'2026-11-12'},{from:'2026-11-01'},{dimension:'constructor'},{dimension:'none'}])assert.throws(()=>run(d,q));
});
