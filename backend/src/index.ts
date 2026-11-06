import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const app = createApp(pool, config);
const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`CMS listening on ${config.port}`);
});

async function shutdown() {
  server.close();
  await pool.end();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
