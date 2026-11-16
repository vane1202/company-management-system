(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CmsSupervisorConsultationCost = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function daily(rows, links, teamId, date) {
    const active = links.filter(link => link.from <= date && (!link.to || link.to >= date));
    const selected = active.filter(link => link.teamId === teamId);
    const accounts = [...new Set(selected.map(link => link.account))];
    if (!accounts.length) return { date, status: "unlinked", spendUsd: null, consultCount: null, recordCount: 0 };
    if (accounts.some(account => active.some(link => link.account === account && link.teamId !== teamId))) return { date, status: "ambiguous", spendUsd: null, consultCount: null, recordCount: 0 };
    const scoped = rows.filter(row => accounts.includes(row.adAccountRef) && row.businessDate === date && !row.voided);
    if (!scoped.length) return { date, status: "empty", spendUsd: null, consultCount: null, recordCount: 0 };
    if (accounts.some(account => !scoped.some(row => row.adAccountRef === account))) return { date, status: "incomplete", spendUsd: null, consultCount: null, recordCount: scoped.length };
    const complete = scoped.every(row => typeof row.spendUsd === "string" && /^\d+(?:\.\d{1,2})?$/.test(row.spendUsd) && Number.isSafeInteger(row.consultCount) && row.consultCount >= 0);
    if (!complete) return { date, status: "incomplete", spendUsd: null, consultCount: null, recordCount: scoped.length };
    const total = scoped.reduce((sum, row) => { const [a, b = ""] = row.spendUsd.split("."); return sum + BigInt(a) * 100n + BigInt(b.padEnd(2, "0")); }, 0n);
    const count = scoped.reduce((sum, row) => sum + row.consultCount, 0);
    return { date, status: count ? "ready" : "zero_consultations", spendUsd: `${total / 100n}.${String(total % 100n).padStart(2, "0")}`, consultCount: count, recordCount: scoped.length };
  }
  function build({ rows, links = [], team, date }) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || Number.isNaN(Date.parse(date)) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date) throw Error("请选择有效业务日期");
    const previous = new Date(Date.parse(date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    return { version: "supervisor-consultation-cost/v1", scope: "team", team, current: daily(rows, links, team.id, date), previous: daily(rows, links, team.id, previous), definition: "本组关联广告户人民币参考消耗合计÷广告咨询次数合计；不是客服接粉成本。" };
  }
  return { build };
});
