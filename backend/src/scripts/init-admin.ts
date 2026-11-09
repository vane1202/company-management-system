import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadConfig } from "../config.js";
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";
import { findUserByUsername } from "../users.js";
import { hashPassword, validatePassword } from "../lib/password.js";
import { promptSecret } from "../lib/secretPrompt.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);

const existing = await pool.query(
  "SELECT id FROM users WHERE role IN ('boss', 'admin') AND is_active = TRUE LIMIT 1"
);

let username = (process.env.INIT_ADMIN_USERNAME ?? "").trim().toLowerCase();
let password = process.env.INIT_ADMIN_PASSWORD ?? "";
let displayName = (process.env.INIT_ADMIN_NAME ?? "").trim();

if (!username || !password || !displayName) {
  if (!stdin.isTTY) {
    console.error("非交互模式请设置 INIT_ADMIN_USERNAME、INIT_ADMIN_PASSWORD、INIT_ADMIN_NAME");
    process.exit(1);
  }
  const rl = readline.createInterface({ input: stdin, output: stdout });
  if (!username) username = (await rl.question("管理员登录名: ")).trim().toLowerCase();
  if (!displayName) displayName = (await rl.question("显示名称: ")).trim();
  rl.close();
  if (!password) password = await promptSecret(stdin, stdout, "密码（输入隐藏）: ");
}

if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
  console.error("登录名须为 3-32 位小写字母、数字、下划线或短横线");
  process.exit(1);
}
if (!displayName) {
  console.error("显示名称不能为空");
  process.exit(1);
}
validatePassword(password, username);

if (existing.rowCount && process.env.INIT_ADMIN_ALLOW_ADDITIONAL !== "1") {
  console.error("已存在 Boss/行政账号。如需再创建，请设置 INIT_ADMIN_ALLOW_ADDITIONAL=1");
  process.exit(1);
}

if (await findUserByUsername(pool, username)) {
  console.error("登录名已存在");
  process.exit(1);
}

const passwordHash = await hashPassword(password);
const inserted = await pool.query(
  `INSERT INTO users (username, password_hash, display_name, role, must_change_password)
   VALUES ($1, $2, $3, 'boss', FALSE)
   RETURNING id, username, display_name, role`,
  [username, passwordHash, displayName]
);
console.log(`已创建管理员 ${inserted.rows[0].display_name}（${inserted.rows[0].username}）`);
await pool.end();
