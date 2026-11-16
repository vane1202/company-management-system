(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CmsServiceAccountManagement = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || "") && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  function apply(directory, input, context) {
    if (!["cs_supervisor", "admin"].includes(context.role)) throw Error("仅本组主管或管理员可管理接待账号");
    if (!directory?.enabled || input.teamId !== directory.team.id) throw Error("只能管理当前小组的账号");
    const next = JSON.parse(JSON.stringify(directory));
    const date = input.effectiveOn;
    if (!validDate(date) || date > context.today) throw Error("生效日期必须为有效日期，且不能晚于今天");
    const ids = new Set(next.accounts.map(account => account.id));
    const personId = String(input.employeeId || "");
    let person = next.people.find(employee => employee.id === personId && employee.status !== "left");
    if (personId === "new") {
      const name = String(input.employeeName || "").trim();
      if (!name || name.length > 40) throw Error("请填写40字以内的客服姓名");
      if (next.people.some(employee => employee.name === name && employee.status !== "left")) throw Error("已存在同名在职客服，请选择已有客服");
      person = { id: context.id + "-person", name, status: "active" };
      next.people.push(person);
    }
    if (!person) throw Error("请选择本组在职客服，或登记新客服");
    const event = { id: context.id, actor: context.actor, effectiveOn: date, createdAt: context.createdAt, kind: input.kind, toEmployeeId: person.id, toEmployeeName: person.name };
    if (input.kind === "create") {
      const platform = input.platform;
      const identifier = String(input.identifier || "").trim().replace(/\s/g, "");
      if (!['whatsapp', 'messenger'].includes(platform) || !(platform === 'whatsapp' ? /^\+[1-9]\d{7,14}$/ : /^\d{5,30}$/).test(identifier)) throw Error("WhatsApp请填写含国家区号的号码；Messenger请填写数字账号ID");
      if (next.accounts.some(account => account.platform === platform && account.accountIdentifier === identifier)) throw Error("该平台账号已登记，不能重复新增");
      if (ids.has(context.id)) throw Error("操作编号重复，请重新提交");
      next.accounts.push({ id: context.id, platform, accountIdentifier: identifier, wechatId: (platform === "whatsapp" ? "WhatsApp" : "Messenger") + " · " + identifier, phoneLabel: null, holderName: person.name, registeredHolderId: person.id, registeredRoomName: next.team.roomName, registeredHostName: next.team.hostName, teamId: next.team.id, teamName: next.team.name, createdAt: context.createdAt, isActive: true, holderSince: date, holderHistory: [{ employeeId: person.id, name: person.name, startDate: date, endDate: null }] });
      event.accountIds = [context.id];
      event.note = String(input.note || "").trim().slice(0, 300);
    } else if (input.kind === "handover") {
      const selected = [...new Set(input.accountIds || [])];
      if (!selected.length || selected.some(id => !ids.has(id))) throw Error("请选择本组要交接的账号");
      const accounts = selected.map(id => next.accounts.find(account => account.id === id));
      const fromId = accounts[0].registeredHolderId;
      if (accounts.some(account => account.registeredHolderId !== fromId || account.teamId !== next.team.id || !account.isActive)) throw Error("一次只能交接同一客服当前负责的本组在用账号");
      if (person.id === fromId) throw Error("新负责人不能与原负责人相同");
      const reason = String(input.reason || "").trim();
      if (!reason || reason.length > 300) throw Error("请填写300字以内的交接原因");
      for (const account of accounts) {
        if (account.holderSince && date <= account.holderSince) throw Error("交接日期须晚于该账号本次任期的起始日期；同一天请先核对负责人");
      }
      if (input.markLeft && next.accounts.some(account => account.registeredHolderId === fromId && account.isActive && !selected.includes(account.id))) throw Error("原客服仍有未交接账号，请全部交接后再标记离职");
      const previousDay = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
      event.accountIds = selected;
      event.fromEmployeeId = fromId;
      event.fromEmployeeName = accounts[0].holderName;
      event.note = reason;
      event.markLeft = !!input.markLeft;
      for (const account of accounts) {
        const history = account.holderHistory || [{ employeeId: fromId, name: account.holderName, startDate: null, endDate: null }];
        account.holderHistory = history.map(tenure => tenure.endDate ? tenure : { ...tenure, endDate: previousDay });
        account.holderHistory.push({ employeeId: person.id, name: person.name, startDate: date, endDate: null });
        account.registeredHolderId = person.id;
        account.holderName = person.name;
        account.holderSince = date;
      }
      if (input.markLeft) next.people.find(employee => employee.id === fromId).status = "left";
    } else throw Error("不支持的账号操作");
    next.managementHistory = [...(next.managementHistory || []), event];
    return next;
  }
  return { apply };
});
