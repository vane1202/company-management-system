const {test}=require('node:test'),assert=require('node:assert/strict');
const {apply}=require('./editor-history.js');
const line={personaName:'测试人设',shootCount:'2',editCount:'1',sentToOpsCount:'1',inventorySnapshot:'0',note:''};
const context={editor:'魏磊',today:'2026-11-16',id:'new',now:'2026-11-16T00:00:00Z'};
test('新增及修正保留完整前后快照，囤量零值合法，原记录不改写',()=>{
 const source=apply([],{businessDate:'2026-11-15',lines:[line]},context);
 const result=apply(source,{id:'new',version:1,businessDate:'2026-11-15',lines:[{...line,editCount:'3'}],reason:'漏填补正'},context);
 assert.equal(result[0].version,2);assert.equal(source[0].lines[0].editCount,1);
 assert.equal(result[0].history[1].before.lines[0].editCount,1);assert.equal(result[0].history[1].after.lines[0].editCount,3);
 assert.equal(result[0].lines[0].inventorySnapshot,0);
});
test('拒绝他人修改、过期版本、重复日期、人设重复、缺原因和非法数值日期',()=>{
 const source=apply([],{businessDate:'2026-11-15',lines:[line]},context);
 const correction={id:'new',version:1,businessDate:'2026-11-15',lines:[line],reason:'更正'};
 assert.throws(()=>apply(source,correction,{...context,editor:'尚杰'}));
 for(const patch of [{version:0},{reason:''},{businessDate:'2026-11-17'},{businessDate:'2026-02-30'},{lines:[line,line]},{lines:[{...line,editCount:'-1'}]}])assert.throws(()=>apply(source,{...correction,...patch},context));
 assert.throws(()=>apply(source,{businessDate:'2026-11-15',lines:[line]},context));
});
