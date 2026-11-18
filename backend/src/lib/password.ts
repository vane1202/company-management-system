import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { HttpError } from "../types.js";

const TEMP_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const TEMP_DIGITS = "23456789";
const TEMP_CHARS = TEMP_LETTERS + TEMP_DIGITS;

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

export function generateTemporaryPassword(username?: string): string {
  for (let attempt = 0; attempt < 16; attempt++) {
    const chars = [
      TEMP_LETTERS[randomInt(TEMP_LETTERS.length)],
      TEMP_DIGITS[randomInt(TEMP_DIGITS.length)]
    ];
    while (chars.length < 14) {
      chars.push(TEMP_CHARS[randomInt(TEMP_CHARS.length)]);
    }
    for (let i = chars.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    const candidate = chars.join("");
    if (!username || !candidate.toLowerCase().includes(username.toLowerCase())) {
      return candidate;
    }
  }
  throw new HttpError(500, "生成临时密码失败，请重试");
}
