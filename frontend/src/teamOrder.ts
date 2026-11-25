const standardTeams = ["客服一组", "客服二组", "客服三组", "志伟组"];
const teamRank = (name: string) => {
  const index = standardTeams.indexOf(name.trim());
  return index < 0 ? standardTeams.length : index;
};

export function compareTeamNames(a: string, b: string) {
  return teamRank(a) - teamRank(b) || a.localeCompare(b, "zh-CN");
}

export function sortTeams<T extends {name: string}>(teams: readonly T[]) {
  return [...teams].sort((a,b)=>compareTeamNames(a.name,b.name));
}
