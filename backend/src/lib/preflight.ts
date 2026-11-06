export type FindingLevel = "ok" | "warn" | "error";

export type Finding = {
  level: FindingLevel;
  code: string;
  message: string;
};

export const REQUIRED_ENV_KEYS = ["DATABASE_URL", "SESSION_SECRET"] as const;
export const READONLY_DB_SQL =
  "SELECT current_setting('server_version') AS version, current_database() AS database";

export const FORBIDDEN_RELEASE_BASENAMES = [
  ".env",
  ".git",
  "node_modules",
  ".pg-test-pass",
  "demo-credentials.txt",
  "credentials"
] as const;

const PLACEHOLDER_EXACT = new Set([
  "replace-with-long-random-string",
  "replace-with-strong-local-password",
  "changeme",
  "secret",
  "password"
]);

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

export function looksLikePlaceholder(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (PLACEHOLDER_EXACT.has(trimmed.toLowerCase()) || PLACEHOLDER_EXACT.has(trimmed)) return true;
  return /^replace-with-/i.test(trimmed);
}

export function checkNodeVersion(version: string, minMajor = 20): Finding {
  const normalized = version.trim().replace(/^v/i, "");
  const major = Number(normalized.split(".")[0]);
  if (!Number.isInteger(major)) {
    return { level: "error", code: "node_version_invalid", message: "无法识别当前 Node.js 版本" };
  }
  if (major < minMajor) {
    return {
      level: "error",
      code: "node_version_low",
      message: `当前 Node.js 主版本过低，需要 ${minMajor}+`
    };
  }
  return { level: "ok", code: "node_version", message: `Node.js 主版本满足 ${minMajor}+` };
}

