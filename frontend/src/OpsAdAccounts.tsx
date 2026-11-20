import { useEffect, useState, type FormEvent } from "react";
import { api, requestInner, type AdAccount } from "./api";
import { toErrorMessage } from "./errors";

const demo = import.meta.env.MODE === "demo";

export function OpsAdAccounts({ today }: { today: string }) {
  const blank = () => ({ code: "", name: "", openedOn: today, openingUsd: "0.00" });
  const [rows, setRows] = useState<AdAccount[] | null>(null);
  const [form, setForm] = useState(blank);
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function refresh() {
    setError("");
    try { setRows((await api.adAccounts()).accounts); }
    catch (cause) { setError(toErrorMessage(cause)); }
  }

  useEffect(() => { void refresh(); }, []);

  function open(account?: AdAccount) {
    setForm(account ? { ...blank(), code: account.code, name: account.name } : blank());
    setMode(account ? "rename" : "create");
    setError("");
    setMessage("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const fields = mode === "rename" ? { code: form.code, name: form.name } : form;
      if (demo) {
        await requestInner("/api/demo/ops-ad-accounts", { method: "POST", body: JSON.stringify({ ...fields, action: mode }) });
      } else {
        await api.adAction(mode === "rename" ? "rename" : "", fields);
      }
      setMode(null);
      setMessage(mode === "rename" ? "广告户名称已更新" : "广告户已新增");
      await refresh();
      window.dispatchEvent(new Event("cms:ad-accounts-updated"));
    } catch (cause) { setError(toErrorMessage(cause)); }
    finally { setBusy(false); }
  }

  return <div className="commerce-workspace">
    <header className="commerce-heading">
      <h1>广告户管理</h1>
      <button type="button" disabled={busy} onClick={() => open()}>＋ 新增广告户</button>
    </header>
    {demo && <p className="notice">演示改动仅保留在当前浏览器会话。</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="ok" role="status">{message}</p>}
    {mode && <form className="card ops-ad-account-form" onSubmit={save}>
      <h2>{mode === "rename" ? "修改广告户名称" : "新增广告户"}</h2>
      <div className="grid two">
        <label className="row">账户编号<input required readOnly={mode === "rename"} maxLength={64} value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} /></label>
        <label className="row">账户名称<input required maxLength={128} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        {mode === "create" && <>
          <label className="row">期初日期<input required type="date" max={today} value={form.openedOn} onChange={event => setForm({ ...form, openedOn: event.target.value })} /></label>
          <label className="row">期初余额 · USD<input required inputMode="decimal" value={form.openingUsd} onChange={event => setForm({ ...form, openingUsd: event.target.value })} /></label>
        </>}
      </div>
      <div className="actions">
        <button type="submit" disabled={busy}>{busy ? "保存中…" : "保存广告户"}</button>
        <button type="button" className="secondary" disabled={busy} onClick={() => setMode(null)}>取消</button>
      </div>
    </form>}
    <section className="card" aria-label="广告户列表">
      <header className="commerce-line"><h2>广告户列表</h2><button type="button" className="secondary" disabled={busy} onClick={() => void refresh()}>刷新列表</button></header>
      {!rows ? !error && <p role="status">正在读取广告户…</p> : !rows.length ? <p>尚无广告户。</p> : rows.map(account => (
        <article className="commerce-record" key={account.code}>
          <span style={{ overflowWrap: "anywhere" }}><strong>{account.name}</strong><small>{account.code} · 期初 {account.opened_on} · 余额 {account.balance_usd} USD</small></span>
          <button type="button" className="secondary" disabled={busy} aria-label={`修改 ${account.name}`} onClick={() => open(account)}>修改名称</button>
        </article>
      ))}
    </section>
  </div>;
}
