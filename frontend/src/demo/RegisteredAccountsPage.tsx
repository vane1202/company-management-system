import { useEffect, useState } from "react";
import { CsAccountsPage } from "../CsAccountsPage";
import { toErrorMessage } from "../errors";
import RegisteredAccountEditor, { type AccountEditorMode } from "./RegisteredAccountEditor";
import { manageServiceAccounts, loadServiceDirectory, type ServiceDirectory } from "./serviceDirectory";
import "./registered-accounts.css";

export default function RegisteredAccountsPage({ supervisor = false }: { supervisor?: boolean }) {
  const [mode, setMode] = useState<AccountEditorMode | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [resetting, setResetting] = useState(false);
  const [directory, setDirectory] = useState<ServiceDirectory | null>(null);
  const [error, setError] = useState("");
  const [tick, setTick] = useState(0);
  const [person, setPerson] = useState("");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setDirectory(null);
    loadServiceDirectory(controller.signal).then(setDirectory).catch(cause => { if (!controller.signal.aborted) setError(toErrorMessage(cause)); });
    return () => controller.abort();
  }, [tick]);
  if (error) return <section className="card"><p className="error" role="alert">{error}</p><button type="button" onClick={() => setTick(value => value + 1)}>重试</button></section>;
  if (!directory) return <p role="status">正在读取接待账号名册…</p>;
  if (!directory.enabled) return <CsAccountsPage supervisor={supervisor} />;
  if (mode) return <RegisteredAccountEditor directory={directory} mode={mode} onBack={() => setMode(null)} onSaved={(next, message) => { setDirectory(next); setMode(null); setNotice(message); setPerson(""); setPlatform(""); setSearch(""); }} />;
  async function resetPreview() {
    setResetting(true); setActionError("");
    try { const result = await manageServiceAccounts({ kind: "reset" }); setDirectory(result.directory); setPerson(""); setNotice(result.message); }
    catch (cause) { setActionError(toErrorMessage(cause)); }
    finally { setResetting(false); }
  }
  const accounts = directory.accounts.filter(account => (!person || account.registeredHolderId === person) && (!platform || account.platform === platform) && (account.wechatId + " " + account.holderName).toLowerCase().includes(search.trim().toLowerCase()));
  return <section className="registered-accounts">
    <header><div><p className="eyebrow">已登记资料 · {directory.confirmedOn}</p><h1>{supervisor ? "客服账号管理" : "客服接待账号"}</h1></div><button type="button" className="secondary" onClick={() => setTick(value => value + 1)}>刷新</button></header>
    {notice && <p role="status" className="notice">{notice}</p>}
    {actionError && <p className="error" role="alert">{actionError}</p>}
    <section className="account-management-entry"><div><strong>新增接待账号</strong><p>登记 WhatsApp、Messenger 与负责客服</p></div><button type="button" onClick={() => setMode({ kind: "create" })}>新增账号</button></section>
    <section className="card"><h2>{directory.team.name} · {directory.team.roomName}</h2><p>客服主管：{directory.team.supervisorName} · 主播：{directory.team.hostName}</p><div className="registered-counts"><span>客服 <strong>{directory.people.filter(employee => employee.status !== "left").length}</strong>人</span><span>WhatsApp <strong>{directory.accounts.filter(account => account.platform === "whatsapp").length}</strong>个</span><span>Messenger <strong>{directory.accounts.filter(account => account.platform === "messenger").length}</strong>个</span></div><p className="notice">人员与接待账号为实际登记资料。封号{directory.excluded.banned}处不列入选择；未提供的{directory.excluded.blank}处账号留空。原名册负责起始日期待补；新增与交接按登记日期生效，不改写旧客服的历史考核。</p></section>
    <section className="card"><div className="grid two"><label className="row">客服姓名<select aria-label="名册客服筛选" value={person} onChange={event => setPerson(event.target.value)}><option value="">全部客服</option>{directory.people.map(employee => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label><label className="row">平台<select aria-label="名册平台筛选" value={platform} onChange={event => setPlatform(event.target.value)}><option value="">全部平台</option><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option></select></label></div><label className="row">查找姓名或账号<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label><p className="hint">{accounts.length} 个账号 · 仅当前浏览器会话演练，不写入正式名册</p>
      {directory.people.filter(employee => accounts.some(account => account.registeredHolderId === employee.id)).map(employee => <article className="registered-person" key={employee.id}><h3>{employee.name}<small>{directory.team.name} · {directory.team.roomName}</small></h3><button type="button" className="secondary account-handover-button" onClick={() => setMode({ kind: "handover", fromId: employee.id })}>账号更换</button><dl>{accounts.filter(account => account.registeredHolderId === employee.id).map(account => <div key={account.id}><dt>{account.platform === "whatsapp" ? "WhatsApp" : "Messenger"}</dt><dd>{account.accountIdentifier}</dd><dd className="hint">{account.holderSince ? account.holderSince + " 起负责" : "负责起始日期待补"}</dd></div>)}</dl></article>)}
      {!accounts.length && <p className="notice">没有符合筛选条件的账号。</p>}
    </section>
    {!!directory.managementHistory?.length && <details className="card account-management-history"><summary>新增与交接记录 · {directory.managementHistory.length}</summary><p className="hint">仅本次演练记录，旧客资、订单及考核不改归属。</p>{[...directory.managementHistory].reverse().map(event => <article className="account-history-row" key={event.id}><strong>{event.kind === "create" ? "新增账号" : "人员交接"} · {event.effectiveOn}</strong><p>{event.fromEmployeeName ? event.fromEmployeeName + " → " : ""}{event.toEmployeeName}{event.markLeft ? " · 原客服已离职" : ""}</p>{event.accountIds.map(id => <small key={id}>{directory.accounts.find(account => account.id === id)?.wechatId}</small>)}<p>{event.note || "未填写备注"}</p><small>操作人：{event.actor}</small></article>)}<button type="button" className="secondary" disabled={resetting} onClick={() => void resetPreview()}>清除本次账号管理演练</button></details>}
  </section>;
}
