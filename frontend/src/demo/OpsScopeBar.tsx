import { useEffect, useId, useRef, useState } from "react";
import { opsRequest, opsWorkspaceApi, type OpsAccount, type OpsWorkspace } from "./opsWorkspace";
import { changeScopeAccount, emptyOpsScope, type OpsScope } from "./opsScope";
import "./ops-scope.css";

function ScopeSelect({ label, allLabel, value, options, onChange }: { label: string; allLabel: string; value: string; options: string[]; onChange: (value: string) => void }) {
  const id = useId(), dialog = useRef<HTMLDialogElement>(null);
  const [search, setSearch] = useState("");
  const choices = ["", ...options].filter(option => (option || allLabel).toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="ops-scope-field"><label htmlFor={id}>{label}</label><select id={id} className="ops-scope-native" aria-label={`首页${label}`} value={value} onChange={event => onChange(event.target.value)}><option value="">{allLabel}</option>{options.map(option => <option key={option}>{option}</option>)}</select>
    <button type="button" className="ops-scope-mobile secondary" aria-label={`${label}：${value || allLabel}，点击切换`} title={value || allLabel} aria-haspopup="dialog" onClick={() => { setSearch(""); dialog.current?.showModal(); }}><span>{value || allLabel}</span><span aria-hidden="true">▸</span></button>
    <dialog ref={dialog} className="ops-scope-dialog" aria-labelledby={id + "-title"}><header><h2 id={id + "-title"}>选择{label}</h2><button type="button" className="secondary" onClick={() => dialog.current?.close()}>关闭</button></header><input autoFocus type="search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} value={search} onChange={event => setSearch(event.target.value)} /><div className="ops-scope-choices">{choices.map(option => <button type="button" key={option || "all"} aria-pressed={value === option} onClick={() => { onChange(option); dialog.current?.close(); }}><span>{option || allLabel}</span>{value === option && <span aria-hidden="true">✓</span>}</button>)}{!choices.length && <p className="empty-state">没有匹配的选项。</p>}</div></dialog>
  </div>;
}

export default function OpsScopeBar({ value, onChange, refresh, inline = false }: { value: OpsScope; onChange: (value: OpsScope) => void; refresh: number; inline?: boolean }) {
  const [accounts, setAccounts] = useState<OpsAccount[]>([]), [error, setError] = useState(""), [ready, setReady] = useState(false);
  const callback = useRef(onChange), current = useRef(value); callback.current = onChange; current.current = value;
  useEffect(() => {
    const controller = new AbortController();
    opsRequest<OpsWorkspace>(opsWorkspaceApi, undefined, controller.signal).then(workspace => {
      setAccounts(workspace.accounts); setReady(true); setError("");
      const scope = current.current;
      const account = workspace.accounts.some(item => item.id === scope.account) ? scope.account : "";
      const next = changeScopeAccount(scope, account, workspace.accounts);
      if (next.account !== scope.account || next.persona !== scope.persona || next.platform !== scope.platform) callback.current(next);
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "筛选范围读取失败"); });
    return () => controller.abort();
  }, [refresh]);
  const personas = [...new Set(accounts.filter(account => !value.account || account.id === value.account).flatMap(account => account.personas))];
  if (inline) {
    if (error) return <span className="error" role="alert">{error}</span>;
    if (!ready) return <span className="period-toolbar-caption" role="status">读取筛选…</span>;
    const hasFilter = Boolean(value.account || value.persona);
    return <>
      <select aria-label="首页广告户" value={value.account} onChange={event => onChange(changeScopeAccount(value, event.target.value, accounts))}>
        <option value="">全部广告户</option>
        {accounts.map(account => <option key={account.id} value={account.id}>{account.id}</option>)}
      </select>
      <select aria-label="首页人设／主页" value={value.persona} onChange={event => onChange({ ...value, persona: event.target.value, platform: "" })}>
        <option value="">全部人设</option>
        {personas.map(persona => <option key={persona} value={persona}>{persona}</option>)}
      </select>
      {hasFilter && <button type="button" className="secondary pt-inline-reset" onClick={() => onChange(emptyOpsScope())}>重置</button>}
    </>;
  }
  return <section className="ops-scope-bar" aria-label="首页数据范围">
    {error ? <p className="error" role="alert">{error}</p> : ready ? <><div className="ops-scope-head"><span>数据范围</span><button type="button" className="secondary ops-scope-reset" onClick={() => onChange(emptyOpsScope())}>重置</button></div><div className="ops-scope-fields"><ScopeSelect label="广告户" allLabel="全部广告户" value={value.account} options={accounts.map(account => account.id)} onChange={account => onChange(changeScopeAccount(value, account, accounts))} /><ScopeSelect label="人设／主页" allLabel="全部人设" value={value.persona} options={personas} onChange={persona => onChange({ ...value, persona, platform: "" })} /></div><p className="ops-scope-caption" aria-live="polite">当前范围：<strong>{value.account || "全部广告户"} · {value.persona || "全部人设"}</strong></p></> : <p role="status">正在读取本人广告户与人设…</p>}
  </section>;
}
