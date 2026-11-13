/* Demo-only assessment facts. No storage, database, network, or write API. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CmsAssessmentFoundation = api;
})(typeof window === "object" ? window : globalThis, function () {
  "use strict";
  const shift = (date, days) => new Date(Date.parse(date + "T00:00:00Z") + days * 86400000).toISOString().slice(0, 10);
  function cover(tenures, accountId, date) {
    const rows = tenures.filter((row) => row.accountId === accountId && row.startDate <= date && (row.endDate === null || row.endDate >= date));
    return rows.length === 1 ? rows[0] : null;
  }
  function build(today) {
    const employees = [
      { id: "demo-staff-jia", code: "CS-DEMO-01", name: "\u6f14\u793a\u5ba2\u670d\u7532", status: "active", teamId: "demo-team-a" },
      { id: "demo-staff-yi", code: "CS-DEMO-02", name: "\u6f14\u793a\u5ba2\u670d\u4e59", status: "active", teamId: "demo-team-b" },
      { id: "demo-staff-bing", code: "CS-DEMO-03", name: "\u6f14\u793a\u5ba2\u670d\u4e19", status: "active", teamId: "demo-team-a" },
      { id: "demo-staff-former", code: "CS-DEMO-00", name: "\u6f14\u793a\u524d\u4efb\u5ba2\u670d", status: "left", teamId: "demo-team-a" }
    ];
    const formerEnd = shift(today, -2), bingStart = shift(today, -1);
    const tenures = [
      { id: "demo-tenure-jia", accountId: "demo-wechat-1", employeeId: "demo-staff-jia", startDate: "2026-10-01", endDate: null },
      { id: "demo-tenure-yi", accountId: "demo-wechat-2", employeeId: "demo-staff-yi", startDate: "2026-10-01", endDate: null },
      { id: "demo-tenure-former", accountId: "demo-wechat-3", employeeId: "demo-staff-former", startDate: "2026-10-01", endDate: formerEnd },
      { id: "demo-tenure-bing", accountId: "demo-wechat-3", employeeId: "demo-staff-bing", startDate: bingStart, endDate: null }
    ];
    const oldDay = shift(today, -4);
    const lead = (id, date, employeeId, contact, qualified, invalidReason) => ({ id, accountId: "demo-wechat-3", businessDate: date, employeeId, pageName: "\u6f14\u793a\u4e3b\u9875 C", channel: "ms", contact, qualified, invalidReason });
    const leads = [
      lead("seal-lead-1", oldDay, "demo-staff-former", "replied", true, ""),
      lead("seal-lead-2", oldDay, "demo-staff-former", "replied", false, ""),
      lead("seal-lead-3", oldDay, "demo-staff-former", "invalid", false, "no_chinese"),
      lead("seal-lead-4", oldDay, "demo-staff-former", "read_no_reply", false, ""),
      lead("seal-lead-5", bingStart, "demo-staff-bing", "replied", true, ""),
      lead("seal-lead-6", bingStart, "demo-staff-bing", "invalid", false, "misclick")
    ];
    const attendance = [
      { id: "seal-attendance-former", accountId: "demo-wechat-3", businessDate: oldDay, employeeId: "demo-staff-former", roomCode: "DEMO-LIVE-01", roomName: "\u6f14\u793a\u4e00\u7ebf", enteredCount: 12, orderedCustomerIds: ["seal-customer-1", "seal-customer-2", "seal-customer-3"], orderLink: "linked", source: "\u865a\u6784\u76f4\u64ad\u95f4\u540e\u53f0\u8bb0\u5f55" },
      { id: "seal-attendance-bing", accountId: "demo-wechat-3", businessDate: bingStart, employeeId: "demo-staff-bing", roomCode: "DEMO-LIVE-01", roomName: "\u6f14\u793a\u4e00\u7ebf", enteredCount: 4, orderedCustomerIds: [], orderLink: "linked", source: "\u865a\u6784\u76f4\u64ad\u95f4\u540e\u53f0\u8bb0\u5f55" },
      { id: "seal-attendance-jia", accountId: "demo-wechat-1", businessDate: today, employeeId: "demo-staff-jia", roomCode: "DEMO-LIVE-01", roomName: "\u6f14\u793a\u4e00\u7ebf", enteredCount: 12, orderedCustomerIds: [], orderLink: "unlinked", source: "\u865a\u6784\u76f4\u64ad\u95f4\u540e\u53f0\u8bb0\u5f55" }
    ];
    const addLead = (id, accountId, date, employeeId, contact, qualified) => leads.push({ id, accountId, businessDate: date, employeeId, pageName: accountId === "demo-wechat-2" ? "演示主页乙" : "演示主页甲", channel: "ms", contact, qualified, invalidReason: "" });
    const wave = (prefix, accountId, employeeId, date, qualified, plain) => {
      for (let index = 0; index < qualified; index += 1) addLead(prefix + "-q" + index, accountId, date, employeeId, "replied", true);
      for (let index = 0; index < plain; index += 1) addLead(prefix + "-p" + index, accountId, date, employeeId, "replied", false);
    };
    const attend = (id, accountId, date, employeeId, entered, ordered) => attendance.push({ id, accountId, businessDate: date, employeeId, roomCode: "DEMO-LIVE-01", roomName: "演示一线", enteredCount: entered, orderedCustomerIds: Array.from({ length: ordered }, (_, index) => id + "-c" + index), orderLink: "linked", source: "虚构直播间后台记录" });
    wave("jia6", "demo-wechat-1", "demo-staff-jia", shift(today, -6), 1, 3);
    wave("jia5", "demo-wechat-1", "demo-staff-jia", shift(today, -5), 2, 2);
    wave("jia4", "demo-wechat-1", "demo-staff-jia", shift(today, -4), 2, 3);
    wave("jia3", "demo-wechat-1", "demo-staff-jia", shift(today, -3), 2, 0);
    wave("jia2", "demo-wechat-1", "demo-staff-jia", shift(today, -2), 3, 3);
    addLead("jia1-u0", "demo-wechat-1", shift(today, -1), "demo-staff-jia", "unread", false);
    addLead("jia1-u1", "demo-wechat-1", shift(today, -1), "demo-staff-jia", "unread", false);
    attend("jia-a6", "demo-wechat-1", shift(today, -6), "demo-staff-jia", 8, 2);
    attend("jia-a5", "demo-wechat-1", shift(today, -5), "demo-staff-jia", 10, 2);
    attend("jia-a4", "demo-wechat-1", shift(today, -4), "demo-staff-jia", 10, 3);
    attend("jia-a3", "demo-wechat-1", shift(today, -3), "demo-staff-jia", 6, 1);
    attend("jia-a2", "demo-wechat-1", shift(today, -2), "demo-staff-jia", 12, 4);
    attend("jia-a1", "demo-wechat-1", shift(today, -1), "demo-staff-jia", 5, 0);
    wave("yi3", "demo-wechat-2", "demo-staff-yi", shift(today, -3), 1, 2);
    attend("yi-a3", "demo-wechat-2", shift(today, -3), "demo-staff-yi", 9, 1);

    for (const row of leads.concat(attendance)) {
      const tenure = cover(tenures, row.accountId, row.businessDate);
      if (!tenure || tenure.employeeId !== row.employeeId) throw Error("sealed attribution does not match tenure: " + row.id);
    }
    return { employees, tenures, leads, attendance };
  }
  function invalidFacts(leads) {
    const grouped = new Map();
    for (const lead of leads) {
      const key = lead.businessDate + "|" + lead.pageName;
      const row = grouped.get(key) || { businessDate: lead.businessDate, pageName: lead.pageName, received: 0, no_chinese: 0, misclick: 0, obscene: 0, unspecified: 0 };
      row.received += 1;
      if (lead.contact === "invalid") row[lead.invalidReason] !== undefined ? row[lead.invalidReason] += 1 : row.unspecified += 1;
      grouped.set(key, row);
    }
    return [...grouped.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate) || a.pageName.localeCompare(b.pageName));
  }
  const notes = {
    directory: "\u5458\u5de5\u7f16\u53f7\u548c\u8d26\u53f7\u4f7f\u7528\u671f\u95f4\u4f9b\u7ba1\u7406\u6838\u5bf9\u3002\u8fd9\u91cc\u4e0d\u63d0\u4f9b\u8fdb\u7c89\u3001\u5165\u573a\u548c\u5f00\u5355\u6570\u636e\u3002",
    capture: "\u586b\u62a5\u5f52\u5c5e\u6309\u4e1a\u52a1\u65e5\u7684\u8d26\u53f7\u4f7f\u7528\u4eba\u786e\u5b9a\u3002\u6f14\u793a\u8bd5\u586b\u4e0d\u5199\u5165\u670d\u52a1\u5668\u3002\u5df2\u5c01\u5b58\u7684\u793a\u4f8b\u4e0d\u4f1a\u56e0\u5f53\u524d\u6301\u6709\u4eba\u53d8\u5316\u800c\u6539\u5199\u3002",
    review: "\u5f00\u53e3\u8f6c\u5316\u7387\u6309\u540c\u4e00\u6279\u65b0\u5ba2\u6237\u8ba1\u7b97\uff1a\u5df2\u660e\u786e\u5177\u4f53\u9700\u6c42\u7684\u4eba\u6570\u00f7\u5df2\u6b63\u5e38\u6c9f\u901a\u7684\u4eba\u6570\u3002\u5f00\u5355\u7387\u53ea\u6709\u5165\u573a\u5ba2\u6237\u4e0e\u5f00\u5355\u5ba2\u6237\u5df2\u5173\u8054\u65f6\u624d\u8ba1\u7b97\u3002\u65e0\u6548\u7c89\u4e0d\u8fdb\u5165\u5f00\u53e3\u8f6c\u5316\u7387\u5206\u6bcd\uff0c\u4e5f\u4e0d\u4f5c\u4e3a\u5ba2\u670d\u8003\u6838\u3002\u8d8b\u52bf\u56fe\u5728\u4e0b\u4e00\u6b65\u3002",
    invalid: "\u65e0\u6548\u7c89\u6309\u56fa\u5b9a\u539f\u56e0\u6c47\u603b\uff0c\u4f9b\u6295\u653e\u8d28\u91cf\u6838\u5bf9\uff0c\u4e0d\u8bc4\u4ef7\u5ba2\u670d\u3002\u8d8b\u52bf\u56fe\u5728\u4e0b\u4e00\u6b65\u3002\u539f\u56e0\u672a\u533a\u5206\u65f6\u663e\u793a\u5f85\u8865\uff0c\u4e0d\u8bb0\u4e3a\u96f6\u3002"
  };
  function present(input) {
    const today = input.today, role = input.role, accounts = input.accounts || [], orders = input.orders || [];
    const model = build(today);
    const visible = new Set(accounts.map((account) => account.id));
    const tenures = model.tenures.filter((row) => visible.has(row.accountId));
    const employeeIds = new Set(tenures.map((row) => row.employeeId));
    const employees = model.employees.filter((row) => employeeIds.has(row.id));
    const leads = model.leads.filter((row) => visible.has(row.accountId));
    const attendance = model.attendance.filter((row) => visible.has(row.accountId));
    const holderCheck = accounts.map((account) => {
      const open = tenures.filter((row) => row.accountId === account.id && row.endDate === null);
      const employee = open.length === 1 ? employees.find((row) => row.id === open[0].employeeId) : null;
      return { accountId: account.id, matched: !!(employee && employee.name === account.holderName) };
    });
    const base = { version: "assessment-foundation/v1", demo: true, today };
    if (role === "admin") return { ...base, view: "directory", employees, tenures, holderCheck, note: notes.directory };
    if (role === "ops") return { ...base, view: "invalid", invalid: invalidFacts(model.leads), note: notes.invalid };
    if (role === "cs") return { ...base, view: "capture", employees, tenures, attendance, holderCheck, note: notes.capture };
    if (role === "boss" || role === "cs_supervisor") {
      const attributed = orders.filter((order) => visible.has(order.accountId)).map((order) => {
        const tenure = cover(model.tenures, order.accountId, order.businessDate);
        return { id: order.id, accountId: order.accountId, businessDate: order.businessDate, customerLabel: order.customerLabel || "", employeeId: tenure ? tenure.employeeId : null, countsAsOrder: !order.cancelled && order.status !== "refunded" };
      });
      return { ...base, view: "review", employees, tenures, leads, attendance, orders: attributed, holderCheck, note: notes.review };
    }
    return null;
  }
  return { build, present };
});
