const STANDARD_TEAMS = ["客服一组", "客服二组", "客服三组", "志伟组"];

export function teamOrderSql(alias?: string) {
  const col = alias ? `${alias}.name` : "name";
  return `CASE ${col} WHEN '客服一组' THEN 1 WHEN '客服二组' THEN 2 WHEN '客服三组' THEN 3 WHEN '志伟组' THEN 4 ELSE 5 END, ${col}`;
}

export function compareTeamNames(a: string, b: string) {
  const rank = (name: string) => {
    const idx = STANDARD_TEAMS.indexOf(name.trim());
    return idx < 0 ? STANDARD_TEAMS.length : idx;
  };
  return rank(a) - rank(b) || a.localeCompare(b, "zh-CN");
}