export function validateHost(value: string): Finding {
  const host = value.trim();
  if (!host) {
    return { level: "error", code: "host_missing", message: "HOST 未设置" };
  }
  if (host === "0.0.0.0" || host === "::") {
    return {
      level: "warn",
      code: "host_unspecified",
      message: "HOST 绑定了所有网卡。内测请优先使用 127.0.0.1，避免误暴露"
    };
  }
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const name = /^(?:localhost|[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/;
  if (!ipv4.test(host) && !name.test(host)) {
    return { level: "error", code: "host_invalid", message: "HOST 格式无效" };
  }
  return { level: "ok", code: "host", message: "HOST 格式可用" };
}

export function validatePort(value: string | number, label = "PORT"): Finding {
  const port = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { level: "error", code: "port_invalid", message: `${label} 必须是 1 到 65535 的整数` };
  }
  return { level: "ok", code: "port", message: `${label} 格式可用` };
}

export function parseDatabaseUrlSafe(url: string): { host: string; port: string; name: string } {
  const normalized = url.trim();
  const withAuth = normalized.match(/^[a-z][a-z0-9+.-]*:\/\/[^@/?#]+@([^/?#]+)\/([^?#]+)/i);
  const withoutAuth = normalized.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)\/([^?#]+)/i);
  const matched = withAuth ?? withoutAuth;
  if (!matched) {
    throw new Error("DATABASE_URL 格式无效");
  }
  const hostPort = matched[1];
  const name = decodeURIComponent(matched[2].replace(/\/$/, "").split("/")[0] ?? "");
  const ipv6 = hostPort.match(/^\[([^\]]+)\](?::(\d+))?$/);
  const host = ipv6 ? ipv6[1] : hostPort.split(":")[0];
  const port = ipv6 ? ipv6[2] || "5432" : hostPort.includes(":") ? hostPort.slice(hostPort.lastIndexOf(":") + 1) : "5432";
  if (!host || !name) {
    throw new Error("DATABASE_URL 格式无效");
  }
  return { host, port, name };
}

export function databaseUrlHasPlaceholderSecret(url: string): boolean {
  const match = url.match(/^[a-z][a-z0-9+.-]*:\/\/[^:]+:([^@]+)@/i);
  if (!match) return false;
  try {
    return looksLikePlaceholder(decodeURIComponent(match[1]));
  } catch {
    return looksLikePlaceholder(match[1]);
  }
}

export function validateDatabaseUrl(url: string): Finding[] {
  const findings: Finding[] = [];
  if (!url.trim()) {
    return [{ level: "error", code: "database_url_missing", message: "DATABASE_URL 未设置" }];
  }
  if (databaseUrlHasPlaceholderSecret(url)) {
    findings.push({
      level: "error",
      code: "database_url_placeholder",
      message: "DATABASE_URL 中的口令仍是示例占位符"
    });
  }
  try {
    const parsed = parseDatabaseUrlSafe(url);
    findings.push({
      level: "ok",
      code: "database_url_format",
      message: `DATABASE_URL 可解析（主机 ${parsed.host}，端口 ${parsed.port}，库名 ${parsed.name}）`
    });
    const portCheck = validatePort(parsed.port, "DATABASE_URL 端口");
    if (portCheck.level !== "ok") findings.push(portCheck);
    if (parsed.name === "cms_demo" || parsed.port === "15433") {
      findings.push({
        level: "error",
        code: "database_url_demo",
        message: "DATABASE_URL 指向演示库（库名 cms_demo 或端口 15433），不能用于正式本地部署或测试"
      });
    }
  } catch {
    findings.push({ level: "error", code: "database_url_invalid", message: "DATABASE_URL 格式无效" });
  }
  return findings;
}

export function validateSessionSecret(value: string): Finding[] {
  if (!value.trim()) {
    return [{ level: "error", code: "session_secret_missing", message: "SESSION_SECRET 未设置" }];
  }
  if (looksLikePlaceholder(value)) {
    return [{ level: "error", code: "session_secret_placeholder", message: "SESSION_SECRET 仍是示例占位符" }];
  }
  if (value.trim().length < 24) {
    return [{ level: "warn", code: "session_secret_short", message: "SESSION_SECRET 长度偏短，建议至少 24 位随机串" }];
  }
  return [{ level: "ok", code: "session_secret", message: "SESSION_SECRET 已设置且不像占位符" }];
}

export function validateAppOrigin(value: string): Finding {
  const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!parts.length) {
    return { level: "error", code: "app_origin_missing", message: "APP_ORIGIN 未设置" };
  }
  for (const part of parts) {
    try {
      const parsed = new URL(part);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { level: "error", code: "app_origin_invalid", message: "APP_ORIGIN 必须是 http 或 https 地址" };
      }
    } catch {
      return { level: "error", code: "app_origin_invalid", message: "APP_ORIGIN 格式无效" };
    }
  }
  return { level: "ok", code: "app_origin", message: "APP_ORIGIN 格式可用" };
}

export function checkEnv(env: Record<string, string | undefined>): Finding[] {
  const findings: Finding[] = [];
  for (const key of REQUIRED_ENV_KEYS) {
    if (!env[key] || !String(env[key]).trim()) {
      findings.push({ level: "error", code: `${key.toLowerCase()}_missing`, message: `${key} 未设置` });
    }
  }
  if (env.SESSION_SECRET) findings.push(...validateSessionSecret(env.SESSION_SECRET));
  if (env.DATABASE_URL) findings.push(...validateDatabaseUrl(env.DATABASE_URL));
  if (env.POSTGRES_PASSWORD && looksLikePlaceholder(env.POSTGRES_PASSWORD)) {
    findings.push({
      level: "error",
      code: "postgres_password_placeholder",
      message: "POSTGRES_PASSWORD 仍是示例占位符"
    });
  }
  if (env.HOST) findings.push(validateHost(env.HOST));
  if (env.PORT) findings.push(validatePort(env.PORT, "PORT"));
  if (env.POSTGRES_PORT) findings.push(validatePort(env.POSTGRES_PORT, "POSTGRES_PORT"));
  if (env.APP_ORIGIN) findings.push(validateAppOrigin(env.APP_ORIGIN));
  if ((env.NODE_ENV ?? "").trim() === "production" && (env.COOKIE_SECURE ?? "false") !== "true") {
    findings.push({
      level: "warn",
      code: "cookie_secure_off",
      message: "NODE_ENV=production 时建议在 HTTPS 下将 COOKIE_SECURE 设为 true"
    });
  }
  return findings;
}

export function forbiddenReleaseHits(relativePaths: string[]): string[] {
  const hits: string[] = [];
  const forbidden = new Set<string>(FORBIDDEN_RELEASE_BASENAMES);
  for (const rel of relativePaths) {
    const parts = rel.split(/[\\/]/).filter(Boolean);
    const base = parts[parts.length - 1] ?? "";
    if (parts.some((part) => forbidden.has(part))) {
      hits.push(rel);
      continue;
    }
    if (base.endsWith(".pid") || base.endsWith(".pem") || base.endsWith(".key")) {
      hits.push(rel);
      continue;
    }
    if (base.toLowerCase().includes("credential")) hits.push(rel);
  }
  return hits;
}

export function summarizeFindings(findings: Finding[]): { ok: boolean; errors: number; warnings: number } {
  const errors = findings.filter((item) => item.level === "error").length;
  const warnings = findings.filter((item) => item.level === "warn").length;
  return { ok: errors === 0, errors, warnings };
}

export function assertFindingsDoNotContain(findings: Finding[], secret: string): void {
  const leaked = findings.some((item) => item.message.includes(secret));
  if (leaked) {
    throw new Error("preflight finding leaked a secret value");
  }
}
