function buildServiceDirectory(source) {
  const fanRooms = {
    "叶子": ["海外二线"], "小罗": ["海外二线"], "小赵": ["海外二线"], "杨杨": ["海外二线"], "阿杰": ["海外二线"],
    "小雪": ["海外一线", "海外二线"],
    "大川": ["海外一线"], "娇娇": ["海外一线"], "小伦": ["海外一线"], "小婷": ["海外一线"], "小江": ["海外一线"], "小雅": ["海外一线"], "张黛": ["海外一线"], "荣慧": ["海外一线"], "阿威": ["海外一线"]
  };
  const people = source.people.map(person => ({ id: "registered-" + person.id, name: person.name }));
  if (new Set(people.map(person => person.id)).size !== people.length) throw Error("名册人员编号重复");
  const accounts = source.accounts.map(account => {
    const personId = "registered-" + account.personDraftId;
    const person = people.find(item => item.id === personId);
    const rooms = person && fanRooms[person.name] ? fanRooms[person.name] : (account.liveRoomName === "海外一线" || account.liveRoomName === "海外二线" ? [account.liveRoomName] : null);
    if (!person || account.teamName !== "秋菊组" || !rooms) throw Error("名册人员或小组归属不匹配");
    const platform = account.platform === "WhatsApp" ? "whatsapp" : account.platform === "Messenger" ? "messenger" : "";
    if (!platform || !(platform === "whatsapp" ? /^\+[1-9]\d{7,14}$/ : /^\d{5,30}$/).test(account.identifier)) throw Error("名册账号格式无效");
    person.rooms = rooms;
    return {
      id: "registered-" + platform + "-" + account.sourceRow,
      wechatId: account.platform + " · " + account.identifier,
      platform, accountIdentifier: account.identifier,
      phoneLabel: null, holderName: person.name, isActive: true,
      teamId: "registered-team-qiuju", teamName: "秋菊组", createdAt: null,
      registeredHolderId: personId, registeredRoomName: rooms.join("、"), registeredHostName: "甜甜"
    };
  });
  if (new Set(accounts.map(account => account.platform + ":" + account.accountIdentifier)).size !== accounts.length || new Set(accounts.map(account => account.id)).size !== accounts.length) throw Error("名册平台账号重复");
  const roomName = ["海外一线", "海外二线"].filter(name => accounts.some(account => account.registeredRoomName.split("、").includes(name))).join("、");
  return { enabled: true, version: "service-directory/v1", confirmedOn: source.confirmedOn, team: { id: "registered-team-qiuju", name: "秋菊组", roomName, hostName: "甜甜", supervisorName: "秋菊" }, people, accounts, excluded: { banned: source.excludedCells.filter(cell => cell.raw === "封号").length, blank: source.excludedCells.filter(cell => cell.raw === "/").length }, tenureStart: null };
}
module.exports = { buildServiceDirectory };
