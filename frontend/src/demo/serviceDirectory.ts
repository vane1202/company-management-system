import type { CsAccount } from "../api";
import { holderOn, type EmployeeRecord, type TenureRecord } from "./assessmentFoundation";

export type FillAccount = Omit<CsAccount, "createdAt"> & { createdAt: string | null; registeredHolderId?: string; registeredRoomName?: string; registeredHostName?: string; holderSince?: string; holderHistory?: { employeeId: string; name: string; startDate: string | null; endDate: string | null }[] };
export type AccountManagementEvent = { id: string; kind: "create" | "handover"; accountIds: string[]; fromEmployeeId?: string; fromEmployeeName?: string; toEmployeeId: string; toEmployeeName: string; effectiveOn: string; createdAt: string; actor: string; note: string; markLeft?: boolean };
export type ServiceDirectory = { enabled: false } | { enabled: true; version: "service-directory/v1"; confirmedOn: string; people: { id: string; name: string; status?: "active" | "left"; rooms?: string[] }[]; accounts: FillAccount[]; team: { id: string; name: string; roomName: string; hostName: string; supervisorName: string }; excluded: { banned: number; blank: number }; tenureStart: null; managementHistory?: AccountManagementEvent[] };

export async function manageServiceAccounts(payload: Record<string, unknown>): Promise<{ directory: ServiceDirectory; message: string }> {
  const response = await fetch("/api/demo/service-directory/manage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "账号更新失败");
  return data;
}

export async function loadServiceDirectory(signal?: AbortSignal): Promise<ServiceDirectory> {
  const response = await fetch("/api/demo/service-directory", { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "账号名册暂不可用");
  if (data.enabled !== false && (data.version !== "service-directory/v1" || !Array.isArray(data.accounts))) throw Error("账号名册格式不匹配");
  return data;
}

export function fillHolder(account: FillAccount, date: string, today: string, employees: EmployeeRecord[], tenures: TenureRecord[]) {
  if (account.holderHistory) {
    const tenure = account.holderHistory.find(item => item.startDate && item.startDate <= date && (!item.endDate || item.endDate >= date));
    return tenure ? { id: tenure.employeeId, name: tenure.name, code: "" } : null;
  }
  if (account.registeredHolderId) return date === today ? { id: account.registeredHolderId, name: account.holderName || "", code: "" } : null;
  return employees.find(employee => employee.id === holderOn(tenures, account.id, date)?.employeeId) || null;
}
