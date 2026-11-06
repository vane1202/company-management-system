import bcrypt from "bcryptjs";
import { HttpError } from "../types.js";

export function validatePassword(password: string, username?: string): void {
  if (typeof password !== "string" || password.length < 10 || password.length > 128) {
    throw new HttpError(400, "密码长度须为 10 到 128 个字符");
  }
  if (/\s/.test(password)) {
    throw new HttpError(400, "密码不能包含空白字符");
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new HttpError(400, "密码须同时包含字母和数字");
  }
  if (username && password.toLowerCase().includes(username.toLowerCase())) {
    throw new HttpError(400, "密码不能包含登录名");
  }
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
