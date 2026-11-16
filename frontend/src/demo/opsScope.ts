import type { OpsAccount } from "./opsWorkspace";
import { isIsoDate } from "../dates";

export type OpsScope = { account: string; persona: string; platform: string };
export const emptyOpsScope = (): OpsScope => ({ account: "", persona: "", platform: "" });
export type OpsScopePreference = { filters: OpsScope; preset: string; range?: { from: string; to: string } };

export function changeScopeAccount(scope: OpsScope, account: string, accounts: OpsAccount[]): OpsScope {
  const available = accounts.filter(item => !account || item.id === account).flatMap(item => item.personas);
  return { account, platform: "", persona: available.includes(scope.persona) ? scope.persona : "" };
}

export function scopeAccounts(scope: OpsScope, accounts: OpsAccount[]) {
  return accounts.filter(account => (!scope.account || account.id === scope.account) && (!scope.persona || account.personas.includes(scope.persona)));
}

export function opsScopeStorageKey() {
  let person = "demo-ops";
  try { person = new URLSearchParams(window.location.search).get("operator") || sessionStorage.getItem("cms-demo-ops-person") || person; } catch { /* Default demo operator. */ }
  return "cms-demo-ops-home-scope-v1:" + person;
}

export function readScopePreference(key: string, today: string): OpsScopePreference {
  const fallback = { filters: emptyOpsScope(), preset: "day" };
  try {
    const stored = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!stored || !["day", "week", "month", "custom"].includes(stored.preset) || typeof stored.filters?.account !== "string" || typeof stored.filters?.persona !== "string") return fallback;
    const range = stored.range;
    if (range && (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to || range.to > today)) return fallback;
    if (stored.preset === "custom" && !range) return fallback;
    return { filters: { account: stored.filters.account, persona: stored.filters.persona, platform: "" }, preset: stored.preset, range };
  } catch { return fallback; }
}
