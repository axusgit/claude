// Folder access resolution. Access is granted on a folder and inherited by its
// whole subtree (matching how KeePass groups nest). A non-admin user can reach a
// folder iff that folder, or any ancestor, has an access row for one of their
// principals (a group they're in, or their own email). Admins see everything.
import { pool } from "./db.js";
import type { Identity } from "./identity.js";
import { apmsRole, principalsFor } from "./identity.js";

export interface FolderRow {
  id: string;
  parent_id: string | null;
  name_enc: string;
  wrapped_fk: string;
  sort: number;
}

interface AccessResult {
  // Folder ids the caller may READ (self + descendants of any granted folder).
  readable: Set<string>;
  // Subset the caller may WRITE to.
  writable: Set<string>;
  // true for admins (all folders, read + write).
  isAdmin: boolean;
}

// Resolve which of the existing folders the identity may read/write.
export async function resolveAccess(id: Identity): Promise<AccessResult> {
  const admin = apmsRole(id) === "admin";
  const folders = (
    await pool.query<{ id: string; parent_id: string | null }>(
      "select id, parent_id from folder",
    )
  ).rows;

  if (admin) {
    const all = new Set(folders.map((f) => f.id));
    return { readable: all, writable: new Set(all), isAdmin: true };
  }

  const principals = principalsFor(id);
  const grants = (
    await pool.query<{ folder_id: string; can_write: boolean; principal: string }>(
      `select folder_id, can_write, principal from folder_access where principal = any($1)`,
      [principals],
    )
  ).rows;

  // Build child adjacency to walk subtrees from each granted root.
  const children = new Map<string | null, string[]>();
  for (const f of folders) {
    const list = children.get(f.parent_id) ?? [];
    list.push(f.id);
    children.set(f.parent_id, list);
  }

  const readable = new Set<string>();
  const writable = new Set<string>();
  const walk = (root: string, write: boolean) => {
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      readable.add(cur);
      if (write) writable.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
  };
  for (const g of grants) walk(g.folder_id, g.can_write);

  return { readable, writable, isAdmin: false };
}
