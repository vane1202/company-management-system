import { loadConfig } from "./config.js";
import { createPool } from "./db.js";
import { migrate } from "./migrate.js";
import { createApp } from "./app.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool);
const app = createApp(pool, config);
const server = app.listen(config.port, config.host, () => {
  console.log(`CMS listening on http://${config.host}:${config.port}`);
});
const lanServer = config.lanHost ? app.listen(config.port, config.lanHost, () => {
  console.log(`CMS LAN listening on http://${config.lanHost}:${config.port}`);
}) : undefined;
for (const listener of [server, lanServer]) listener?.on("error", (error: NodeJS.ErrnoException) => {
  console.error("CMS listener failed:", error.code);
  void shutdown(1);
});

async function shutdown(code = 0) {
  if (server.listening) server.close();
  if (lanServer?.listening) lanServer.close();
  await pool.end();
  process.exit(code);
}
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
