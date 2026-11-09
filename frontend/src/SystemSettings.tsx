import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";

export function SystemSettings({ defaultDays }: { defaultDays: number }) {
  const [days, setDays] = useState(String(defaultDays));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => { api.settings().then((data) => setDays(data.settings.fan_report_backfill_days || String(defaultDays))).catch((err) => setError(toErrorMessage(err))); }, []);
  return <section className="card"><h2>系统设置</h2><form onSubmit={async (event) => { event.preventDefault(); setPending(true); setError(""); setMessage(""); try { await api.saveSettings(Number(days)); setMessage("补报窗口已保存，包含当天；客服下次加载按新设置执行。"); } catch (err) { setError(toErrorMessage(err)); } finally { setPending(false); } }}><label className="row">加粉补报窗口（业务日，1–60 天）<input required type="number" min="1" max="60" step="1" value={days} onChange={(e) => setDays(e.target.value)} /></label><button disabled={pending}>保存系统设置</button></form>{error && <p className="error">{error}</p>}{message && <p className="ok" role="status">{message}</p>}</section>;
}
