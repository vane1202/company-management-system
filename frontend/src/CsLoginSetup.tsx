import { useEffect, useState } from "react";
import { api } from "./api";
import { toErrorMessage } from "./errors";
import { toast } from "./Toast";

type Team = { id: string; name: string };
type Staff = { id: string; username: string; displayName: string; isActive: boolean; mustChangePassword: boolean; teamId: string; teamIds?: string[]; teamName: string };
type Issued = { username: string; displayName: string; password: string };

export function CsLoginSetup() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [users, setUsers] = useState<Staff[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", teamIds: [] as string[] });
  const [editingUser, setEditingUser] = useState<Staff | null>(null);
  const [editingTeamIds, setEditingTeamIds] = useState<string[]>([]);
  const [savingTeamId, setSavingTeamId] = useState("");
  const [editError, setEditError] = useState("");

  async function refresh() {
    const data = await api.csLogins();
    setTeams(data.teams);
    setUsers(data.users);
    setForm((current) => ({
      ...current,
      teamIds: current.teamIds.length ? current.teamIds : (data.teams[0]?.id ? [data.teams[0].id] : [])
    }));
    setLoaded(true);
  }

  useEffect(() => {
    refresh().catch((err) => setError(toErrorMessage(err)));
  }, []);

  return (
    <section className="card cs-login-setup">
      <h2>新增客服账号</h2>
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
      {loaded && !teams.length && <div className="empty-state"><strong>还没有负责小组</strong><p>请让后台管理员先把你的负责小组设置好，再新增客服账号。</p></div>}
      {!!teams.length && (
        <form className="cs-login-form" onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          if (!form.teamIds.length) {
            setError("请至少选择一个所属小组");
            return;
          }
          const next = { username: form.username.trim().toLowerCase(), displayName: form.displayName.trim(), password: form.password, teamIds: form.teamIds };
          setPending(true);
          setError("");
          try {
            await api.createCsLogin(next);
            setIssued({ username: next.username, displayName: next.displayName, password: next.password });
            setForm({ username: "", displayName: "", password: "", teamIds: form.teamIds });
            toast.success("已开通 " + next.displayName + "，请登录一次并修改密码");
            await refresh();
          } catch (err) {
            const text = toErrorMessage(err, "开通失败");
            setError(text);
            toast.error("新增客服账号失败：" + text);
          } finally {
            setPending(false);
          }
        }}>
          <label className="row">登录名<input required minLength={3} maxLength={32} pattern="[a-z0-9][a-z0-9_-]{2,31}" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="小写字母、数字、_ 或 -" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value.toLowerCase() })} /></label>
          <label className="row">姓名<input required maxLength={64} value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label>
          <label className="row">初始密码<input required type="password" minLength={10} maxLength={128} autoComplete="new-password" placeholder="至少 10 位，含字母和数字" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <div className="field-label">
            <span>所属小组{teams.length > 1 ? "（可多选）" : ""}</span>
            <div className="actions" style={{ marginTop: 6, flexWrap: "wrap" }}>
              {teams.map((team) => (
                <label className="row" key={team.id} style={{ width: "auto", marginRight: 12 }}>
                  <input
                    type="checkbox"
                    checked={form.teamIds.includes(team.id)}
                    disabled={pending}
                    onChange={(event) => setForm({
                      ...form,
                      teamIds: event.target.checked
                        ? [...form.teamIds, team.id]
                        : form.teamIds.filter((id) => id !== team.id)
                    })}
                  />
                  {team.name}
                </label>
              ))}
            </div>
          </div>
          <button type="submit" disabled={pending}>{pending ? "开通中…" : "新增客服账号"}</button>
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
                  {teams.length > 1 && editingUser?.id !== user.id && (
                    <div className="admin-team-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!savingTeamId}
                        onClick={() => {
                          setEditingUser(user);
                          setEditingTeamIds(user.teamIds?.length ? user.teamIds : [user.teamId]);
                          setEditError("");
                        }}
                      >
                        调整小组
                      </button>
                    </div>
                  )}
                  {editingUser?.id === user.id && (
                    <form
                      className="review-card"
                      style={{ marginTop: 8, width: "100%" }}
                      onSubmit={async (event) => {
                        event.preventDefault();
                        if (savingTeamId) return;
                        if (!editingTeamIds.length) {
                          setEditError("请至少保留一个所属小组");
                          return;
                        }
                        setSavingTeamId(editingUser.id);
                        setEditError("");
                        try {
                          await api.updateCsLoginTeams(editingUser.id, { teamIds: editingTeamIds });
                          toast.success(`已更新 ${editingUser.displayName} 的所属小组`);
                          setEditingUser(null);
                          await refresh();
                        } catch (err) {
                          const text = toErrorMessage(err, "保存失败");
                          setEditError(text);
                          toast.error(`调整 ${editingUser.displayName} 小组失败：${text}`);
                        } finally {
                          setSavingTeamId("");
                        }
                      }}
                    >
                      <p className="notice">勾选所属小组（可多选，仅限你负责的小组范围内调整）：</p>
                      <div className="actions" style={{ marginTop: 6, flexWrap: "wrap" }}>
                        {teams.map((team) => (
                          <label className="row" key={team.id} style={{ width: "auto", marginRight: 12 }}>
                            <input
                              type="checkbox"
                              checked={editingTeamIds.includes(team.id)}
                              disabled={!!savingTeamId}
                              onChange={(event) => setEditingTeamIds(
                                event.target.checked
                                  ? [...editingTeamIds, team.id]
                                  : editingTeamIds.filter((id) => id !== team.id)
                              )}
                            />
                            {team.name}
                          </label>
                        ))}
                      </div>
                      {editError && <p className="action-error" role="alert">{editError}</p>}
                      <div className="actions" style={{ marginTop: 8 }}>
                        <button type="submit" disabled={!!savingTeamId}>{savingTeamId ? "保存中…" : "保存小组"}</button>
                        <button type="button" className="secondary" disabled={!!savingTeamId} onClick={() => { setEditingUser(null); setEditError(""); }}>取消</button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
