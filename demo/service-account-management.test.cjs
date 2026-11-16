const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apply } = require('./service-account-management.js');
const fixture = () => ({ enabled: true, people: [{ id: 'old', name: '旧客服' }, { id: 'next', name: '新客服' }], team: { id: 't', name: '小组', roomName: '直播间', hostName: '主播' }, accounts: ['a', 'b'].map((id, i) => ({ id, isActive: true, teamId: 't', registeredHolderId: 'old', holderName: '旧客服', platform: 'whatsapp', accountIdentifier: '+861380000000' + i })) });
const context = { role: 'cs_supervisor', today: '2026-11-15', id: 'trial', actor: '主管', createdAt: '2026-11-15T00:00:00Z' };
const handover = { kind: 'handover', teamId: 't', accountIds: ['a', 'b'], employeeId: 'next', effectiveOn: '2026-11-15', reason: '离职交接', markLeft: true };

test('交接封存旧任期，更新多个账号，原始名册保持不变', () => {
  const source = fixture();
  const next = apply(source, handover, context);
  assert.equal(source.accounts[0].registeredHolderId, 'old');
  assert.equal(next.people.find(p => p.id === 'old').status, 'left');
  assert.ok(next.accounts.every(a => a.registeredHolderId === 'next'));
  assert.deepEqual(next.accounts[0].holderHistory, [{ employeeId: 'old', name: '旧客服', startDate: null, endDate: '2026-11-14' }, { employeeId: 'next', name: '新客服', startDate: '2026-11-15', endDate: null }]);
  assert.equal(next.managementHistory[0].actor, '主管');
  assert.equal(next.managementHistory[0].fromEmployeeId, 'old');
});

test('拦截跨组、非主管、交给自己、无原因、未来日期和未完成交接的离职', () => {
  for (const patch of [{ teamId: 'other' }, { employeeId: 'old' }, { reason: '' }, { effectiveOn: '2026-11-16' }, { effectiveOn: '2026-02-30' }, { accountIds: ['missing'] }, { accountIds: ['a'] }]) assert.throws(() => apply(fixture(), { ...handover, ...patch }, context));
  assert.throws(() => apply(fixture(), handover, { ...context, role: 'cs' }));
});

test('新客服及新增接待账号记录起始日；阻止重复平台账号和同名员工', () => {
  const input = { kind: 'create', teamId: 't', employeeId: 'new', employeeName: '新同事', platform: 'messenger', identifier: '1000000000001', effectiveOn: '2026-11-15' };
  const next = apply(fixture(), input, context);
  assert.equal(next.accounts.at(-1).registeredHolderId, 'trial-person');
  assert.equal(next.accounts.at(-1).holderSince, '2026-11-15');
  assert.throws(() => apply(next, { ...input, employeeId: 'trial-person' }, { ...context, id: 'again' }));
  assert.throws(() => apply(fixture(), { ...input, employeeName: '旧客服' }, context));
  assert.throws(() => apply(fixture(), { ...input, platform: 'whatsapp', identifier: '13800000000' }, context));
});

test('已有明确任期的账号不能重复或倒序交接', () => {
  const next = apply(fixture(), handover, context);
  const second = { ...handover, employeeId: 'new', employeeName: '再接手', markLeft: false };
  assert.throws(() => apply(next, second, { ...context, id: 'another' }));
});
