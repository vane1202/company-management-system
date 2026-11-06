import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  READONLY_DB_SQL,
  checkEnv,
  checkNodeVersion,
  parseDatabaseUrlSafe,
  parseEnvFile,
  summarizeFindings,
  type Finding
} from "../lib/preflight.js";

function printHelp(): void {
  process.stdout.write(`只读环境预检：检查 Node 版本、必需环境变量、占位秘密和地址端口格式。
不会安装软件、不会读取未指定的 .env、不会改库、不会跑迁移、不会启动业务服务。

用法：
  npm run preflight
  npm run preflight -- --env-file .env.example
  npm run preflight -- --env-file /path/to/your.env --check-db

说明：
  默认不读取 .env。只有显式传入 --env-file 时才解析该文件。
  --check-db 仅执行只读 SELECT version / current_database，失败也不会尝试修复。
  本命令不是启动器，也不能代替任何被安全软件拦截的启动脚本。
`);
}

function parseArgs(argv: string[]): { envFile?: string; checkDb: boolean; help: boolean } {
  const out: { envFile?: string; checkDb: boolean; help: boolean } = { checkDb: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--check-db") out.checkDb = true;
    else if (arg === "--env-file") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("请在 --env-file 后提供文件路径");
      out.envFile = next;
      i += 1;
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return out;
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function resolveEnvFilePath(envFile: string): string {
  const candidates = path.isAbsolute(envFile)
    ? [envFile]
    : [...new Set([path.resolve(process.cwd(), envFile), path.resolve(REPO_ROOT, envFile)])];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`找不到环境文件：${envFile}`);
}

function loadEnvSource(envFile?: string): { env: Record<string, string | undefined>; source: string } {
  if (!envFile) {
    return { env: process.env, source: "当前进程环境变量（默认不读取 .env）" };
  }
  const resolved = resolveEnvFilePath(envFile);
  const text = fs.readFileSync(resolved, "utf8");
  return { env: parseEnvFile(text), source: `显式文件 ${envFile}` };
}

async function checkDatabase(url: string): Promise<Finding> {
  let parsed;
  try {
    parsed = parseDatabaseUrlSafe(url);
  } catch {
    return { level: "error", code: "db_check_skipped_invalid", message: "无法解析 DATABASE_URL，跳过数据库只读检查" };
  }
  if (parsed.name === "cms_demo" || parsed.port === "15433") {
    return {
      level: "error",
      code: "db_check_refused_demo",
      message: "拒绝检查演示库（cms_demo 或端口 15433）"
    };
  }
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    const result = await client.query<{ version: string; database: string }>(READONLY_DB_SQL);
    const row = result.rows[0];
    return {
      level: "ok",
      code: "db_readonly",
      message: `数据库只读连通正常（PostgreSQL ${row?.version ?? "未知"}，当前库 ${row?.database ?? parsed.name}）`
    };
  } catch {
    return { level: "error", code: "db_unreachable", message: "数据库只读连通失败（未改库，也未尝试迁移或启动服务）" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  process.stdout.write("预检（只读，不会安装、迁移、启动服务或修改数据库）\n");
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "参数无效"}\n`);
    return 2;
  }
  if (options.help) {
    printHelp();
    return 0;
  }

  const findings: Finding[] = [checkNodeVersion(process.versions.node)];
  const lockfile = path.join(REPO_ROOT, "package-lock.json");
  findings.push(
    fs.existsSync(lockfile)
      ? { level: "ok", code: "lockfile", message: "已找到 package-lock.json，正式安装请优先使用 npm ci" }
      : { level: "error", code: "lockfile_missing", message: "未找到 package-lock.json，无法按锁定版本安装" }
  );

  const loaded = loadEnvSource(options.envFile);
  process.stdout.write(`环境来源：${loaded.source}\n`);
  findings.push(...checkEnv(loaded.env));

  if (options.checkDb) {
    const url = String(loaded.env.DATABASE_URL ?? "").trim();
    if (!url) {
      findings.push({
        level: "error",
        code: "db_check_missing_url",
        message: "指定了 --check-db 但没有 DATABASE_URL"
      });
    } else {
      findings.push(await checkDatabase(url));
    }
  }

  for (const item of findings) {
    const tag = item.level === "ok" ? "OK" : item.level === "warn" ? "WARN" : "ERROR";
    process.stdout.write(`[${tag}] ${item.message}\n`);
  }
  const summary = summarizeFindings(findings);
  process.stdout.write(
    `结果：${summary.ok ? "通过" : "未通过"}（错误 ${summary.errors}，警告 ${summary.warnings}）\n`
  );
  process.stdout.write("本命令不能代替启动脚本，也不能当作 Windows 告警已解决。\n");
  return summary.ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch(() => {
    process.stderr.write("预检过程异常（未启动服务，未修改数据库）\n");
    process.exit(2);
  });
