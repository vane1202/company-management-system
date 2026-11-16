import { hashPassword } from "./password.js";

export type CsLoginPerson = { id: string; name: string; isActive?: boolean; status?: "active" | "left" };
export type ExistingCsLogin = { id: string; username: string; personRef?: string | null; role?: string; accountKind?: string; isActive?: boolean };
export type CsLoginPlan = { personRef: string; displayName: string; username: string | null; action: "create_disabled" | "keep_existing" | "skip_inactive"; userId?: string; mustChangePassword: true };

// This alphabet is also enforced by 014_cs_individual_login.sql. Ordinary users
// retain the existing username rules; Chinese names are for linked CS employees.
const alphabet = /^[a-z0-9\u3400-\u4dbf\u4e00-\u9fff][a-z0-9\u3400-\u4dbf\u4e00-\u9fff_-]{0,31}$/;
export function normalizeCsLoginName(name: string): string {
  const username = name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "_");
  if (!alphabet.test(username)) throw Error("客服登录名须为 1–32 位中文、字母、数字、下划线或短横线，首位不能是符号");
  return username;
}

export function csIndividualLoginEnabled(value?: string): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw Error("CS_INDIVIDUAL_LOGIN_ENABLED 只能为 true 或 false");
}

export function assertCsProvisioningEnabled(enabled: boolean): void {
  if (!enabled) throw Error("客服个人登录尚未启用；当前只能生成计划，服务器部署完成后才可准备账号");
}

/** Stable person IDs, never names or reception accounts, identify employees. */
export function planCsLogins(people: CsLoginPerson[], existing: ExistingCsLogin[] = []): CsLoginPlan[] {
  if (!Array.isArray(people) || people.length > 5000) throw Error("客服名单无效，最多 5000 人");
  const refs = new Set<string>();
  for (const person of people) {
    if (!person || typeof person.id !== "string" || !person.id.trim() || person.id !== person.id.trim() || person.id.length > 128 || refs.has(person.id)) throw Error("客服人员 ID 为空、重复或无效");
    if (typeof person.name !== "string" || !person.name.trim() || person.name.trim().length > 64) throw Error("客服姓名无效");
    if (person.isActive !== undefined && typeof person.isActive !== "boolean") throw Error("客服在职状态无效");
    if (person.status !== undefined && !["active", "left"].includes(person.status)) throw Error("客服在职状态无效");
    refs.add(person.id);
  }
  const occupied = new Set(existing.map(row => row.username.toLowerCase()));
  const linked = new Map<string, ExistingCsLogin>();
  for (const row of existing) if (row.personRef) {
    if (linked.has(row.personRef)) throw Error("同一人员 ID 已关联多个员工账号");
    linked.set(row.personRef, row);
  }
  const active = people.filter(person => person.isActive !== false && person.status !== "left");
  const bases = new Map(active.map(person => [person.id, normalizeCsLoginName(person.name)]));
  const frequencies = new Map<string, number>();
  for (const name of bases.values()) frequencies.set(name, (frequencies.get(name) || 0) + 1);
  const ordered = people.slice().sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return ordered.map(person => {
    const base = { personRef: person.id, displayName: person.name.trim(), mustChangePassword: true as const };
    if (person.isActive === false || person.status === "left") return { ...base, username: null, action: "skip_inactive" };
    const current = linked.get(person.id);
    if (current) {
      if (current.role !== "cs" || current.accountKind !== "employee") throw Error("人员 ID 已关联非客服员工账号，不能自动复用");
      return { ...base, username: current.username, action: "keep_existing", userId: current.id };
    }
    const preferred = bases.get(person.id)!;
    let username = preferred;
    if ((frequencies.get(preferred) || 0) > 1 || occupied.has(username)) {
      let number = 1;
      do {
        const suffix = "_" + String(number++).padStart(2, "0");
        username = preferred.slice(0, 32 - suffix.length) + suffix;
      } while (occupied.has(username));
    }
    occupied.add(username);
    return { ...base, username, action: "create_disabled" };
  });
}

// Only this server-side preparation path accepts the agreed temporary password.
// Changed passwords continue to use validatePassword and its stronger rules.
export function hashCsInitialPassword(): Promise<string> {
  return hashPassword("nanzhaoarts");
}
