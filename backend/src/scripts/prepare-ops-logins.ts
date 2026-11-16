import { createPool } from "../db.js";
import { planOpsLogins, assertOpsProvisioningEnabled, hashOpsInitialPassword, type ExistingOpsLogin } from "../lib/opsIndividualLogin.js";

const args = process.argv.slice(2);
if (args.some(arg => !["--plan", "--apply"].includes(arg)) || args.includes("--plan") && args.includes("--apply")) throw Error("用法：--plan 或 --apply");
if (!args.includes("--apply")) {
  console.log(JSON.stringify({ mode: "plan", createsAccounts: false, loginEnabled: false, plans: planOpsLogins() }, null, 2));
} else {
  assertOpsProvisioningEnabled(process.env.OPS_INDIVIDUAL_LOGIN_ENABLED);
  if (!process.env.DATABASE_URL) throw Error("缺少 DATABASE_URL");
  const pool = createPool(process.env.DATABASE_URL), client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(13080, 15)");
    const existing = await client.query<ExistingOpsLogin>('SELECT id, username, ops_person_ref AS "opsPersonRef", role, account_kind AS "accountKind" FROM users');
    const plans = planOpsLogins(existing.rows);
    let prepared = 0;
    for (const plan of plans) {
      if (plan.action !== "create_disabled") continue;
      const passwordHash = await hashOpsInitialPassword();
      const created = await client.query("INSERT INTO users (username,password_hash,display_name,role,account_kind,ops_person_ref,is_active,must_change_password) VALUES ($1,$2,$3,'ops','employee',$4,FALSE,TRUE) RETURNING id", [plan.username, passwordHash, plan.displayName, plan.personRef]);
      await client.query("INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,after_data) VALUES (NULL,'ops_login_prepare_disabled','user',$1,$2)", [created.rows[0].id, JSON.stringify({ personRef: plan.personRef, username: plan.username, isActive: false, mustChangePassword: true })]);
      prepared++;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "prepared_disabled", prepared, retained: plans.filter(plan => plan.action === "keep_existing").length, loginEnabled: false }));
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); await pool.end(); }
}
