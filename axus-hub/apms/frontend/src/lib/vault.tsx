// Vault session: the only place the decrypted vault key (VK) lives, held in a ref
// in memory for the life of the unlocked session and wiped on lock / inactivity.
// All encrypt/decrypt happens here; the rest of the app works with plaintext
// objects and never touches ciphertext or keys.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { api, type SecretFields } from "./api";
import {
  createVaultMaterial,
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  newFolderKey,
  rewrapForNewPassphrase,
  rsaUnwrap,
  unlockVault,
  unwrapFolderKey,
} from "./crypto";

export interface DecFolder {
  id: string;
  parentId: string | null;
  name: string;
  sort: number;
  canWrite: boolean;
  fk: Uint8Array;
}
export interface DecItem {
  id: string;
  folderId: string;
  fields: SecretFields;
  updatedAt: string;
  updatedBy: string;
}

type Status = "locked" | "unlocking" | "unlocked";

interface VaultCtx {
  status: Status;
  isAdmin: boolean;
  folders: DecFolder[];
  items: DecItem[];
  error: string | null;
  // lifecycle
  createVault: (passphrase: string) => Promise<string>; // returns recovery private key (show once)
  unlock: (passphrase: string) => Promise<void>;
  lock: () => void;
  reload: () => Promise<void>;
  changePassphrase: (next: string) => Promise<void>;
  recover: (recoveryPrivateKeyB64: string, nextPassphrase: string) => Promise<void>;
  // folders
  createFolder: (parentId: string | null, name: string) => Promise<string>;
  renameFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  // items
  saveItem: (folderId: string, fields: SecretFields, id?: string) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  moveItem: (id: string, folderId: string) => Promise<void>;
  // bulk import (admin): [{path, fields}] with folder paths like ["Servers","Prod"]
  importEntries: (entries: { path: string[]; fields: SecretFields }[]) => Promise<number>;
}

const Ctx = createContext<VaultCtx | null>(null);
export function useVault(): VaultCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useVault outside provider");
  return c;
}

const AUTO_LOCK_MS = 15 * 60 * 1000;

