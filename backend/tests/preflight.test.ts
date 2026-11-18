import { describe, expect, it } from "vitest";
import {
  READONLY_DB_SQL,
  checkEnv,
  checkNodeVersion,
  databaseUrlHasPlaceholderSecret,
  forbiddenReleaseHits,
  parseDatabaseUrlSafe,
  parseEnvFile,
  summarizeFindings,
  validateDatabaseUrl,
  validateHost,
  validatePort,
  validateSessionSecret
} from "../src/lib/preflight.js";

const HIDDEN = "NeverLeakThisPassword99";

describe("只读预检", () => {
  it("识别 Node 版本是否满足 20+", () => {
    expect(checkNodeVersion("18.20.0").level).toBe("error");
    expect(checkNodeVersion("v20.11.1").level).toBe("ok");
    expect(checkNodeVersion("22.14.0").level).toBe("ok");
  });

  it("解析环境文件时忽略注释，且检查结果不回显秘密值", () => {
    const env = parseEnvFile(`
# comment
SESSION_SECRET=${HIDDEN}
DATABASE_URL=postgres://cms:${HIDDEN}@127.0.0.1:15432/cms
HOST=127.0.0.1
PORT=13080
`);
    expect(env.SESSION_SECRET).toBe(HIDDEN);
    const findings = checkEnv(env);
    const blob = findings.map((item) => item.message).join("\n");
    expect(blob).not.toContain(HIDDEN);
    expect(summarizeFindings(findings).ok).toBe(true);
  });

  it("报告缺失的必需变量和占位秘密，但不输出值", () => {
    const findings = checkEnv({
      SESSION_SECRET: "replace-with-long-random-string",
      DATABASE_URL: "postgres://cms:replace-with-strong-local-password@127.0.0.1:15432/cms",
      POSTGRES_PASSWORD: "replace-with-strong-local-password"
    });
    const codes = findings.map((item) => item.code);
    expect(codes).toContain("session_secret_placeholder");
    expect(codes).toContain("database_url_placeholder");
    expect(codes).toContain("postgres_password_placeholder");
    const blob = findings.map((item) => item.message).join("\n");
    expect(blob).not.toContain("replace-with-long-random-string");
    expect(blob).not.toContain("replace-with-strong-local-password");
  });

  it("缺少必需变量时给出明确错误", () => {
    const findings = checkEnv({});
    expect(findings.some((item) => item.code === "database_url_missing")).toBe(true);
    expect(findings.some((item) => item.code === "session_secret_missing")).toBe(true);
    expect(summarizeFindings(findings).ok).toBe(false);
  });

  it("校验主机和端口格式", () => {
    expect(validateHost("127.0.0.1").level).toBe("ok");
    expect(validateHost("localhost").level).toBe("ok");
    expect(validateHost("0.0.0.0").level).toBe("warn");
    expect(validateHost("%%%").level).toBe("error");
    expect(validatePort("13080").level).toBe("ok");
    expect(validatePort("0").level).toBe("error");
    expect(validatePort("abc").level).toBe("error");
  });

  it("解析数据库地址时不返回口令，并能识别演示库", () => {
    const parsed = parseDatabaseUrlSafe(`postgres://cms:${HIDDEN}@127.0.0.1:15432/cms`);
    expect(parsed).toEqual({ host: "127.0.0.1", port: "15432", name: "cms" });
    expect(JSON.stringify(parsed)).not.toContain(HIDDEN);
    expect(databaseUrlHasPlaceholderSecret("postgres://cms:replace-with-strong-local-password@127.0.0.1:15432/cms")).toBe(true);
    const demo = validateDatabaseUrl("postgres://cms:x@127.0.0.1:15433/cms");
    expect(demo.some((item) => item.code === "database_url_demo")).toBe(true);
    const demoName = validateDatabaseUrl(`postgres://cms:${HIDDEN}@127.0.0.1:15432/cms_demo`);
    expect(demoName.some((item) => item.code === "database_url_demo")).toBe(true);
    expect(demoName.map((item) => item.message).join("\n")).not.toContain(HIDDEN);
  });

  it("SESSION_SECRET 过短时只警告，不输出原值", () => {
    const findings = validateSessionSecret("short-secret-1");
    expect(findings[0].level).toBe("warn");
    expect(findings[0].message).not.toContain("short-secret-1");
  });

  it("打包排除名单能抓住秘密和仓库元数据路径", () => {
    const hits = forbiddenReleaseHits([
      "cms-internal/.env",
      "cms-internal/.git/config",
      "cms-internal/node_modules/express/package.json",
      "cms-internal/data/demo-credentials.txt",
      "cms-internal/.env.example",
      "cms-internal/backend/dist/index.js"
    ]);
    expect(hits).toContain("cms-internal/.env");
    expect(hits).toContain("cms-internal/.git/config");
    expect(hits).toContain("cms-internal/node_modules/express/package.json");
    expect(hits).toContain("cms-internal/data/demo-credentials.txt");
    expect(hits).not.toContain("cms-internal/.env.example");
    expect(hits).not.toContain("cms-internal/backend/dist/index.js");
  });

  it("数据库检查 SQL 只包含只读查询", () => {
    expect(READONLY_DB_SQL.startsWith("SELECT ")).toBe(true);
    expect(READONLY_DB_SQL).not.toMatch(/INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|MIGRATE/i);
  });

  it("生产启用 COOKIE_SECURE 时检查 TRUST_PROXY 与 HTTPS 来源", () => {
    const findings = checkEnv({
      NODE_ENV: "production",
      SESSION_SECRET: HIDDEN + "-long-enough",
      DATABASE_URL: `postgres://cms:${HIDDEN}@127.0.0.1:15432/cms`,
      COOKIE_SECURE: "true",
      TRUST_PROXY: "0",
      APP_ORIGIN: "http://app.example.com"
    });
    const codes = findings.map((item) => item.code);
    expect(codes).toContain("trust_proxy_unset_for_https");
    expect(codes).toContain("cookie_secure_http_origin");

    const okFindings = checkEnv({
      NODE_ENV: "production",
      SESSION_SECRET: HIDDEN + "-long-enough",
      DATABASE_URL: `postgres://cms:${HIDDEN}@127.0.0.1:15432/cms`,
      COOKIE_SECURE: "true",
      TRUST_PROXY: "1",
      APP_ORIGIN: "https://app.example.com"
    });
    expect(okFindings.some((item) => item.level !== "ok")).toBe(false);
  });
});
