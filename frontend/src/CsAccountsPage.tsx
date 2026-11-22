import { ManageCsBinding } from "./CsBindingControls";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api, type CsAccount, type Team } from "./api";
import { CsLoginSetup } from "./CsLoginSetup";
import { toErrorMessage } from "./errors";
import { FillEntryLinks } from "./FillEntryLinks";
import { createRequestGate } from "./requestGate";
import {platformLabels} from './serviceAccounts';
import { toast } from "./Toast";
const DemoTenurePanel = import.meta.env.MODE === "demo" ? lazy(() => import("./demo/AccountTenurePanel")) : null;

const REFRESH_AFTER_SAVE_FAILED = "已保存，但列表刷新失败，请点刷新";


export function CsAccountsPage({ supervisor = false }: { supervisor?: boolean }) {
  const [section, setSection] = useState<"accounts" | "logins">("accounts");
  const [teams, setTeams] = useState<Team[]>([]);
  const [accounts, setAccounts] = useState<CsAccount[]>([]);
  const [teamId, setTeamId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<CsAccount | null>(null);
  const [editForm, setEditForm] = useState({ accountIdentifier: "", phoneLabel: "", holderName: "", teamId: "" });
  const [newAccount,setNewAccount]=useState({platform:'whatsapp' as 'whatsapp'|'messenger',accountIdentifier:'',phoneLabel:'',holderName:''});
  const gate = useRef(createRequestGate());
  const actionPanelRef = useRef<HTMLDivElement>(null);
  function scrollActionPanel() {
    requestAnimationFrame(() => actionPanelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }));
  }
  async function refresh() {
    const ticket = gate.current.next();
    const [groups, list] = await Promise.all([api.csTeams(), api.csAccounts()]);
    if (!ticket.isCurrent()) return;
    setError("");
    setTeams(groups.teams); setAccounts(list.accounts);
  }
  useEffect(() => {
    refresh().catch((err) => setError(toErrorMessage(err)));
    return () => { gate.current.next(); };
  }, []);
  function fail(prefix: string, err: unknown) { const text = toErrorMessage(err, "保存失败"); setError(text); toast.error(`${prefix}：${text}`); }
  /** 保存已成功后再刷新；刷新失败单独说明，不误报为保存失败。 */
  async function refreshAfterSave() { try { await refresh(); } catch { setError(REFRESH_AFTER_SAVE_FAILED); toast.error(REFRESH_AFTER_SAVE_FAILED); } }
  async function toggle(account: CsAccount) {
    if (pending) return;
    setPending(true); setError("");
    try { await api.setCsAccountStatus(account.id, !account.isActive); }
    catch (err) { fail(`${account.wechatId} ${account.isActive ? "停用" : "启用"}失败`, err); setPending(false); return; }
    toast.success(account.isActive ? `${account.wechatId} 已停用，原登录已失效，历史数据保留。` : `${account.wechatId} 已启用，可申请绑定工作手机。`);
    await refreshAfterSave();
    setPending(false);
  }
  return <section className="cs-accounts-page">
    {supervisor && (
      <div className="card" style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div className="actions" role="tablist" aria-label="客服账号管理模块">
          <button type="button" role="tab" aria-selected={section === "accounts"} className={section === "accounts" ? "" : "secondary"} onClick={() => setSection("accounts")}>接粉账号管理</button>
          <button type="button" role="tab" aria-selected={section === "logins"} className={section === "logins" ? "" : "secondary"} onClick={() => setSection("logins")}>客服登录账号管理</button>
        </div>
      </div>
    )}
    {supervisor && section === "logins" ? <CsLoginSetup /> : <>
    <div className="card"><h2>{supervisor ? "客服账号管理" : "客服接待账号"}</h2><p className="notice">一个公司客服接待账号对应一份长期业务档案。换人不换号，数据继续积累在原账号下；员工工资仍按员工维护。账号持有人只记录当前负责人，改姓名不改变历史归属。</p>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="ok" role="status">{message}</p>}
      <form className="review-card" onSubmit={async e=>{e.preventDefault();if(pending)return;setPending(true);setError('');setMessage('');try{const holderName=newAccount.holderName.trim();if(!holderName)throw new Error('请填写账号持有人');await api.createCsAccount({...newAccount,teamId,holderName,phoneLabel:newAccount.phoneLabel.trim(),accountIdentifier:newAccount.accountIdentifier.trim()});await refresh();setNewAccount({...newAccount,accountIdentifier:'',phoneLabel:'',holderName:''});setMessage('接粉账号已预先录入，客服可用个人账号登录并申请手机绑定。');}catch(e){setError(toErrorMessage(e));}finally{setPending(false);}}}><h3>新增接粉账号</h3><div className="grid two"><label className="row">所属小组<select required value={teamId} onChange={e=>setTeamId(e.target.value)}><option value="">选择小组</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="row">聊天平台<select value={newAccount.platform} onChange={e=>setNewAccount({...newAccount,platform:e.target.value as 'whatsapp'|'messenger',accountIdentifier:''})}><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option></select></label><label className="row">{newAccount.platform==='whatsapp'?'WhatsApp国际号码':'Messenger主页ID／用户名'}<input required type={newAccount.platform==='whatsapp'?'tel':'text'} inputMode={newAccount.platform==='whatsapp'?'tel':'text'} maxLength={256} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={newAccount.platform==='whatsapp'?'+60123456789 或 wa.me 链接':'主页ID、用户名或 https://m.me/…'} value={newAccount.accountIdentifier} onChange={e=>setNewAccount({...newAccount,accountIdentifier:e.target.value})}/></label><label className="row">账号持有人<input required maxLength={32} autoComplete="name" placeholder="当前负责这个账号的客服姓名" value={newAccount.holderName} onChange={e=>setNewAccount({...newAccount,holderName:e.target.value})}/></label><label className="row">设备备注（可选）<input maxLength={64} value={newAccount.phoneLabel} onChange={e=>setNewAccount({...newAccount,phoneLabel:e.target.value})}/></label></div><button disabled={pending||!teamId}>保存接粉账号</button></form>
      {!teams.length && <p className="notice">{supervisor ? "尚未分配负责小组，请联系后台管理员。" : "请先在账号与小组新增小组，再维护接待号。"}</p>}
      <div ref={actionPanelRef}>
      {editing && <form className="review-card" onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const currentEditing = editing;
        const before = currentEditing.wechatId;
        if (!editForm.holderName.trim()) { setError('请填写账号持有人'); return; }
        setPending(true); setError("");
        try {
          const result = await api.updateCsAccount(currentEditing.id, {
            accountIdentifier: editForm.accountIdentifier,
            phoneLabel: editForm.phoneLabel,
            holderName: editForm.holderName,
            ...(editForm.teamId ? { teamId: editForm.teamId } : {})
          });
          setEditing(null);
          const holderNow = editForm.holderName.trim();
          const teamNowName = teams.find((t) => t.id === editForm.teamId)?.name;
          const notes = [];
          if (result.needsRegistration) notes.push(`标识已更新为 ${editForm.accountIdentifier.trim()}，原数据保留；请重新申请手机绑定`);
          if ((currentEditing.holderName || "") !== holderNow) notes.push(`账号持有人已改为 ${holderNow}，接待账号和历史数据不变`);
          if (result.teamChanged && teamNowName) notes.push(`所属小组已改为 ${teamNowName}，即日起新数据归入该小组`);
          toast.success(`${before}：${notes.length ? notes.join("。") : "设备备注已更新"}。`);
          await refreshAfterSave();
        } catch (err) {
          fail(`${before} 资料未更新`, err);
        } finally {
          setPending(false);
        }
      }}>
        <h3>更新 {editing.wechatId}</h3><p>{platformLabels[editing.platform??"legacy_wechat"]}</p><p className="notice">用于原账号标识更正，原数据保留。更换为另一个接待账号账号请新登记，以免混合数据。修改接待账号将退出原登录。更换账号持有人只改当前负责人，不需要重新登记。</p>
        <label className="row">所属小组<select required value={editForm.teamId} onChange={(e) => setEditForm({ ...editForm, teamId: e.target.value })}>{!editForm.teamId && <option value="">请选择小组</option>}{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="row">接待账号<input required maxLength={256} value={editForm.accountIdentifier} onChange={(e) => setEditForm({ ...editForm, accountIdentifier: e.target.value })} /></label><label className="row">账号持有人<input required maxLength={32} autoComplete="name" value={editForm.holderName} onChange={(e) => setEditForm({ ...editForm, holderName: e.target.value })} /></label><label className="row">设备备注<input maxLength={64} value={editForm.phoneLabel} onChange={(e) => setEditForm({ ...editForm, phoneLabel: e.target.value })} /></label><div className="actions"><button disabled={pending}>{pending ? "保存中…" : "保存更新"}</button><button type="button" className="secondary" onClick={() => setEditing(null)}>取消</button></div>

      </form>}
      </div>

    </div>
    <div className="card"><h3>已登记接待账号（{accounts.length}）</h3><div className="row"><label htmlFor="cs-search">筛选接待账号、持有人或设备备注</label><input id="cs-search" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {!accounts.length && <p className="notice">尚无接待账号，请先按真实名单录入WhatsApp或Messenger账号。</p>}
      <div className="grid two">{accounts.filter((a) => `${a.wechatId} ${a.holderName ?? ""} ${a.phoneLabel ?? ""}`.toLowerCase().includes(filter.toLowerCase())).map((account) => <article className="review-card cs-account-card" key={account.id}><h3>{account.wechatId}</h3><p>持有人：{account.holderName || "未填写"}</p><p>{account.phoneLabel || "未填设备备注"} · {account.teamName || "无当前小组"}</p><p className={account.isActive ? "ok" : "notice"}>{account.isActive ? "启用中" : "已停用"}</p><div className="actions"><button className="secondary" disabled={pending} onClick={() => { setEditing(account); setEditForm({ accountIdentifier: account.accountIdentifier??account.wechatId, phoneLabel: account.phoneLabel || "", holderName: account.holderName || "", teamId: account.teamId || "" }); scrollActionPanel(); }}>更新资料</button><button className="secondary" disabled={pending} onClick={() => toggle(account)}>{account.isActive ? "停用" : "启用"}</button></div>{supervisor && account.isActive && <ManageCsBinding accountId={account.id} />}</article>)}</div>
    </div>{DemoTenurePanel && <Suspense fallback={<p className="notice">正在读取账号使用历史。</p>}><DemoTenurePanel accounts={accounts} /></Suspense>}<button className="secondary" type="button" disabled={pending} onClick={() => refresh().catch((err) => setError(toErrorMessage(err)))}>刷新接待账号列表</button>{!supervisor && <FillEntryLinks />}
    </>}
  </section>;
}
