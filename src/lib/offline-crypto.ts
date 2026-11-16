/**
 * Web Crypto helpers for the field app's encrypted IndexedDB (NFR04).
 *
 * Key hierarchy:
 *   data key (random AES-GCM 256) — encrypts household PII and outbox payloads; lives in memory only
 *   └─ wrapped by a key derived from the 4-digit PIN   (unlock on device, offline)
 *   └─ wrapped by a key derived from the account password (recovery after PIN lockout / expiry)
 * One PBKDF2 run yields 512 bits: the first half becomes a salted verifier hash, the second half
 * the key-encryption key, so an unlock costs a single derivation on a low-end phone.
 */

export type EncBlob = { iv: Uint8Array<ArrayBuffer>; ct: ArrayBuffer };

export const PBKDF2_ITERATIONS = 150_000;

const te = new TextEncoder();
const td = new TextDecoder();

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function deriveSecretMaterial(secret: string, salt: Uint8Array<ArrayBuffer>, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey("raw", te.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, 512));
  const verifier = toHex(await crypto.subtle.digest("SHA-256", bits.slice(0, 32)));
  const kek = await crypto.subtle.importKey("raw", bits.slice(32), { name: "AES-GCM" }, false, ["wrapKey", "unwrapKey"]);
  return { verifier, kek };
}

export function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapDataKey(dataKey: CryptoKey, kek: CryptoKey): Promise<EncBlob> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.wrapKey("raw", dataKey, kek, { name: "AES-GCM", iv });
  return { iv, ct };
}

/** Throws (OperationError) when the KEK is wrong — AES-GCM authenticates the wrapped key. */
export function unwrapDataKey(blob: EncBlob, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey("raw", blob.ct, kek, { name: "AES-GCM", iv: blob.iv }, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptJson(key: CryptoKey, value: unknown): Promise<EncBlob> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(value)));
  return { iv, ct };
}

export async function decryptJson<T>(key: CryptoKey, blob: EncBlob): Promise<T> {
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: blob.iv }, key, blob.ct);
  return JSON.parse(td.decode(pt)) as T;
}
