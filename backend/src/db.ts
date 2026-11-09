import pg from "pg";

export type Db = pg.Pool;

const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 10
  });
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
