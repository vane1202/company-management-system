import { hashPassword } from "./password.js";

export const opsLoginPeople = [
  { id: "ops-ziheng", name: "子恒" },
  { id: "ops-xiaopu", name: "小蒲" },
  { id: "ops-agency-a", name: "代运营A" },
  { id: "ops-agency-b", name: "代运营B" }
] as const;

export type ExistingOpsLogin = { id: string; username: string; opsPersonRef?: string | null; role: string; accountKind: string };
export function planOpsLogins(existing: ExistingOpsLogin[] = []) {
  const occupied = new Set(existing.map(row => row.username.toLowerCase()));
  return opsLoginPeople.map(person => {
    const matches = existing.filter(row => row.opsPersonRef === person.id);
    if (matches.length > 1) throw Error("同一运营人员关联了多个登录账号，请先核对");
    const linked = matches[0];
    if (linked && (linked.role !== "ops" || linked.accountKind !== "employee")) throw Error("运营人员编号关联到其他岗位，不能自动复用");
    const username = person.name.normalize("NFKC").toLowerCase();
    if (!linked && occupied.has(username)) throw Error("登录名已占用：" + person.name + "，请先核对已有账号");
    return { personRef: person.id, displayName: person.name, username: linked?.username || username, action: linked ? "keep_existing" as const : "create_disabled" as const, userId: linked?.id, mustChangePassword: true as const };
  });
}

export function assertOpsProvisioningEnabled(value?: string) {
  if (value !== "true") throw Error("服务器尚未启用运营账号准备；当前仅可生成离线计划");
}

// The requested temporary password is only handled on the server; ordinary
// password changes continue to use the application's stronger validation.
export const hashOpsInitialPassword = () => hashPassword("nanzhaoarts");
