export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  return (
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day
  );
}

export function canQueryByDate(value: string): boolean {
  return isIsoDate(value);
}

export function pickBusinessDate(incoming: string, current: string): string {
  if (isIsoDate(incoming) && (!current || current === incoming || !isIsoDate(current))) {
    return incoming;
  }
  return current;
}

export function dashboardPresetRange(today:string,preset:string):{from:string;to:string}{
  if(!isIsoDate(today))return{from:today,to:today};
  if(preset==='month')return{from:today.slice(0,8)+'01',to:today};
  if(preset==='week'){const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);return{from:d.toISOString().slice(0,10),to:today};}
  return{from:today,to:today};
}
