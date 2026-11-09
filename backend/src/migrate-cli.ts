import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const applied = await migrate(pool);
console.log(applied.length ? `已应用迁移：${applied.join(", ")}` : "没有待应用的迁移");
await pool.end();
