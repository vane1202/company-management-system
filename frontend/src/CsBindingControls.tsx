import { useEffect, useState } from "react";
import { api, type CsBinding, type User } from "./api";
import { toErrorMessage } from "./errors";
import "./cs-account-layout.css";

function useBindings(accountId: string) {
  const [rows, setRows] = useState<CsBinding[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action?: () => Promise<unknown>, reload = true) {
    setBusy(true);
    setError("");
    try {
      await action?.();
      if (reload) setRows((await api.csBindings()).bindings);
    } catch (cause) {
      setError(toErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return { rows: rows.filter(row => row.accountId === accountId), error, busy, refresh: run };
}

export function ManageCsBinding({ accountId }: { accountId: string }) {
  const { rows, error, busy, refresh } = useBindings(accountId);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const active = rows.find(row => row.state === "active");
  return <details className="cs-binding-panel" onToggle={event => {
    setOpen(event.currentTarget.open);
    if (event.currentTarget.open) void refresh();
    else setConfirm(false);
  }}>
    <summary>管理手机绑定</summary>
    {open && <div>
      <p>{active ? `已绑定 · ${active.label} · ${active.employeeName}` : "暂无新流程绑定记录"}</p>
      {rows.filter(row => row.state !== "active").map(row => <div className="actions" key={row.id}>
        <span>{row.label} · {row.employeeName} · {row.state === "approved" ? "待手机确认" : "待主管确认"}</span>
        {row.state === "pending" && <button type="button" disabled={busy} onClick={() =>
          refresh(() => api.changeCsBinding(accountId, "approve", row.id))}>批准绑定</button>}
      </div>)}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className="secondary" disabled={busy} onClick={() => refresh()}>刷新申请</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setConfirm(true)}>解除绑定</button>
      </div>
      {confirm && <div className="notice">
        <p>解除后，该接待号的旧手机填报会话和未完成的申请将失效。</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => {
            setConfirm(false);
            void refresh(() => api.changeCsBinding(accountId, "unbind"));
          }}>确认解除</button>
          <button type="button" className="secondary" onClick={() => setConfirm(false)}>取消</button>
        </div>
      </div>}
    </div>}
  </details>;
}

export function RequestCsBinding({ accountId, onActivate }: { accountId: string; onActivate: (user: User) => void | Promise<void> }) {
  const { rows, error, busy, refresh } = useBindings(accountId);
  const [label, setLabel] = useState("");
  useEffect(() => { void refresh(); }, []);
  const request = rows[0];
  return <div className="cs-binding-panel">
    {request ? <div className="actions">
      <span>{request.state === "approved" ? "主管已批准" : "等待主管批准"} · {request.label}</span>
      {request.state === "approved"
        ? <button type="button" disabled={busy} onClick={() => refresh(async () => {
          const data = await api.changeCsBinding(accountId, "activate", request.id);
          if (data.user) await onActivate(data.user);
        }, false)}>启用接待号填报</button>
        : <button type="button" className="secondary" disabled={busy} onClick={() => refresh()}>查看申请状态</button>}
    </div> : <form onSubmit={event => {
      event.preventDefault();
      if (!busy) void refresh(() => api.requestCsBinding(accountId, label));
    }}>
      <label className="row">工作手机名称<input required maxLength={64} value={label} onChange={event => setLabel(event.target.value)} /></label>
      <p className="notice">申请后请保持登录。主管批准后，在这部手机上查看申请状态并启用。</p>
      <button type="submit" className="secondary" disabled={busy}>申请绑定此手机</button>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
