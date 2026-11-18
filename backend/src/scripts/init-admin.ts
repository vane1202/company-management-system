import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { createPool, withTransaction } from "../db.js";
import { migrate } from "../migrate.js";
import { findUserByUsername } from "../users.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { promptSecret } from "../lib/secretPrompt.js";

async function initAdmin() {
  const config = loadConfig();
  const role = process.env.INIT_ADMIN_ROLE?.trim() || "boss";
  if (role !== "boss" && role !== "admin") throw new Error("INIT_ADMIN_ROLE 只能是 boss 或 admin");

  let username = (process.env.INIT_ADMIN_USERNAME ?? "").trim().toLowerCase();
  let password = process.env.INIT_ADMIN_PASSWORD ?? "";
  let displayName = (process.env.INIT_ADMIN_NAME ?? "").trim();

  if (!username || !password || !displayName) {
    if (!stdin.isTTY) throw new Error("非交互模式请设置 INIT_ADMIN_USERNAME、INIT_ADMIN_PASSWORD、INIT_ADMIN_NAME");
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      if (!username) username = (await rl.question("管理员登录名: ")).trim().toLowerCase();
      if (!displayName) displayName = (await rl.question("显示名称: ")).trim();
    } finally {
      rl.close();
    }
    if (!password) password = await promptSecret(stdin, stdout, "密码（输入隐藏）: ");
  }

  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
    throw new Error("登录名须为 3-32 位小写字母、数字、下划线或短横线");
  }
  if (!displayName || displayName.length > 64) throw new Error("显示名称须为 1-64 个字符");
  validatePassword(password, username);
  const passwordHash = await hashPassword(password);

  const pool = createPool(config.databaseUrl);
  try {
    await migrate(pool);
    await withTransaction(pool, async (client) => {
      // Coordinate with employee role/status updates and other initializer processes.
      await client.query("SELECT pg_advisory_xact_lock(13080, 5)");
      const existing = await client.query(
        "SELECT 1 FROM users WHERE role = $1 AND is_active = TRUE LIMIT 1", [role]
      );
      if (existing.rowCount && process.env.INIT_ADMIN_ALLOW_ADDITIONAL !== "1") {
        throw new Error(`已存在启用的 ${role} 账号。如需再创建，请设置 INIT_ADMIN_ALLOW_ADDITIONAL=1`);
      }
      if (await findUserByUsername(client, username)) throw new Error("登录名已存在");
      await client.query(
        `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
         VALUES ($1, $2, $3, $4, FALSE)`,
        [username, passwordHash, displayName, role]
      );
    });
    console.log(`已创建 ${role} 账号 ${displayName}（${username}）`);
  } finally {
    await pool.end();
  }
}

try {
  await initAdmin();
} catch (error) {
  console.error(error instanceof Error ? error.message : "管理员初始化失败");
  process.exitCode = 1;
}
