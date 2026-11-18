import pg from "pg";

export type Db = pg.Pool;

const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

export function createPool(databaseUrl: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    connectionTimeoutMillis: 4000
  });
  // pg removes its idle error listener while a client is checked out.
  // Checked-out queries report the failure through their promises.
  pool.on("connect", (client) => client.on("error", () => {}));
  pool.on("error", (error) => console.error("CMS idle database connection failed:", error.message));
  return pool;
}

export async function withTransaction<T>(
  db: pg.Pool,
  work: (client: pg.PoolClient) => Promise<T>,
  readOnly = false
): Promise<T> {
  const client = await db.connect();
  let discard = false;
  try {
    await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      discard = true;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = "code" in error ? String(error.code) : "";
  return /^08[0-9A-Z]{3}$/.test(code) ||
    ["57P01", "57P02", "57P03", "53300", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT",
      "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "EAI_AGAIN", "EPIPE"].includes(code) ||
    /^(timeout exceeded when trying to connect|Connection terminated(?: unexpectedly| due to connection timeout)?|Client (?:has encountered a connection error|was closed) and is not queryable)$/i.test(error.message);
}

export async function query<T extends pg.QueryResultRow>(
  db: pg.Pool | pg.PoolClient,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  db: pg.Pool | pg.PoolClient,
  text: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const rows = await query<T>(db, text, params);
  return rows[0];
}
