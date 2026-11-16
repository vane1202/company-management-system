export function opsBossPeriod(today: string, preset: string) {
  const year=today.slice(0,4),month=Number(today.slice(5,7));
  return {from:preset==='year'?year+'-01-01':preset==='quarter'?year+'-'+String(Math.floor((month-1)/3)*3+1).padStart(2,'0')+'-01':preset==='month'?today.slice(0,8)+'01':today,to:today};
}
