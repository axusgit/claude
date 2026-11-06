// APMS client-side cryptography. This is a zero-knowledge vault: everything in
// this file runs in the browser, and only ciphertext ever leaves it.
//
// Key model (two-tier, so the passphrase can change without re-encrypting data):
//   passphrase --Argon2id--> PK  (passphrase key)
//   VK  = random 256-bit vault key, the root of trust
//   wrapped_vk          = AES-GCM(PK, VK)                 (unlock path)
//   recovery_wrapped_vk = RSA-OAEP(recoveryPub, VK)       (break-glass path)
//   each folder: FK = random 256-bit key; wrapped_fk = AES-GCM(VK, FK)
//   each item:   data_enc = AES-GCM(FK, JSON(fields))
import { argon2id } from "@noble/hashes/argon2";

// --- Argon2id parameters (OWASP-recommended floor; stored in the DB so they can
// be raised later without breaking existing vaults). m is in KiB → 19 MiB.
export const KDF = { alg: "argon2id", m: 19456, t: 2, p: 1 } as const;
export type KdfParams = { alg: string; m: number; t: number; p: number };

const VERIFIER_CANARY = "axus-apms-v1";

// ---------------------------------------------------------------- base64 helpers
export function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
export function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// TS 5.7 types TypedArrays as generic over their backing buffer, so a plain
// `Uint8Array` (ArrayBufferLike) isn't assignable to Web Crypto's `BufferSource`
// (which wants ArrayBuffer-backed). Our bytes are always ArrayBuffer-backed at
// runtime, so coerce at the Web Crypto boundary.
const src = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

// ---------------------------------------------------------------- Argon2id (KDF)
export function derivePassphraseKey(passphrase: string, saltB64: string, kdf: KdfParams): Uint8Array {
  return argon2id(enc.encode(passphrase.normalize("NFKC")), b64decode(saltB64), {
    t: kdf.t,
    m: kdf.m,
    p: kdf.p,
    dkLen: 32,
  });
}

// ---------------------------------------------------------------- AES-256-GCM
async function importAes(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", src(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}
// Output layout: iv(12) || ciphertext+tag, base64-encoded.
export async function aesEncrypt(rawKey: Uint8Array, plaintext: Uint8Array): Promise<string> {
  const key = await importAes(rawKey);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: src(iv) }, key, src(plaintext)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return b64encode(out);
}
export async function aesDecrypt(rawKey: Uint8Array, blobB64: string): Promise<Uint8Array> {
  const key = await importAes(rawKey);
  const blob = b64decode(blobB64);
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: src(iv) }, key, src(ct)));
}
export async function encryptJson(rawKey: Uint8Array, obj: unknown): Promise<string> {
  return aesEncrypt(rawKey, enc.encode(JSON.stringify(obj)));
}
export async function decryptJson<T>(rawKey: Uint8Array, blobB64: string): Promise<T> {
  return JSON.parse(dec.decode(await aesDecrypt(rawKey, blobB64))) as T;
}
export async function encryptString(rawKey: Uint8Array, s: string): Promise<string> {
  return aesEncrypt(rawKey, enc.encode(s));
}
export async function decryptString(rawKey: Uint8Array, blobB64: string): Promise<string> {
  return dec.decode(await aesDecrypt(rawKey, blobB64));
}

// ---------------------------------------------------------------- RSA-OAEP (recovery)
const RSA_ALG = { name: "RSA-OAEP", hash: "SHA-256" } as const;

