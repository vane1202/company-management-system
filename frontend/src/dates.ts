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
