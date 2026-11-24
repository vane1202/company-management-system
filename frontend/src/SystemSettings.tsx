import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";

export function SystemSettings({ defaultDays }: { defaultDays: number }) {
  const [days, setDays] = useState(String(defaultDays));
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { api.settings().then((data) => setDays(data.settings.fan_report_backfill_days || String(defaultDays))).catch((err) => setError(toErrorMessage(err))); }, []);
  return <section className="card"><h2>系统参数设置</h2><form onSubmit={async (event) => { event.preventDefault(); if (pending) return; setPending(true); setError(""); try { await api.saveSettings(Number(days)); toast.success(`加粉补报窗口已保存为 ${Number(days)} 个业务日（含当天）；客服下次加载按新设置执行。`); } catch (err) { const text = toErrorMessage(err, "保存失败"); setError(text); toast.error(`系统设置未保存：${text}`); } finally { setPending(false); } }}><label className="row">加粉补报窗口（业务日，1–60 天）<input required type="number" min="1" max="60" step="1" value={days} onChange={(e) => setDays(e.target.value)} /></label><button disabled={pending}>{pending ? "保存中…" : "保存系统设置"}</button>{error && <p className="error" role="alert">{error}</p>}</form></section>;
}
