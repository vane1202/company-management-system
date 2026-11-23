import { ManageCsBinding } from "./CsBindingControls";
import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type CsAccount, type Team } from "./api";
import { CsLoginSetup } from "./CsLoginSetup";
import { InfoTip } from "./InfoTip";
import "./cs-account-layout.css";
import { toErrorMessage } from "./errors";
import { FillEntryLinks } from "./FillEntryLinks";
import { createRequestGate } from "./requestGate";
import {platformLabels} from './serviceAccounts';
import { toast } from "./Toast";
const DemoTenurePanel = import.meta.env.MODE === "demo" ? lazy(() => import("./demo/AccountTenurePanel")) : null;

const REFRESH_AFTER_SAVE_FAILED = "已保存，但列表刷新失败，请点刷新";


function AccountDrawer({ title, pending, onClose, children }: { title: string; pending: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="cs-drawer-backdrop cs-drawer-panel" aria-labelledby={titleId}
    onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || pending) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className="cs-management-heading"><h2 id={titleId}>{title}</h2><button type="button" className="secondary" disabled={pending} onClick={onClose}>关闭</button></header>
    {children}
  </dialog>;
}

const accountFilters = [
  ["all", "全部"], ["active", "启用中"], ["inactive", "已停用"], ["whatsapp", "WhatsApp"], ["messenger", "Messenger"]
] as const;

