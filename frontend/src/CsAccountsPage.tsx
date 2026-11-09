import { useEffect, useState } from "react";
import { api, type CsAccount, type Team } from "./api";
import { toErrorMessage } from "./errors";
import { FillEntryLinks } from "./FillEntryLinks";

export function CsAccountsPage({ supervisor = false }: { supervisor?: boolean }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [accounts, setAccounts] = useState<CsAccount[]>([]);
  const [teamId, setTeamId] = useState("");
  const [issued, setIssued] = useState<{ code: string; expiresAt: string; message: string } | null>(null);
  const [selected, setSelected] = useState<CsAccount | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<CsAccount | null>(null);
  const [editForm, setEditForm] = useState({ wechatId: "", phoneLabel: "" });
  async function refresh() {
    const [groups, list] = await Promise.all([api.csTeams(), api.csAccounts()]);
    setTeams(groups.teams); setAccounts(list.accounts);
  }
  useEffect(() => { refresh().catch((err) => setError(toErrorMessage(err))); }, []);
  async function issue(accountId?: string) {
    if (pending) return;
    setPending(true); setError(""); setMessage(""); setIssued(null);
    try { setIssued(await api.issueCsRegistrationCode(accountId ? { accountId } : { teamId })); setSelected(null); }
    catch (err) { setError(toErrorMessage(err)); }
    finally { setPending(false); }
  }
  async function toggle(account: CsAccount) {
    if (pending) return;
    setPending(true); setError(""); setIssued(null);
    try { await api.setCsAccountStatus(account.id, !account.isActive); await refresh(); setMessage(account.isActive ? "已停用，原登录已失效，历史数据保留。" : "已启用，请生成重新登记码后使用。"); }
    catch (err) { setError(toErrorMessage(err)); }
    finally { setPending(false); }
  }
  return <section className="cs-accounts-page">
    <div className="card"><h2>客服微信号</h2><p className="notice">一个公司客服微信号对应一份长期业务档案。换人不换号，数据继续积累在原账号下；员工工资仍按员工维护。</p>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="ok" role="status">{message}</p>}
      <form onSubmit={(event) => { event.preventDefault(); issue(); }}>
        <div className="row"><label htmlFor="cs-code-team">新微信号所属小组</label><select id="cs-code-team" required value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">请选择小组</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></div>
        <button type="submit" disabled={pending || !teamId}>生成新微信号登记码</button>
      </form>
      {!teams.length && <p className="notice">{supervisor ? "尚未分配负责小组，请联系后台管理员。" : "请先在账号与小组新增小组，再发放登记码。"}</p>}
      {editing && <form className="review-card" onSubmit={async (event) => { event.preventDefault(); setPending(true); setError(""); try { const result = await api.updateCsAccount(editing.id, editForm); setEditing(null); setIssued(null); await refresh(); setMessage(result.needsRegistration ? "微信号已更新，原数据保留；请重新发码登记。" : "设备备注已更新。"); } catch (err) { setError(toErrorMessage(err)); } finally { setPending(false); } }}>
        <h3>更新 {editing.wechatId}</h3><p className="notice">用于更正微信号或同一微信改名，原数据保留。更换为另一个微信账号请新登记，以免混合数据。修改微信号将退出原登录。</p>
        <label className="row">微信号<input required maxLength={64} value={editForm.wechatId} onChange={(e) => setEditForm({ ...editForm, wechatId: e.target.value })} /></label><label className="row">设备备注<input maxLength={64} value={editForm.phoneLabel} onChange={(e) => setEditForm({ ...editForm, phoneLabel: e.target.value })} /></label><div className="actions"><button disabled={pending}>保存更新</button><button type="button" className="secondary" onClick={() => setEditing(null)}>取消</button></div>
      </form>}
      {selected && <div className="notice" role="region" aria-label="确认重新登记"><p>为 <strong>{selected.wechatId}</strong> 重新发码，会立即退出原浏览器。新码只能登记这个微信号，原数据继续保留。</p><div className="actions"><button disabled={pending} onClick={() => issue(selected.id)}>确认重新发码</button><button className="secondary" disabled={pending} onClick={() => setSelected(null)}>取消</button></div></div>}
      {issued && <div className="cs-issued-code" role="status"><h3>一次性登记码</h3><label htmlFor="issued-cs-code">仅本次显示，请交给对应客服手机使用</label><input id="issued-cs-code" value={issued.code} readOnly /><p>有效期至 {new Date(issued.expiresAt).toLocaleString("zh-CN")}，使用一次后失效。</p><p>{issued.message}</p><div className="actions"><button type="button" className="secondary" onClick={async () => { try { await navigator.clipboard.writeText(issued.code); setMessage("登记码已复制"); } catch { setMessage("请长按上方登记码手动复制"); } }}>复制登记码</button><button type="button" className="secondary" onClick={() => setIssued(null)}>收起登记码</button></div></div>}
    </div>
    <div className="card"><h3>已登记微信号（{accounts.length}）</h3><div className="row"><label htmlFor="cs-search">筛选微信号或设备备注</label><input id="cs-search" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {!accounts.length && <p className="notice">尚未登记。客服在填报入口填写微信号并使用登记码后，会显示在这里。</p>}
      <div className="grid two">{accounts.filter((a) => `${a.wechatId} ${a.phoneLabel ?? ""}`.toLowerCase().includes(filter.toLowerCase())).map((account) => <article className="review-card cs-account-card" key={account.id}><h3>{account.wechatId}</h3><p>{account.phoneLabel || "未填设备备注"} · {account.teamName || "无当前小组"}</p><p className={account.isActive ? "ok" : "notice"}>{account.isActive ? "启用中" : "已停用"}</p><div className="actions"><button className="secondary" disabled={pending} onClick={() => { setEditing(account); setEditForm({ wechatId: account.wechatId, phoneLabel: account.phoneLabel || "" }); setIssued(null); }}>更新资料</button><button disabled={pending || !account.isActive} onClick={() => { setSelected(account); setIssued(null); }}>重新登记</button><button className="secondary" disabled={pending} onClick={() => toggle(account)}>{account.isActive ? "停用" : "启用"}</button></div></article>)}</div>
    </div><button className="secondary" type="button" disabled={pending} onClick={() => refresh().catch((err) => setError(toErrorMessage(err)))}>刷新微信列表</button><FillEntryLinks />
  </section>;
}
