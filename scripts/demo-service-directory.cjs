function buildServiceDirectory(source) {
  const people = source.people.map(person => ({ id: 'registered-' + person.id, name: person.name }));
  if (new Set(people.map(person => person.id)).size !== people.length) throw Error('名册人员编号重复');
  const accounts = source.accounts.map(account => {
    const personId = 'registered-' + account.personDraftId;
    const person = people.find(person => person.id === personId);
    if (!person || account.teamName !== '秋菊组' || account.liveRoomName !== '海外一线') throw Error('名册人员或小组归属不匹配');
    const platform = account.platform === 'WhatsApp' ? 'whatsapp' : account.platform === 'Messenger' ? 'messenger' : '';
    if (!platform || !(platform === 'whatsapp' ? /^\+[1-9]\d{7,14}$/ : /^\d{5,30}$/).test(account.identifier)) throw Error('名册账号格式无效');
    return {
      id: 'registered-' + platform + '-' + account.sourceRow,
      wechatId: account.platform + ' · ' + account.identifier,
      platform, accountIdentifier: account.identifier,
      phoneLabel: null, holderName: person.name, isActive: true,
      teamId: 'registered-team-qiuju', teamName: '秋菊组', createdAt: null,
      registeredHolderId: personId, registeredRoomName: '海外一线', registeredHostName: '甜甜'
    };
  });
  if (new Set(accounts.map(account => account.platform + ':' + account.accountIdentifier)).size !== accounts.length || new Set(accounts.map(account => account.id)).size !== accounts.length) throw Error('名册平台账号重复');
  return { enabled: true, version: 'service-directory/v1', confirmedOn: source.confirmedOn, team: { id: 'registered-team-qiuju', name: '秋菊组', roomName: '海外一线', hostName: '甜甜', supervisorName: '秋菊' }, people, accounts, excluded: { banned: source.excludedCells.filter(cell => cell.raw === '封号').length, blank: source.excludedCells.filter(cell => cell.raw === '/').length }, tenureStart: null };
}
module.exports = { buildServiceDirectory };
