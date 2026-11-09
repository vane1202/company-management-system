/**
 * 7 天趋势线（概览用，无坐标轴）。null = 当天无填报，线条在此断开；最后一天若为今天（未结束）画虚线。
 * 纵轴从 0 到窗口最大值；灰色线，最新点用主色。
 */
export function Sparkline({ values, dates, partialLast, width = 56, height = 24, label }: { values: (number | null)[]; dates: string[]; partialLast: boolean; width?: number; height?: number; label: string }) {
  const max = Math.max(1, ...values.filter((v): v is number => v != null));
  const n = values.length, pad = 2;
  const x = (i: number) => n <= 1 ? width / 2 : pad + (i * (width - pad * 2)) / (n - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  const solid: string[] = [], dashed: string[] = [];
  for (let i = 1; i < n; i++) {
    const a = values[i - 1], b = values[i];
    if (a == null || b == null) continue;
    (partialLast && i === n - 1 ? dashed : solid).push(`M${x(i - 1).toFixed(1)},${y(a).toFixed(1)}L${x(i).toFixed(1)},${y(b).toFixed(1)}`);
  }
  let last = -1; for (let i = n - 1; i >= 0; i--) if (values[i] != null) { last = i; break; }
  const summary = `${label}：` + values.map((v, i) => `${dates[i]?.slice(5) ?? ""} ${v == null ? "未报" : v}${partialLast && i === n - 1 ? "（今日未结束）" : ""}`).join("，");
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
    <title>{summary}</title>
    {solid.length > 0 && <path d={solid.join("")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
    {dashed.length > 0 && <path d={dashed.join("")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 2.5" strokeLinecap="round" />}
    {last >= 0 && <circle className="sparkline-dot" cx={x(last)} cy={y(values[last]!)} r="2.2" />}
  </svg>;
}
