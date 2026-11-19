import { useEffect, useRef, useState, type ReactNode } from "react";
import { dashboardPresetRange } from "./dates";
import "./period-toolbar.css";

export type StandardPreset = "day" | "week" | "month";
export const STANDARD_PRESETS: readonly [StandardPreset, string][] = [
  ["day", "今日"],
  ["week", "本周"],
  ["month", "本月"]
];

function daySpan(from: string, to: string): number {
  const a = Date.parse(from + "T00:00:00Z");
  const b = Date.parse(to + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
  return Math.floor((b - a) / 86400000) + 1;
}

export function PeriodToolbar({
  today,
  preset,
  custom,
  onPreset,
  onCustom,
  maxDays,
  filters,
  caption,
  actions,
  ariaLabel = "日期与筛选工具栏"
}: {
  today: string;
  preset: StandardPreset;
  custom?: { from: string; to: string } | null;
  onPreset: (next: StandardPreset) => void;
  onCustom: (range: { from: string; to: string }) => void;
  maxDays?: number;
  filters?: ReactNode;
  caption?: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
}) {
  const activeRange = custom ?? dashboardPresetRange(today, preset);
  const [draft, setDraft] = useState(activeRange);
  const [dateError, setDateError] = useState("");
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setDraft(custom ?? dashboardPresetRange(today, preset));
  }, [today, preset, custom?.from, custom?.to]);

  function submitCustom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.from || !draft.to || draft.from > draft.to || draft.to > today) {
      setDateError("请选择有效日期，结束日期不能晚于今天");
      return;
    }
    if (maxDays && daySpan(draft.from, draft.to) > maxDays) {
      setDateError(`自定义日期最多查询 ${maxDays} 天`);
      return;
    }
    setDateError("");
    onCustom({ ...draft });
    detailsRef.current?.removeAttribute("open");
  }

  return (
    <div className="period-toolbar-wrap">
      <div className="period-toolbar" role="region" aria-label={ariaLabel}>
        <div className="period-toolbar-left">
          <div className="overview-segments" role="group" aria-label="统计区间">
            {STANDARD_PRESETS.map(([key, label]) => {
              const selected = !custom && preset === key;
              return (
                <button
                  key={key}
                  type="button"
                  className={selected ? "selected" : ""}
                  aria-pressed={selected}
                  onClick={() => {
                    setDateError("");
                    detailsRef.current?.removeAttribute("open");
                    onPreset(key);
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <details ref={detailsRef} className={`pt-custom${custom ? " is-active" : ""}`}>
            <summary>{custom ? `${custom.from.slice(5)} ~ ${custom.to.slice(5)}` : "自定义日期"}</summary>
            <form className="pt-custom-form" onSubmit={submitCustom}>
              <label>
                开始日期
                <input
                  required
                  type="date"
                  max={draft.to || today}
                  value={draft.from}
                  onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                />
              </label>
              <label>
                结束日期
                <input
                  required
                  type="date"
                  min={draft.from}
                  max={today}
                  value={draft.to}
                  onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                />
              </label>
              <div className="pt-custom-actions">
                <button type="submit">查询</button>
                {maxDays && <small>最多 {maxDays} 天</small>}
              </div>
            </form>
          </details>
          {filters && <div className="period-toolbar-filters">{filters}</div>}
        </div>
        {(caption || actions) && (
          <div className="period-toolbar-right">
            {caption && <span className="period-toolbar-caption">{caption}</span>}
            {actions}
          </div>
        )}
      </div>
      {dateError && (
        <p className="error period-toolbar-error" role="alert">
          {dateError}
        </p>
      )}
    </div>
  );
}
