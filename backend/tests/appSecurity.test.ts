import request from "supertest";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createApp, isSensitivePath } from "../src/app.js";
import { generateTemporaryPassword, validatePassword } from "../src/lib/password.js";
import { normalizeUsername } from "../src/users.js";

describe("应用安全与输入标准化单元测试", () => {
  it("normalizeUsername 统一去除首尾空白并转小写，非字符串返回空串", () => {
    expect(normalizeUsername("  Boss_01 \t\n")).toBe("boss_01");
    expect(normalizeUsername("ADMIN")).toBe("admin");
    expect(normalizeUsername(null)).toBe("");
    expect(normalizeUsername({ raw: "admin" })).toBe("");
  });

  it("generateTemporaryPassword 生成满足复杂度且不含登录名的临时密码", () => {
    const temp = generateTemporaryPassword("kefu001");
    expect(temp.length).toBeGreaterThanOrEqual(10);
    expect(() => validatePassword(temp, "kefu001")).not.toThrow();
  });

  it("isSensitivePath 拦截点文件、仓库目录、源码文件及编码绕过", () => {
    for (const target of [
      "/.env",
      "/.env.production",
      "/.git/config",
      "/%2eenv",
      "/%2egit/config",
      "/backend/src/app.ts",
      "/scripts/backup.sh",
      "/docs/PRELAUNCH_HEALTHCHECK_20261117.md",
      "/migrations/001_init.sql",
      "/package.json",
      "/tsconfig.json"
    ]) {
      expect(isSensitivePath(target)).toBe(true);
    }
    for (const normal of ["/", "/fill/orders", "/fill/fans", "/assets/index-abc123.js"]) {
      expect(isSensitivePath(normal)).toBe(false);
    }
  });

  it("静态托管模式下敏感路径返回 404，不回落 SPA HTML", async () => {
    const mockPool = { query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Pool;
    const app = createApp(mockPool, {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 13080,
      databaseUrl: "postgres://u:p@127.0.0.1:16542/db",
      sessionSecret: "test-session-secret-0123456789abcdef",
      appOrigins: ["http://127.0.0.1:13080"],
      businessTimezone: "Asia/Shanghai",
      fanReportBackfillDays: 3,
      serveStatic: true,
      trustProxy: 0,
      cookieSecure: false,
      cookieSameSite: "lax",
      loginWindowMs: 900000,
      loginMaxAttempts: 8
    });

    for (const target of ["/.env", "/.git/config", "/%2eenv", "/backend/src/app.ts", "/package.json"]) {
      const res = await request(app).get(target).expect(404);
      expect(res.text).not.toContain("<html");
    }

    const distIndex = path.resolve(process.cwd(), "frontend/dist/index.html");
    const distIndexFromBackend = path.resolve(process.cwd(), "../frontend/dist/index.html");
    if (existsSync(distIndex) || existsSync(distIndexFromBackend)) {
      const spa = await request(app).get("/fill/orders").expect(200);
      expect(spa.text).toContain("<div id=\"root\"></div>");
    }
  });
});
