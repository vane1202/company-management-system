import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";

type Team = { id: string; name: string };
type Staff = { id: string; username: string; displayName: string; isActive: boolean; mustChangePassword: boolean; teamId: string; teamName: string };
type Issued = { username: string; displayName: string; password: string };

export function CsLoginSetup() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", teamId: "" });

  async function refresh() {
    const data = await api.csLogins();
    setTeams(data.teams);
    setUsers(data.users);
    setForm((current) => ({ ...current, teamId: current.teamId || data.teams[0]?.id || "" }));
    setLoaded(true);
  }

  useEffect(() => {
    refresh().catch((err) => setError(toErrorMessage(err)));
  }, []);

  return (
    <section className="card cs-login-setup">
      <h2>开通客服登录</h2>
      <ol className="notice">
        <li>填写这位客服的姓名、登录名和初始密码，小组选她所在的组。</li>
        <li>用另一个窗口，用初始密码登录这个账号。</li>
        <li>系统会要求修改密码。请改成只有你知道、并要长期保管的密码。</li>
        <li>改完后退出，把登录名和新密码交给客服本人。</li>
        <li>以后忘记了，由后台管理员重置。重置后仍由你登录，再改成新密码。</li>
      </ol>
      {issued && (
        <div className="review-card" role="status">
          <h3>已开通 {issued.displayName}</h3>
          <p>登录名：<code>{issued.username}</code></p>
          <p>初始密码：<code>{issued.password}</code></p>
          <p className="notice">请马上用这个初始密码登录一次并改密。改完之后，系统不会再显示密码。这一页刷新后，初始密码也会消失。</p>
          <button type="button" className="secondary" onClick={() => setIssued(null)}>我已记下</button>
        </div>
      )}
      {!loaded && !error && <p role="status">正在读取本组客服…</p>}
      {loaded && !teams.length && <div className="empty-state"><strong>还没有负责小组</strong><p>请让后台管理员先把你的负责小组设置好，再开通客服。</p></div>}
      {!!teams.length && (
        <form className="cs-login-form" onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          const next = { username: form.username.trim().toLowerCase(), displayName: form.displayName.trim(), password: form.password, teamId: form.teamId };
          setPending(true);
          setError("");
          try {
            await api.createCsLogin(next);
            setIssued({ username: next.username, displayName: next.displayName, password: next.password });
            setForm({ username: "", displayName: "", password: "", teamId: form.teamId });
            toast.success("已开通 " + next.displayName + "，请登录一次并修改密码");
            await refresh();
          } catch (err) {
            const text = toErrorMessage(err, "开通失败");
            setError(text);
            toast.error("开通客服失败：" + text);
          } finally {
            setPending(false);
          }
        }}>
          <label className="row">登录名<input required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{2,31}" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="小写字母、数字、_ 或 -" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} /></label>
          <label className="row">姓名<input required maxLength={64} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label className="row">初始密码<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 位，含字母和数字" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <label className="row">所属小组<select required value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          <button type="submit" disabled={pending}>{pending ? "开通中…" : "开通客服"}</button>
          {error && <p className="action-error" role="alert">{error}</p>}
        </form>
      )}
      {loaded && (
        <div>
          <h3>本组客服</h3>
          {!users.length && <p className="notice">还没有客服登录账号。</p>}
          {!!users.length && (
            <ul className="admin-team-list">
              {users.map((user) => (
                <li className="admin-team-row" key={user.id}>
                  <strong>{user.displayName}</strong>
                  <span>{user.username} · {user.teamName}</span>
                  <span>{!user.isActive ? "已停用" : user.mustChangePassword ? "待主管改密" : "已设置密码"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
