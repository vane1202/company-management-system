import { HttpError } from "../types.js";

export function parseMoney(input: unknown, field = "金额"): string {
  if (typeof input === "number") {
    throw new HttpError(400, `${field}请以字符串提交（例如 "12.50"），避免浮点误差`);
  }
  if (typeof input !== "string") {
    throw new HttpError(400, `${field}不能为空`);
  }
  const value = input.trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value)) {
    throw new HttpError(400, `${field}格式无效，须为非负数且最多两位小数`);
  }
  if (value.replace(".", "").length > 12) {
    throw new HttpError(400, `${field}超出允许范围`);
  }
  return value;
}

export function moneyToCents(value: string): bigint {
  const negative = value.startsWith("-");
  const raw = negative ? value.slice(1) : value;
  const [yuan, fraction = ""] = raw.split(".");
  const cents = BigInt(yuan) * 100n + BigInt((fraction + "00").slice(0, 2));
  return negative ? -cents : cents;
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const yuan = abs / 100n;
  const rest = abs % 100n;
  return `${sign}${yuan.toString()}.${rest.toString().padStart(2, "0")}`;
}

export function addMoney(values: string[]): string {
  return centsToMoney(values.reduce((sum, value) => sum + moneyToCents(value), 0n));
}

export function subMoney(left: string, right: string): string {
  return centsToMoney(moneyToCents(left) - moneyToCents(right));
}

export function parseCount(input: unknown, field: string, max = 1_000_000): number {
  let value = input;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) {
    throw new HttpError(400, `${field}须为 0 到 ${max} 的整数`);
  }
  return value;
}