export function VaultProvider({ isAdmin, children }: { isAdmin: boolean; children: ReactNode }) {
  const vk = useRef<Uint8Array | null>(null);
  const [status, setStatus] = useState<Status>("locked");
  const [folders, setFolders] = useState<DecFolder[]>([]);
  const [items, setItems] = useState<DecItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lockTimer = useRef<number | null>(null);

  const lock = useCallback(() => {
    if (vk.current) vk.current.fill(0);
    vk.current = null;
    setFolders([]);
    setItems([]);
    setStatus("locked");
  }, []);

  // Decrypt all accessible folders + items with the current VK.
  const loadAll = useCallback(async () => {
    const key = vk.current;
    if (!key) return;
    const [{ folders: frows }, { items: irows }] = await Promise.all([api.listFolders(), api.listItems()]);
    const decF: DecFolder[] = [];
    const fkById = new Map<string, Uint8Array>();
    for (const f of frows) {
      try {
        const fk = await unwrapFolderKey(key, f.wrapped_fk);
        const name = await decryptString(key, f.name_enc);
        fkById.set(f.id, fk);
        decF.push({ id: f.id, parentId: f.parent_id, name, sort: f.sort, canWrite: f.can_write, fk });
      } catch {
        /* skip a folder we somehow can't decrypt */
      }
    }
    const decI: DecItem[] = [];
    for (const it of irows) {
      const fk = fkById.get(it.folder_id);
      if (!fk) continue;
      try {
        const fields = await decryptJson<SecretFields>(fk, it.data_enc);
        decI.push({ id: it.id, folderId: it.folder_id, fields, updatedAt: it.updated_at, updatedBy: it.updated_by });
      } catch {
        /* skip undecryptable item */
      }
    }
    setFolders(decF.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)));
    setItems(decI);
  }, []);

  const reload = useCallback(async () => {
    await loadAll();
  }, [loadAll]);

  const unlock = useCallback(
    async (passphrase: string) => {
      setStatus("unlocking");
      setError(null);
      try {
        const material = await api.getVault();
        const key = await unlockVault(passphrase, material);
        vk.current = key;
        await loadAll();
        setStatus("unlocked");
        void api.logEvent("unlock");
      } catch (e) {
        vk.current = null;
        setStatus("locked");
        void api.logEvent("unlock_failed");
        throw e instanceof Error ? e : new Error("Unlock failed");
      }
    },
    [loadAll],
  );

  const createVault = useCallback(
    async (passphrase: string) => {
      setError(null);
      const { material, vk: key } = await createVaultMaterial(passphrase);
      const { recoveryPrivateKeyB64, ...body } = material;
      await api.initVault(body);
      vk.current = key;
      await loadAll();
      setStatus("unlocked");
      void api.logEvent("export_recovery_key");
      return recoveryPrivateKeyB64;
    },
    [loadAll],
  );

  const changePassphrase = useCallback(async (next: string) => {
    const key = vk.current;
    if (!key) throw new Error("Vault is locked");
    const body = await rewrapForNewPassphrase(key, next);
    await api.rekeyVault({ ...body, reason: "passphrase change" });
  }, []);

  const recover = useCallback(
    async (recoveryPrivateKeyB64: string, nextPassphrase: string) => {
      setError(null);
      const { recovery_wrapped_vk } = await api.recoveryMaterial();
      let key: Uint8Array;
      try {
        key = await rsaUnwrap(recoveryPrivateKeyB64.trim(), recovery_wrapped_vk);
      } catch {
        throw new Error("That recovery key could not unwrap the vault.");
      }
      const body = await rewrapForNewPassphrase(key, nextPassphrase);
      await api.rekeyVault({ ...body, reason: "recovery" });
      vk.current = key;
      await loadAll();
      setStatus("unlocked");
    },
    [loadAll],
  );

  // --- folder ops -----------------------------------------------------------
  const createFolder = useCallback(async (parentId: string | null, name: string) => {
    const key = vk.current;
    if (!key) throw new Error("Vault is locked");
    const { wrapped_fk } = await newFolderKey(key);
    const name_enc = await encryptString(key, name);
    const { id } = await api.createFolder({ parent_id: parentId, name_enc, wrapped_fk });
    await loadAll();
    return id;
  }, [loadAll]);

  const renameFolder = useCallback(async (id: string, name: string) => {
    const key = vk.current;
    if (!key) throw new Error("Vault is locked");
    const name_enc = await encryptString(key, name);
    await api.updateFolder(id, { name_enc });
    await loadAll();
  }, [loadAll]);

  const deleteFolder = useCallback(async (id: string) => {
    await api.deleteFolder(id);
    await loadAll();
  }, [loadAll]);

  // --- item ops -------------------------------------------------------------
  const saveItem = useCallback(
    async (folderId: string, fields: SecretFields, id?: string) => {
      const f = folders.find((x) => x.id === folderId);
      if (!f) throw new Error("Folder not found");
      const data_enc = await encryptJson(f.fk, fields);
      if (id) await api.updateItem(id, { data_enc });
      else await api.createItem({ folder_id: folderId, data_enc });
      await loadAll();
    },
    [folders, loadAll],
  );

  const deleteItem = useCallback(async (id: string) => {
    await api.deleteItem(id);
    await loadAll();
  }, [loadAll]);

  const moveItem = useCallback(
    async (id: string, folderId: string) => {
      const it = items.find((x) => x.id === id);
      const f = folders.find((x) => x.id === folderId);
      if (!it || !f) throw new Error("Not found");
      // Re-encrypt under the destination folder's key.
      const data_enc = await encryptJson(f.fk, it.fields);
      await api.updateItem(id, { data_enc, folder_id: folderId });
      await loadAll();
    },
    [items, folders, loadAll],
  );

  // --- import ---------------------------------------------------------------
  const importEntries = useCallback(
    async (entries: { path: string[]; fields: SecretFields }[]) => {
      const key = vk.current;
      if (!key) throw new Error("Vault is locked");
      // Resolve/create every folder path, caching id + fk per "/"-joined path.
      const current = await api.listFolders();
      const decByParent = new Map<string, { id: string; name: string; fk: Uint8Array }[]>();
      for (const f of current.folders) {
        try {
          const fk = await unwrapFolderKey(key, f.wrapped_fk);
          const name = await decryptString(key, f.name_enc);
          const pkey = f.parent_id ?? "";
          const list = decByParent.get(pkey) ?? [];
          list.push({ id: f.id, name, fk });
          decByParent.set(pkey, list);
        } catch {
          /* ignore */
        }
      }
      const pathCache = new Map<string, { id: string; fk: Uint8Array }>();
      const ensurePath = async (path: string[]): Promise<{ id: string; fk: Uint8Array } | null> => {
        if (path.length === 0) return null; // top-level items need a folder; caller handles
        const joined = path.join("/");
        const cached = pathCache.get(joined);
        if (cached) return cached;
        let parentId: string | null = null;
        let parentKey = "";
        let result: { id: string; fk: Uint8Array } | null = null;
        for (let i = 0; i < path.length; i++) {
          const seg = path[i];
          const siblings = decByParent.get(parentKey) ?? [];
          let hit = siblings.find((s) => s.name.toLowerCase() === seg.toLowerCase());
          if (!hit) {
            const { fk, wrapped_fk } = await newFolderKey(key);
            const name_enc = await encryptString(key, seg);
            const { id } = await api.createFolder({ parent_id: parentId, name_enc, wrapped_fk });
            hit = { id, name: seg, fk };
            siblings.push(hit);
            decByParent.set(parentKey, siblings);
          }
          parentId = hit.id;
          parentKey = hit.id;
          result = { id: hit.id, fk: hit.fk };
          pathCache.set(path.slice(0, i + 1).join("/"), result);
        }
        return result;
      };

      // A catch-all "Imported" folder for entries with no group.
      let fallback: { id: string; fk: Uint8Array } | null = null;
      const getFallback = async () => {
        if (!fallback) fallback = await ensurePath(["Imported"]);
        return fallback!;
      };

      const payload: { folder_id: string; data_enc: string }[] = [];
      for (const e of entries) {
        const target = e.path.length ? await ensurePath(e.path) : await getFallback();
        if (!target) continue;
        payload.push({ folder_id: target.id, data_enc: await encryptJson(target.fk, e.fields) });
      }
      let imported = 0;
      // Chunk to keep each request modest.
      for (let i = 0; i < payload.length; i += 200) {
        const chunk = payload.slice(i, i + 200);
        const r = await api.importItems(chunk);
        imported += r.imported;
      }
      await loadAll();
      return imported;
    },
    [loadAll],
  );

  // --- auto-lock on inactivity ---------------------------------------------
  useEffect(() => {
    if (status !== "unlocked") return;
    const reset = () => {
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
      lockTimer.current = window.setTimeout(lock, AUTO_LOCK_MS);
    };
    const events = ["mousedown", "keydown", "touchstart", "scroll"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      events.forEach((e) => window.removeEventListener(e, reset));
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
    };
  }, [status, lock]);

  const value: VaultCtx = {
    status,
    isAdmin,
    folders,
    items,
    error,
    createVault,
    unlock,
    lock,
    reload,
    changePassphrase,
    recover,
    createFolder,
    renameFolder,
    deleteFolder,
    saveItem,
    deleteItem,
    moveItem,
    importEntries,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
