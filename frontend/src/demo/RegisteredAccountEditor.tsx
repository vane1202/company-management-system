import { useState } from "react";
import { toErrorMessage } from "../errors";
import { manageServiceAccounts, type ServiceDirectory } from "./serviceDirectory";

type Directory = Extract<ServiceDirectory, { enabled: true }>;
export type AccountEditorMode = { kind: "create" } | { kind: "handover"; fromId: string };

export default function RegisteredAccountEditor({ directory, mode, onBack, onSaved }: { directory: Directory; mode: AccountEditorMode; onBack: () => void; onSaved: (directory: ServiceDirectory, message: string) => void }) {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const from = mode.kind === "handover" ? directory.people.find(person => person.id === mode.fromId) : null;
  const owned = directory.accounts.filter(account => account.registeredHolderId === from?.id && account.isActive);
  const [platform, setPlatform] = useState("whatsapp");
  const [identifier, setIdentifier] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(today);
  const [reason, setReason] = useState("");
  const [selected, setSelected] = useState<string[]>(owned.map(account => account.id));
  const [markLeft, setMarkLeft] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const receiver = employeeId === "new" ? employeeName.trim() : directory.people.find(person => person.id === employeeId)?.name || "";
  const title = mode.kind === "create" ? "新增账号" : "账号更换／人员交接";

  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await manageServiceAccounts({ kind: mode.kind, teamId: directory.team.id, platform, identifier, employeeId, employeeName, effectiveOn, accountIds: selected, reason, note: reason, markLeft });
      onSaved(result.directory, result.message);
    } catch (cause) { setError(toErrorMessage(cause)); setBusy(false); }
  }

  return <section className="registered-accounts account-editor">
    <header><div><p className="eyebrow">{directory.team.name} · {directory.team.roomName}</p><h1>{title}</h1></div><button type="button" className="secondary" disabled={busy} onClick={onBack}>返回账号管理</button></header>
    <p className="notice">演示操作仅保留在当前浏览器会话，可在账号管理中清除。没有写入正式后台。</p>
    <form className="card" onChange={() => { setChecked(false); setError(""); }} onSubmit={event => { event.preventDefault(); if (!selected.length && mode.kind === "handover") { setError("请至少选择一个交接账号"); return; } setChecked(true); }}>
      <fieldset disabled={busy}>
        {mode.kind === "handover" && <><h2>原负责人：{from?.name}</h2><p className="hint">账号号码保持不变，仅更新使用人。可一次交接多个账号。</p><div className="account-transfer-list">{owned.map(account => <label key={account.id}><input type="checkbox" checked={selected.includes(account.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, account.id] : previous.filter(id => id !== account.id))} /><span><strong>{account.platform === "whatsapp" ? "WhatsApp" : "Messenger"}</strong><small>{account.accountIdentifier}</small></span></label>)}</div></>}
        <div className="grid two">
          {mode.kind === "create" && <><label className="row">平台<select aria-label="新增账号平台" value={platform} onChange={event => setPlatform(event.target.value)}><option value="whatsapp">WhatsApp</option><option value="messenger">Messenger</option></select></label><label className="row">{platform === "whatsapp" ? "WhatsApp账号（含国家区号）" : "Messenger账号ID"}<input required aria-label="新增接待账号" maxLength={40} autoComplete="off" value={identifier} onChange={event => setIdentifier(event.target.value)} placeholder={platform === "whatsapp" ? "+8613800000000" : "填写数字账号ID"} pattern={platform === "whatsapp" ? "\\+[1-9][0-9]{7,14}" : "[0-9]{5,30}"} /></label></>}
          <label className="row">{mode.kind === "create" ? "账号持有人" : "新负责人"}<select required aria-label="接待账号负责人" value={employeeId} onChange={event => setEmployeeId(event.target.value)}><option value="">请选择客服</option>{directory.people.filter(person => person.status !== "left" && person.id !== from?.id).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}<option value="new">＋ 登记新客服</option></select></label>
          {employeeId === "new" && <label className="row">新客服姓名<input required maxLength={40} value={employeeName} onChange={event => setEmployeeName(event.target.value)} /></label>}
          <label className="row">{mode.kind === "create" ? "负责起始日期" : "交接生效日期"}<input required type="date" max={today} value={effectiveOn} onChange={event => setEffectiveOn(event.target.value)} /></label>
        </div>
        <label className="row">{mode.kind === "create" ? "备注（选填）" : "交接原因"}<textarea required={mode.kind === "handover"} maxLength={300} rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder={mode.kind === "handover" ? "例如：原客服离职，接待账号由新客服接手" : "可填写设备或使用说明"} /></label>
        {mode.kind === "handover" && <label className="account-left-option"><input type="checkbox" checked={markLeft} onChange={event => setMarkLeft(event.target.checked)} />同时标记原客服已离职（需交接其全部在用账号）</label>}
        <p className="notice">{mode.kind === "create" ? "新增的是接待平台账号与负责人资料，不会创建登录账号或设置密码。" : "生效日当日开始归新负责人。原有客资、订单、业绩和考核记录保留原客服归属；未确认的历史任期不自动补齐。"}</p>
        <div className="account-editor-actions"><button type="submit">核对{mode.kind === "create" ? "新增" : "交接"}信息</button><button type="button" className="secondary" onClick={onBack}>取消</button></div>
      </fieldset>
      {checked && <section className="account-confirm" aria-label="账号操作确认"><h3>确认{mode.kind === "create" ? "新增账号" : "账号交接"}</h3><p>{mode.kind === "create" ? (platform === "whatsapp" ? "WhatsApp" : "Messenger") + " · " + identifier : from?.name + " → " + receiver + " · " + selected.length + " 个账号"}</p><p>{mode.kind === "create" ? "负责人：" + receiver + " · " : ""}{effectiveOn} 起生效{markLeft ? " · 原客服标记离职" : ""}</p><button type="button" disabled={busy} onClick={() => void save()}>{busy ? "处理中…" : "确认并更新演示"}</button></section>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </section>;
}
