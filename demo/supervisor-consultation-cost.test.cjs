const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('./supervisor-consultation-cost.js');
test('当前演示广告户全部明确关联秋菊组，按本次确认日生效',()=>{
 const links=require('./supervisor-ad-links.json');
 const core=require('./ops-workspace.js');
 const originals=['DEMO-ADS-01','DEMO-ADS-02'].map((adAccountRef,index)=>({adAccountRef,spendUsd:index?'7.00':'22.20',consultCount:index?1:5,businessDate:'2026-11-15'}));
 const rows=core.people.flatMap(person=>core.rowsFor(person,originals));
 assert.equal(new Set(links.map(link=>link.account)).size,rows.length);
 const result=build({rows,links,team:{id:'registered-team-qiuju',name:'秋菊组'},date:'2026-11-15'});
 assert.equal(result.current.status,'ready');assert.equal(result.current.spendUsd,'116.80');assert.equal(result.current.consultCount,24);
 assert.equal(result.previous.status,'unlinked');
 assert.equal(build({rows,links,team:{id:'demo-team-b',name:'其他组'},date:'2026-11-15'}).current.status,'unlinked');
});
const row=(account,spendUsd,count,date='2026-11-15')=>({adAccountRef:account,spendUsd,consultCount:count,businessDate:date});
const base={date:'2026-11-15',team:{id:'a',name:'小组'},links:[{teamId:'a',account:'owned',from:'2026-11-01'}],rows:[row('owned','10.00',2),row('owned','20.00',4),row('other','1000.00',1),row('owned','5.00',2,'2026-11-14')]};
test('按关联生效日期统计已报广告消耗与咨询，排除其他小组',()=>{
 const result=build(base);assert.equal(result.scope,'team');assert.equal(result.current.spendUsd,'30.00');assert.equal(result.current.consultCount,6);assert.equal(result.previous.spendUsd,'5.00');
 assert.equal(build({...base,links:[]}).current.status,'unlinked');
 assert.equal(build({...base,links:[{...base.links[0],from:'2026-11-15'}]}).previous.status,'unlinked');
});
test('跨组共享归属不明、缺报、零咨询和缺字段都不生成虚假成本',()=>{
 assert.equal(build({...base,links:[...base.links,{teamId:'b',account:'owned',from:'2026-11-01'}]}).current.status,'ambiguous');
 assert.equal(build({...base,links:[...base.links,{teamId:'a',account:'missing',from:'2026-11-01'}]}).current.status,'incomplete');
 assert.equal(build({...base,rows:[]}).current.status,'empty');
 assert.equal(build({...base,rows:[row('owned','0.00',0)]}).current.status,'zero_consultations');
 assert.equal(build({...base,rows:[row('owned',null,3)]}).current.status,'incomplete');
});
