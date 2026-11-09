import { api } from "./api";

// Each home requests only endpoints already allowed to that role.
export async function loadAdminHome() {
  const [users, teams, accounts, modules] = await Promise.allSettled([
    api.users(), api.teams(), api.csAccounts(), api.modules()
  ]);
  return { users, teams, accounts, modules };
}

export async function loadSupervisorHome(today: string) {
  const [fans, orders, accounts] = await Promise.allSettled([
    api.fanSummary(today), api.orders(undefined, { from: today, to: today }), api.csAccounts(today)
  ]);
  return { fans, orders, accounts };
}

export function loaded<T>(result: PromiseSettledResult<T> | undefined): T | null {
  return result?.status === "fulfilled" ? result.value : null;
}
