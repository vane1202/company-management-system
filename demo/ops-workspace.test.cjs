const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('./ops-workspace.js');
const accounts=[{id:'owned',personas:['主页A']}];
const input={account:'owned',persona:'主页A',from:'2026-11-01',to:'2026-11-15',date:'2026-11-15',category:'strategy',problem:'咨询减少',suggestion:'调整素材',attachments:[]};
test('四人独立演练广告户不改写原始运营样本',()=>{
 const source=[{id:'r',userId:'demo-ops',adAccountRef:'DEMO-ADS-01',platform:'Facebook',personaName:'A'}];
 const owned=core.people.map(person=>core.rowsFor(person,source)[0]);
 assert.equal(new Set(owned.map(row=>row.userId)).size,4);
 assert.equal(new Set(owned.map(row=>row.adAccountRef)).size,4);
 assert.equal(source[0].adAccountRef,'DEMO-ADS-01');
});
test('拒绝未负责账号、人设错配、空建议、无效日期和危险附件',()=>{
 assert.equal(core.validateFeedback(input,accounts,'2026-11-15').problem,'咨询减少');
 for(const patch of [{account:'foreign'}, {persona:'别人的主页'}, {suggestion:''}, {date:'2026-02-30'}, {to:'2026-11-16'}, {account:'',persona:''}, {attachments:[{name:'x',data:'data:image/svg+xml;base64,AAAA'}]}])assert.throws(()=>core.validateFeedback({...input,...patch},accounts,'2026-11-15'));
});
