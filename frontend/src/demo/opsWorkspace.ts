export type OpsPerson = { id: string; name: string; code: string };
export type OpsAccount = { id: string; label: string; platform: string; personas: string[] };
export type OpsWorkspace = { people: OpsPerson[]; current: OpsPerson; accounts: OpsAccount[]; loginEnabled: false };
export type OpsFeedbackRecord = { id: string; authorId: string; authorName: string; account: string; persona: string; date: string; from: string; to: string; category: string; problem: string; suggestion: string; status: "pending" | "progress" | "done"; followup: string; createdAt: string; updatedAt?: string; attachments: { name: string; data: string }[] };
export const opsWorkspaceApi = import.meta.env.MODE === "demo" ? "/api/demo/ops-workspace" : "/api/dashboard/ops-workspace";
export async function opsRequest<T>(path: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { cache: "no-store", credentials: "include", signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "运营数据暂不可用");
  return data;
}