export interface RecoveryKeypair {
  publicKeyB64: string; // SPKI, stored server-side
  privateKeyB64: string; // PKCS8, shown ONCE to the admin to store offline
}
export async function generateRecoveryKeypair(): Promise<RecoveryKeypair> {
  const pair = await crypto.subtle.generateKey(
    { ...RSA_ALG, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ["encrypt", "decrypt"],
  );
  const pub = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const priv = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return { publicKeyB64: b64encode(pub), privateKeyB64: b64encode(priv) };
}
export async function rsaWrap(publicKeyB64: string, data: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("spki", src(b64decode(publicKeyB64)), RSA_ALG, false, ["encrypt"]);
  return b64encode(new Uint8Array(await crypto.subtle.encrypt(RSA_ALG, key, src(data))));
}
export async function rsaUnwrap(privateKeyB64: string, blobB64: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("pkcs8", src(b64decode(privateKeyB64)), RSA_ALG, false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt(RSA_ALG, key, src(b64decode(blobB64))));
}

// ---------------------------------------------------------------- vault lifecycle
export interface NewVaultMaterial {
  kdf: string; // JSON.stringify(KDF)
  kdf_salt: string;
  wrapped_vk: string;
  verifier: string;
  recovery_pubkey: string;
  recovery_wrapped_vk: string;
  // Returned to the UI only (never persisted): the admin saves this offline.
  recoveryPrivateKeyB64: string;
}
// Build a brand-new vault from the chosen passphrase.
export async function createVaultMaterial(passphrase: string): Promise<{ material: NewVaultMaterial; vk: Uint8Array }> {
  const vk = randomBytes(32);
  const salt = randomBytes(16);
  const saltB64 = b64encode(salt);
  const pk = derivePassphraseKey(passphrase, saltB64, KDF);
  const wrapped_vk = await aesEncrypt(pk, vk);
  const verifier = await encryptString(vk, VERIFIER_CANARY);
  const rec = await generateRecoveryKeypair();
  const recovery_wrapped_vk = await rsaWrap(rec.publicKeyB64, vk);
  return {
    vk,
    material: {
      kdf: JSON.stringify(KDF),
      kdf_salt: saltB64,
      wrapped_vk,
      verifier,
      recovery_pubkey: rec.publicKeyB64,
      recovery_wrapped_vk,
      recoveryPrivateKeyB64: rec.privateKeyB64,
    },
  };
}

// Recover VK from the stored unlock material + passphrase. Throws on wrong pass.
export async function unlockVault(
  passphrase: string,
  v: { kdf: string; kdf_salt: string; wrapped_vk: string; verifier: string },
): Promise<Uint8Array> {
  const kdf = JSON.parse(v.kdf) as KdfParams;
  const pk = derivePassphraseKey(passphrase, v.kdf_salt, kdf);
  let vk: Uint8Array;
  try {
    vk = await aesDecrypt(pk, v.wrapped_vk);
  } catch {
    throw new Error("Incorrect passphrase");
  }
  // Confirm against the canary (defence against a corrupted/forged wrapped_vk).
  try {
    const canary = await decryptString(vk, v.verifier);
    if (canary !== VERIFIER_CANARY) throw new Error();
  } catch {
    throw new Error("Incorrect passphrase");
  }
  return vk;
}

// Re-wrap the SAME VK under a new passphrase (change-passphrase / finish recovery).
export async function rewrapForNewPassphrase(
  vk: Uint8Array,
  newPassphrase: string,
): Promise<{ kdf: string; kdf_salt: string; wrapped_vk: string }> {
  const salt = randomBytes(16);
  const saltB64 = b64encode(salt);
  const pk = derivePassphraseKey(newPassphrase, saltB64, KDF);
  return { kdf: JSON.stringify(KDF), kdf_salt: saltB64, wrapped_vk: await aesEncrypt(pk, vk) };
}

// --- folder keys
export async function newFolderKey(vk: Uint8Array): Promise<{ fk: Uint8Array; wrapped_fk: string }> {
  const fk = randomBytes(32);
  return { fk, wrapped_fk: await aesEncrypt(vk, fk) };
}
export async function unwrapFolderKey(vk: Uint8Array, wrappedFkB64: string): Promise<Uint8Array> {
  return aesDecrypt(vk, wrappedFkB64);
}

// ---------------------------------------------------------------- TOTP (RFC 6238)
// base32 decode (RFC 4648, no padding required).
function base32Decode(input: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.replace(/=+$/g, "").replace(/\s/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// Accepts a bare base32 secret or a full otpauth:// URI. Returns {code, secondsLeft}.
export async function totpNow(secretOrUri: string): Promise<{ code: string; secondsLeft: number } | null> {
  let secret = secretOrUri.trim();
  let digits = 6;
  let period = 30;
  if (secret.startsWith("otpauth://")) {
    try {
      const u = new URL(secret);
      secret = u.searchParams.get("secret") ?? "";
      digits = Number(u.searchParams.get("digits")) || 6;
      period = Number(u.searchParams.get("period")) || 30;
    } catch {
      return null;
    }
  }
  const keyBytes = base32Decode(secret);
  if (keyBytes.length === 0) return null;
  const counter = Math.floor(Date.now() / 1000 / period);
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey("raw", src(keyBytes), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", key, src(msg)));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const code = String(bin % 10 ** digits).padStart(digits, "0");
  const secondsLeft = period - (Math.floor(Date.now() / 1000) % period);
  return { code, secondsLeft };
}
