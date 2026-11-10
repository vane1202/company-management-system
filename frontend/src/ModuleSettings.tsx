import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";
export function ModuleSettings({ onError, onChange }: { onError: (value: string) => void; onChange: (modules: Record<string, boolean>) => void }) {
  const [config, setConfig] = useState<Awaited<ReturnType<typeof api.modules>> | null>(null);
  const [pending, setPending] = useState(false);
  async function load() { const next = await api.modules(); setConfig(next); onChange(next.modules); }
  useEffect(() => { load().catch((err) => onError(toErrorMessage(err))); }, []);
  return <section className="card"><h2>模块管理</h2><p className="notice">停用后隐藏填报入口并禁止业务写入，历史数据和审核记录保留。人员、权限、审核和本配置入口保持可用。新增页面、字段和流程由后续开发接入。</p>
    <button type="button" disabled={pending} className="secondary" onClick={() => load().catch((err) => onError(toErrorMessage(err)))}>重新加载</button>
    {config && <form onSubmit={async (event) => {
      event.preventDefault(); if (pending) return; setPending(true);
      try { const next = await api.saveModules(config.version, config.modules); setConfig(next); onChange(next.modules); onError(""); const off = Object.entries(next.modules).filter(([, on]) => !on).map(([key]) => next.labels[key] ?? key); toast.success(`模块配置已保存（${off.length ? `停用：${off.join("、")}` : "全部启用"}），历史记录未删除。`); }
      catch (err) { const text = toErrorMessage(err, "保存失败"); onError(text); toast.error(`模块配置未保存：${text}`); }
      finally { setPending(false); }
    }}>
      {Object.entries(config.labels).map(([key, label]) => <label className="review-card" key={key} style={{ display: "block" }}><input type="checkbox" disabled={pending} checked={config.modules[key]} onChange={(e) => setConfig({ ...config, modules: { ...config.modules, [key]: e.target.checked } })} /> {label} · {config.modules[key] ? "启用" : "停用"}</label>)}
      <button disabled={pending} type="submit">{pending ? "保存中…" : "保存模块配置"}</button>
    </form>}
  </section>;
}
