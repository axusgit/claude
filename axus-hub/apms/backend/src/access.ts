// Folder access resolution. Access is granted on a folder and inherited by its
// whole subtree (matching how KeePass groups nest). A non-admin user can reach a
// folder iff that folder, or any ancestor, has an access row for one of their
// principals (a group they're in, or their own email).
//
// Admins see every NON-restricted folder. A RESTRICTED folder (and everything
// under it) is a confidential zone that is EXEMPT from the admin bypass: it is
// reachable only through an explicit grant, for everyone — so a vault admin who
// is not a named owner of a confidential folder never sees it or its key material.
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
  // Folder ids the caller may READ (self + descendants of any granted folder,
  // plus — for admins — every non-restricted folder).
  readable: Set<string>;
  // Subset the caller may WRITE to.
  writable: Set<string>;
  // true for vault admins (apms-role-admin).
  isAdmin: boolean;
  // Folder ids that sit inside a restricted/confidential zone (self or any
  // ancestor is restricted). Used by routes to apply owner-only gating.
  restrictedZone: Set<string>;
}

// Walk down from the restricted roots to mark every folder inside a confidential
// zone (the restricted folder itself and all of its descendants).
function computeRestrictedZone(
  folders: { id: string; parent_id: string | null; restricted: boolean }[],
  children: Map<string | null, string[]>,
): Set<string> {
  const zone = new Set<string>();
  const mark = (root: string) => {
    const stack = [root];
    while (stack.length) {
      const cur = stack.pop()!;
      if (zone.has(cur)) continue;
      zone.add(cur);
      for (const c of children.get(cur) ?? []) stack.push(c);
    }
  };
  for (const f of folders) if (f.restricted) mark(f.id);
  return zone;
}

// Resolve which of the existing folders the identity may read/write.
export async function resolveAccess(id: Identity): Promise<AccessResult> {
  const admin = apmsRole(id) === "admin";
  const folders = (
    await pool.query<{ id: string; parent_id: string | null; restricted: boolean }>(
      "select id, parent_id, restricted from folder",
    )
  ).rows;

  // Child adjacency, used both to walk grant subtrees and to mark restricted zones.
  const children = new Map<string | null, string[]>();
  for (const f of folders) {
    const list = children.get(f.parent_id) ?? [];
    list.push(f.id);
    children.set(f.parent_id, list);
  }
  const restrictedZone = computeRestrictedZone(folders, children);

  const readable = new Set<string>();
  const writable = new Set<string>();

  // Grant-based access applies to EVERYONE (admins included). This is the only
  // path into a confidential zone, so a grant is what lets the two named owners
  // reach it — and the absence of one is what hides it from every other admin.
  const principals = principalsFor(id);
  const grants = (
    await pool.query<{ folder_id: string; can_write: boolean }>(
      `select folder_id, can_write from folder_access where principal = any($1)`,
      [principals],
    )
  ).rows;
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

  // Admin bonus: full access to every folder that is NOT inside a restricted zone.
  if (admin) {
    for (const f of folders) {
      if (restrictedZone.has(f.id)) continue;
      readable.add(f.id);
      writable.add(f.id);
    }
  }

  return { readable, writable, isAdmin: admin, restrictedZone };
}
