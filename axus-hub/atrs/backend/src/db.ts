import pg from "pg";
import { config } from "./config.js";
import { SCHEMA_SQL } from "./schema.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function migrate(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params as unknown[]);
}
