import { createHash, randomBytes } from "node:crypto";
import { HttpError } from "../types.js";

export function normalizeRegistrationCode(value: unknown): string {
  const code = String(value ?? "").replace(/[\s-]/g, "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(code)) throw new HttpError(400, "登记码无效，请向管理员获取一次性登记码");
  return code;
}
export function registrationHash(code: string): string { return createHash("sha256").update(code).digest("hex"); }
export function newRegistrationCode(): string { return randomBytes(16).toString("hex"); }
export function parseWechatId(value: unknown): string {
  const id = String(value ?? "").trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{5,63}$/.test(id)) throw new HttpError(400, "请填写微信号（6–64 位字母、数字、下划线或短横线，字母开头），不要填写昵称");
  return id;
}
export function parseAccountId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) throw new HttpError(400, "账号标识无效");
  return id;
}
