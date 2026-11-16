import { InfoTip } from "../InfoTip";
import { useEffect, useState } from "react";
import { opsRequest, type OpsWorkspace } from "./opsWorkspace";
import "./ops-workspace.css";

export default function OpsIdentity() {
  const [workspace, setWorkspace] = useState<OpsWorkspace | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); opsRequest<OpsWorkspace>("/api/demo/ops-workspace", undefined, controller.signal).then(setWorkspace).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "运营身份读取失败"); }); return () => controller.abort(); }, []);
  if (error) return <p className="error" role="alert">{error}</p>;
  return <section className="ops-identity" aria-label="运营身份"><label>运营人员<span className="hint">演示切换</span><select aria-label="切换运营人员" disabled={!workspace} value={workspace?.current.id || ""} onChange={event => { const url = new URL(window.location.href); url.searchParams.set("role", "ops"); url.searchParams.set("operator", event.target.value); window.location.assign(url.toString()); }}>{workspace ? workspace.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>) : <option>正在读取…</option>}</select></label><span className="ops-identity-help"><InfoTip label="运营演示说明" text="人员为已登记资料；广告户分工与业务数值均为演练示例，实际广告户ID及负责人待补。真实密码登录暂未启用。"/></span><small>人员为已登记资料；广告户分工与业务数值均为演练示例，实际广告户ID及负责人待补。真实密码登录暂未启用。</small></section>;
}
