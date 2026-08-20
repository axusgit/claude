import pg from "pg";
import { config } from "./config.js";
import { SCHEMA_SQL } from "./schema.js";
export const pool = new pg.Pool({ connectionString: config.databaseUrl });
export async function migrate() {
    await pool.query(SCHEMA_SQL);
}
export async function q(text, params) {
    return pool.query(text, params);
}
//# sourceMappingURL=db.js.map