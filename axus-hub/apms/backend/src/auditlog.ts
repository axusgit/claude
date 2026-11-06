import { pool } from "./db.js";

// Append an access-log row. Never pass secret values — only ids/labels. Failures
// are swallowed: auditing must never break the operation it records.
export async function logAudit(
  actor: string,
  action: string,
  target?: string | null,
  detail?: string | null,
): Promise<void> {
  try {
    await pool.query(
      "insert into audit (actor, action, target, detail) values ($1, $2, $3, $4)",
      [actor, action, target ?? null, detail ?? null],
    );
  } catch {
    /* auditing is best-effort */
  }
}
