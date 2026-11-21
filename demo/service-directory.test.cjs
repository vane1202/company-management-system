const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildServiceDirectory } = require('../scripts/demo-service-directory.cjs');

function source() {
  return { confirmedOn:'2026-11-13', people:[{id:'P01',name:'虚构名册客服',note:'不应发布的原始备注'}], accounts:[{personDraftId:'P01',platform:'WhatsApp',identifier:'+999000000011',sourceRow:1,teamName:'秋菊组',liveRoomName:'海外一线',raw:'不应发布的原文'}], excludedCells:[{raw:'封号'},{raw:'/'}] };
}
test('名册只生成显式字段，不发布原文、备注或虚构任期',()=>{
  const directory=buildServiceDirectory(source());
  assert.equal(directory.accounts[0].registeredHolderId,directory.people[0].id);
  assert.equal(directory.tenureStart,null);assert.equal(directory.accounts[0].createdAt,null);
  assert.deepEqual(directory.excluded,{banned:1,blank:1});
  assert.equal(JSON.stringify(directory).includes('不应发布'),false);
});
test('拒绝重复账号、未知人员和未确认的小组归属',()=>{
  const duplicate=source();duplicate.accounts.push({...duplicate.accounts[0],sourceRow:2});assert.throws(()=>buildServiceDirectory(duplicate));
  const unknown=source();unknown.accounts[0].personDraftId='missing';assert.throws(()=>buildServiceDirectory(unknown));
  const group=source();group.accounts[0].teamName='另一组';assert.throws(()=>buildServiceDirectory(group));
});
test('加粉表已分组的客服按一线二线显示，不沿用未分组时的海外一线',()=>{
  const yezi=source();yezi.people[0].name='叶子';
  const built=buildServiceDirectory(yezi);
  assert.deepEqual(built.people[0].rooms,['海外二线']);
  assert.equal(built.accounts[0].registeredRoomName,'海外二线');
  assert.equal(built.accounts[0].registeredHostName,'甜甜');
  const both=source();both.people[0].name='小雪';
  assert.equal(buildServiceDirectory(both).accounts[0].registeredRoomName,'海外一线、海外二线');
});
test('按原文保留13位Messenger ID，不补0或截断',()=>{
  const payload=source();payload.accounts[0].platform='Messenger';payload.accounts[0].identifier='6150000000011';
  assert.equal(buildServiceDirectory(payload).accounts[0].accountIdentifier,'6150000000011');
});