export function CsAccountsPage({ supervisor = false }: { supervisor?: boolean }) {
  const [section, setSection] = useState<"accounts" | "logins">("accounts");
  const [creating, setCreating] = useState(false);
  const [quick, setQuick] = useState<(typeof accountFilters)[number][0]>("all");
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
  const enabled = accounts.filter((account) => account.isActive).length;
  const whatsapp = accounts.filter((account) => account.platform === "whatsapp").length;
  const messenger = accounts.filter((account) => account.platform === "messenger").length;
  const needle = filter.trim().toLowerCase();
  const visible = accounts.filter((account) => {
    const matchesQuick = quick === "all" || (quick === "active" ? account.isActive : quick === "inactive" ? !account.isActive : account.platform === quick);
    return matchesQuick && [account.wechatId, account.accountIdentifier, account.holderName, account.phoneLabel].join(" ").toLowerCase().includes(needle);
  });
  return <section className="cs-accounts-page cs-management">
    {supervisor && <nav className="cs-management-tabs" aria-label="客服账号管理模块">
      <button type="button" className="secondary" disabled={pending} aria-pressed={section === "accounts"} onClick={() => setSection("accounts")}>接粉账号管理</button>
      <button type="button" className="secondary" disabled={pending} aria-pressed={section === "logins"} onClick={() => setSection("logins")}>客服登录账号管理</button>
    </nav>}
    {supervisor && section === "logins" ? <CsLoginSetup /> : <>
      <header className="cs-management-heading">
        <div><h1>{supervisor ? "客服账号管理" : "客服接待账号"}</h1><InfoTip label="接待账号档案归属" text="每个接待账号对应一份长期业务档案。更换持有人只更新当前负责人，历史数据继续归原账号，员工工资按员工维护。" /></div>
        <div className="actions">
          <button type="button" disabled={pending || !teams.length} onClick={() => { setEditing(null); setError(""); setCreating(true); }}>+ 新增接粉账号</button>
          <button type="button" className="secondary" disabled={pending} onClick={() => refresh().catch((err) => setError(toErrorMessage(err)))}>刷新</button>
        </div>
      </header>
      {error && !creating && !editing && <p className="error" role="alert">{error}</p>}
      {message && <p className="ok" role="status">{message}</p>}
      <dl className="cs-management-summary" aria-label="接粉账号汇总">
        <div><dt>已登记账号</dt><dd>{accounts.length}</dd></div><div><dt>启用中</dt><dd className="cs-jade">{enabled}</dd></div>
        <div><dt>已停用</dt><dd>{accounts.length - enabled}</dd></div><div><dt>WhatsApp</dt><dd>{whatsapp}</dd></div><div><dt>Messenger</dt><dd>{messenger}</dd></div>
      </dl>
      <div className="cs-management-filters">
        <div className="cs-pills" role="group" aria-label="接粉账号快捷筛选">{accountFilters.map(([value, label]) => <button type="button" className="secondary cs-pill" aria-pressed={quick === value} key={value} onClick={() => setQuick(value)}>{label}</button>)}</div>
        <label>搜索接粉账号<input type="search" placeholder="账号、持有人或设备备注" value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
      </div>
       {!teams.length && <p className="notice">{supervisor ? "尚未分配负责小组，请联系后台管理员。" : "请先在账号与小组新增小组，再维护接待号。"}</p>}
      {!visible.length && <p className="empty-state">{accounts.length ? "没有符合筛选条件的接粉账号。" : "尚无已登记的接粉账号。"}</p>}
      <div className="cs-account-grid">
        {visible.map((account) => <article className={"cs-account-card" + (account.isActive ? "" : " is-inactive")} key={account.id}>
          <header className="cs-card-heading">
            <div className="cs-tags"><span className="cs-tag">{platformLabels[account.platform ?? "legacy_wechat"]}</span><span className="cs-tag">{account.teamName || "未分组"}</span></div>
            <span className={"cs-tag" + (account.isActive ? " is-jade" : "")}>{account.isActive ? "启用中" : "已停用"}</span>
          </header>
          <h2 className="cs-account-id">{account.wechatId}</h2>
          <dl className="cs-account-facts"><div><dt>当前持有人</dt><dd>{account.holderName || "未填写"}</dd></div><div><dt>设备备注</dt><dd>{account.phoneLabel || "未填写"}</dd></div></dl>
          <div className="actions">
            <button type="button" className="secondary" disabled={pending} onClick={() => {
              setCreating(false); setError(""); setEditing(account);
              setEditForm({ accountIdentifier: account.accountIdentifier ?? account.wechatId, phoneLabel: account.phoneLabel || "", holderName: account.holderName || "", teamId: account.teamId || "" });
            }}>更新资料</button>
            <button type="button" className="secondary" disabled={pending} onClick={() => void toggle(account)}>{account.isActive ? "停用" : "启用"}</button>

          </div>
          {supervisor && account.isActive && <ManageCsBinding accountId={account.id} />}
        </article>)}
      </div>

      {creating && <AccountDrawer title="新增接粉账号" pending={pending} onClose={() => { setCreating(false); setError(""); }}>
        <form className="cs-drawer-form" onSubmit={async e=>{e.preventDefault();if(pending)return;setPending(true);setError('');setMessage('');try{const holderName=newAccount.holderName.trim();if(!holderName)throw new Error('请填写账号持有人');await api.createCsAccount({...newAccount,teamId,holderName,phoneLabel:newAccount.phoneLabel.trim(),accountIdentifier:newAccount.accountIdentifier.trim()});await refreshAfterSave();setCreating(false);setNewAccount({...newAccount,accountIdentifier:'',phoneLabel:'',holderName:''});setMessage('接粉账号已预先录入，客服可用个人账号登录并申请手机绑定。');}catch(e){fail("新增接粉账号失败",e);}finally{setPending(false);}}}><div className="grid two"><label className="row">所属小组<select required value={teamId} onChange={e=>setTeamId(e.target.value)}><option value="">选择小组</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label><label className="row">聊天平台<select value={newAccount.platform} onChange={e=>setNewAccount({...newAccount,platform:e.target.value as 'whatsapp'|'messenger',accountIdentifier:''})}><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option></select></label><label className="row">{newAccount.platform==='whatsapp'?'WhatsApp国际号码':'Messenger主页ID／用户名'}<input required type={newAccount.platform==='whatsapp'?'tel':'text'} inputMode={newAccount.platform==='whatsapp'?'tel':'text'} maxLength={256} autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={newAccount.platform==='whatsapp'?'+60123456789 或 wa.me 链接':'主页ID、用户名或 https://m.me/…'} value={newAccount.accountIdentifier} onChange={e=>setNewAccount({...newAccount,accountIdentifier:e.target.value})}/></label><label className="row">账号持有人<input required maxLength={32} autoComplete="name" placeholder="当前负责这个账号的客服姓名" value={newAccount.holderName} onChange={e=>setNewAccount({...newAccount,holderName:e.target.value})}/></label><label className="row">设备备注（可选）<input maxLength={64} value={newAccount.phoneLabel} onChange={e=>setNewAccount({...newAccount,phoneLabel:e.target.value})}/></label></div><button disabled={pending||!teamId}>保存接粉账号</button>{error && <p className="error" role="alert">{error}</p>}</form>
      </AccountDrawer>}
      {editing && <AccountDrawer title={"更新资料 · " + editing.wechatId} pending={pending} onClose={() => { setEditing(null); setError(""); }}>
        {editing && <form className="cs-drawer-form" onSubmit={async (event) => {
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
        <p>{platformLabels[editing.platform??"legacy_wechat"]}</p><p className="notice">用于原账号标识更正，原数据保留。更换为另一个接待账号账号请新登记，以免混合数据。修改接待账号将退出原登录。更换账号持有人只改当前负责人，不需要重新登记。</p>
        <label className="row">所属小组<select required value={editForm.teamId} onChange={(e) => setEditForm({ ...editForm, teamId: e.target.value })}>{!editForm.teamId && <option value="">请选择小组</option>}{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label className="row">接待账号<input required maxLength={256} value={editForm.accountIdentifier} onChange={(e) => setEditForm({ ...editForm, accountIdentifier: e.target.value })} /></label><label className="row">账号持有人<input required maxLength={32} autoComplete="name" value={editForm.holderName} onChange={(e) => setEditForm({ ...editForm, holderName: e.target.value })} /></label><label className="row">设备备注<input maxLength={64} value={editForm.phoneLabel} onChange={(e) => setEditForm({ ...editForm, phoneLabel: e.target.value })} /></label><div className="actions"><button disabled={pending}>{pending ? "保存中…" : "保存更新"}</button><button type="button" className="secondary" disabled={pending} onClick={() => { setEditing(null); setError(""); }}>取消</button></div>

      {error && <p className="error" role="alert">{error}</p>}</form>}
      </AccountDrawer>}
      {DemoTenurePanel && <Suspense fallback={<p className="notice">正在读取账号使用历史。</p>}><DemoTenurePanel accounts={accounts} /></Suspense>}
      {!supervisor && <FillEntryLinks />}
    </>}
  </section>;
}
