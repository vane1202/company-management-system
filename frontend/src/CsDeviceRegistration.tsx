import { useState, type FormEvent } from "react";
import { api, type User } from "./api";
import type { SessionMeta } from "./sessionMeta";
import { toErrorMessage } from "./errors";

export function CsDeviceRegistration({ title, onRegistered, onEmployeeLogin }: { title: string; onRegistered: (user: User, meta?: SessionMeta) => void | Promise<void>; onEmployeeLogin: () => void }) {
  const [form, setForm] = useState({ wechatId: "", phoneLabel: "", registrationCode: "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError("");
    try {
      await api.loadCsrf();
      const result = await api.registerCsDevice(form);
      await onRegistered(result.user, result);
    } catch (err) { setError(toErrorMessage(err, "登记失败")); }
    finally { setPending(false); }
  }
  return <div className="login-wrap"><form className="card login-card cs-registration" onSubmit={submit}>
    <div className="brand"><b>{title}</b><span>首次使用，请登记这台客服手机上的公司微信号。</span></div>
    <p className="notice">加粉和订单归属于这个微信号，人员交接后继续使用同一账号。</p>
    <div className="row"><label htmlFor="cs-wechat">公司客服微信号</label><input id="cs-wechat" required maxLength={64} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" placeholder="填写微信号，非昵称" value={form.wechatId} onChange={(e) => setForm({ ...form, wechatId: e.target.value })} /></div>
    <div className="row"><label htmlFor="cs-phone-label">设备备注（可选）</label><input id="cs-phone-label" maxLength={64} placeholder="例如：客服手机 01，无需手机号" value={form.phoneLabel} onChange={(e) => setForm({ ...form, phoneLabel: e.target.value })} /></div>
    <div className="row"><label htmlFor="cs-registration-code">管理员提供的一次性登记码</label><input id="cs-registration-code" required maxLength={80} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="go" value={form.registrationCode} onChange={(e) => setForm({ ...form, registrationCode: e.target.value })} /></div>
    {error && <p className="error" role="alert">{error}</p>}
    <button type="submit" disabled={pending}>{pending ? "正在登记…" : "登记并进入填报"}</button>
    <p className="notice">登记后在当前浏览器保留登录，每次使用续期 30 天。换浏览器、清除数据或退出后，请联系管理员重新发码。这是公司内部登记，不是微信官方登录。</p>
    <button type="button" className="secondary" onClick={onEmployeeLogin}>使用原员工账号登录</button>
  </form></div>;
}
