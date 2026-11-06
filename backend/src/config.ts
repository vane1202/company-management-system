export type AppConfig = {
  nodeEnv: string;
  host: string;
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  appOrigins: string[];
  businessTimezone: string;
  fanReportBackfillDays: number;
  serveStatic: boolean;
  trustProxy: number;
  cookieSecure: boolean;
  cookieSameSite: "lax" | "strict" | "none";
  loginWindowMs: number;
  loginMaxAttempts: number;
};

function required(name: string, allowEmptyInTest = false): string {
  const value = process.env[name];
  if (value && value.trim()) return value.trim();
  if (allowEmptyInTest && process.env.NODE_ENV === "test") return "";
  throw new Error(`缺少环境变量 ${name}`);
}

function parseOrigins(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? "development";
  const sessionSecret = required("SESSION_SECRET");
  if (nodeEnv === "production" && sessionSecret.length < 24) {
    throw new Error("生产环境 SESSION_SECRET 长度不足");
  }
  if (["replace-with-long-random-string", "changeme", "secret"].includes(sessionSecret)) {
    if (nodeEnv === "production") {
      throw new Error("生产环境不能使用示例 SESSION_SECRET");
    }
  }

  const sameSiteRaw = (process.env.COOKIE_SAMESITE ?? "lax").toLowerCase();
  const cookieSameSite =
    sameSiteRaw === "strict" || sameSiteRaw === "none" || sameSiteRaw === "lax"
      ? sameSiteRaw
      : (() => {
          throw new Error("COOKIE_SAMESITE 只能是 lax、strict 或 none");
        })();

  const backfill = Number(process.env.FAN_REPORT_BACKFILL_DAYS ?? "3");
  if (!Number.isInteger(backfill) || backfill < 1 || backfill > 60) {
    throw new Error("FAN_REPORT_BACKFILL_DAYS 必须是 1 到 60 的整数");
  }

  return {
    nodeEnv,
    host: (process.env.HOST ?? "127.0.0.1").trim() || "127.0.0.1",
    port: Number(process.env.PORT ?? "13080"),
    databaseUrl: required("DATABASE_URL"),
    sessionSecret,
    appOrigins: parseOrigins(process.env.APP_ORIGIN ?? "http://127.0.0.1:13080"),
    businessTimezone: process.env.BUSINESS_TIMEZONE ?? "Asia/Shanghai",
    fanReportBackfillDays: backfill,
    serveStatic: (process.env.SERVE_STATIC ?? "false") === "true",
    trustProxy: Number(process.env.TRUST_PROXY ?? "0"),
    cookieSecure: (process.env.COOKIE_SECURE ?? "false") === "true",
    cookieSameSite,
    loginWindowMs: Number(process.env.LOGIN_WINDOW_MS ?? "900000"),
    loginMaxAttempts: Number(process.env.LOGIN_MAX_ATTEMPTS ?? "8")
  };
}
