import fs from "node:fs/promises";
import { createPool } from "../db.js";
import { planCsLogins, hashCsInitialPassword, csIndividualLoginEnabled, assertCsProvisioningEnabled, type CsLoginPerson, type ExistingCsLogin } from "../lib/csIndividualLogin.js";

// Default --plan is offline and never connects to the database. --apply prepares
// disabled users only and is deliberately excluded from app startup/migrations.
const args = process.argv.slice(2);
const flags = new Set(["--input", "--existing", "--plan", "--apply"]);
for (let i = 0; i < args.length; i++) {
  if (!flags.has(args[i])) throw Error("未知参数；用法：--input <名单.json> [--existing <账号快照.json>] [--plan | --apply]");
  if (["--input", "--existing"].includes(args[i])) {
    if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error("参数缺少文件路径");
    i++;
  }
}
function option(name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
async function readJson(file: string) { return JSON.parse((await fs.readFile(file, "utf8")).replace(/^\uFEFF/, "")); }
const input = option("--input");
if (!input) throw Error("请通过 --input 提供含稳定人员 ID 的客服名单");
const source = await readJson(input);
const people: CsLoginPerson[] = Array.isArray(source) ? source : source.people;
const applying = args.includes("--apply");
if (applying && args.includes("--plan")) throw Error("--plan 与 --apply 不能同时使用");
if (!applying) {
  const existingPath = option("--existing");
  const existing: ExistingCsLogin[] = existingPath ? await readJson(existingPath) : [];
  console.log(JSON.stringify({ mode: "plan", createsAccounts: false, loginEnabled: false, existingChecked: !!existingPath, plans: planCsLogins(people, existing) }, null, 2));
} else {
  assertCsProvisioningEnabled(csIndividualLoginEnabled(process.env.CS_INDIVIDUAL_LOGIN_ENABLED));
  if (option("--existing")) throw Error("--apply 直接读取正式库，不接受离线账号快照");
  if (!process.env.DATABASE_URL) throw Error("缺少 DATABASE_URL");
  const pool = createPool(process.env.DATABASE_URL);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(13080, 14)");
    // This query deliberately fails before any write when migration 014 is absent.
    const existing = await client.query('SELECT id, username, person_ref AS "personRef", role, account_kind AS "accountKind", is_active AS "isActive" FROM users');
    const plans = planCsLogins(people, existing.rows);
    let prepared = 0;
    for (const plan of plans) {
      if (plan.action !== "create_disabled") continue;
      const passwordHash = await hashCsInitialPassword();
      const created = await client.query("INSERT INTO users (username, password_hash, display_name, role, account_kind, person_ref, is_active, must_change_password) VALUES ($1, $2, $3, 'cs', 'employee', $4, FALSE, TRUE) RETURNING id", [plan.username, passwordHash, plan.displayName, plan.personRef]);
      await client.query("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, after_data) VALUES (NULL, 'cs_login_prepare_disabled', 'user', $1, $2)", [created.rows[0].id, JSON.stringify({ personRef: plan.personRef, username: plan.username, isActive: false, mustChangePassword: true })]);
      prepared++;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "prepared_disabled", prepared, retained: plans.filter(row => row.action === "keep_existing").length, skipped: plans.filter(row => row.action === "skip_inactive").length, loginEnabled: false }));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); await pool.end(); }
}
