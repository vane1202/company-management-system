import { useEffect, useMemo, useState } from "react";
import { api, type ModuleConfigResponse } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";
import "./module-settings.css";

function formatChange(change: ModuleConfigResponse["lastChange"]): string {
  if (!change) return "";
  const when = new Date(change.at).toLocaleString("zh-CN", { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  return `上次修改：${change.by ?? "未知用户"}，${when}`;
}

export function ModuleSettings({ onError, onChange }: { onError: (value: string) => void; onChange: (modules: Record<string, boolean>) => void }) {
  const [config, setConfig] = useState<ModuleConfigResponse | null>(null);
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  async function load() { const next = await api.modules(); setConfig(next); setDraft(next.modules); onChange(next.modules); }
  useEffect(() => { load().catch((err) => onError(toErrorMessage(err))); }, []);

  const changed = useMemo(() => config ? Object.keys(config.labels).filter((key) => draft[key] !== config.modules[key]) : [], [config, draft]);
  const turningOff = config ? changed.filter((key) => config.modules[key] && !draft[key]) : [];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!config || pending || !changed.length) return;
    if (turningOff.length) {
      const names = turningOff.map((key) => config.labels[key]).join("、");
      if (!window.confirm(`确认停用：${names}？\n\n对应角色将看不到入口，也无法新增或修改数据；历史数据保留，可随时重新启用。`)) return;
    }
    setPending(true);
    try {
      const next = await api.saveModules(config.version, Object.fromEntries(changed.map((key) => [key, draft[key]])));
      setConfig(next); setDraft(next.modules); onChange(next.modules); onError("");
      const off = Object.entries(next.modules).filter(([, on]) => !on).map(([key]) => next.labels[key] ?? key);
      toast.success(`模块配置已保存（${off.length ? `停用：${off.join("、")}` : "全部启用"}），历史记录未删除。`);
    } catch (err) {
      const text = toErrorMessage(err, "保存失败"); onError(text); toast.error(`模块配置未保存：${text}`);
    } finally { setPending(false); }
  }

  return <section className="card module-settings">
    <div className="module-head">
      <div>
        <h2>模块管理</h2>
        <p className="notice">停用后，对应角色看不到填报入口，新增和修改会被拒绝；历史数据全部保留，随时可重新启用。人员、权限、工资、财务收付款和本页不受影响。</p>
      </div>
      <button type="button" disabled={pending} className="secondary" onClick={() => {
        if (changed.length && !window.confirm("放弃尚未保存的修改并重新加载？")) return;
        load().catch((err) => onError(toErrorMessage(err)));
      }}>重新加载</button>
    </div>
    {config && <form onSubmit={save}>
      {formatChange(config.lastChange) && <p className="module-last-change">{formatChange(config.lastChange)}</p>}
      <ul className="module-list">
        {Object.entries(config.labels).map(([key, label]) => {
          const on = !!draft[key], dirty = changed.includes(key), detail = config.details?.[key];
          return <li key={key} className={`module-row${on ? "" : " off"}${dirty ? " dirty" : ""}`}>
            <label>
              <input type="checkbox" role="switch" className="module-switch" disabled={pending} checked={on} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
              <span className="module-text">
                <span className="module-title"><strong>{label}</strong><span className={`module-state ${on ? "on" : "off"}`}>{on ? "启用" : "已停用"}</span>{dirty && <span className="module-dirty">未保存</span>}</span>
                {detail && <span className="module-summary">{detail.summary}</span>}
                {detail && <span className="module-roles">影响角色：{detail.roles.join("、")}</span>}
              </span>
            </label>
          </li>;
        })}
      </ul>
      <div className="module-actions">
        <button disabled={pending || !changed.length} type="submit">{pending ? "保存中…" : "保存模块配置"}</button>
        {changed.length > 0 && <button type="button" className="secondary" disabled={pending} onClick={() => setDraft(config.modules)}>放弃修改</button>}
        <span className="module-hint" role="status">{changed.length ? `已修改 ${changed.length} 项，尚未保存${turningOff.length ? `，其中 ${turningOff.length} 项将停用` : ""}` : "没有未保存的修改"}</span>
      </div>
    </form>}
  </section>;
}
