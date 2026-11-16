import { fieldDb, type AuthSession } from "../offline-db";
import {
  constantTimeEqual,
  deriveSecretMaterial,
  generateDataKey,
  randomBytes,
  unwrapDataKey,
  wrapDataKey,
} from "../offline-crypto";

export const PIN_TTL_MS = 7 * 24 * 3600_000;
export const MAX_PIN_ATTEMPTS = 5;

/** The decrypted data key exists only in memory, only while the app is unlocked. */
let dataKey: CryptoKey | null = null;

export function currentKey(): CryptoKey {
  if (!dataKey) throw new Error("Vault is locked");
  return dataKey;
}
export function isUnlocked() {
  return dataKey !== null;
}
export function lockVault() {
  dataKey = null;
}

export function getSession() {
  return fieldDb().authSession.get("current");
}

export type SessionIdentity = Pick<
  AuthSession,
  "userId" | "fullName" | "mobileNumber" | "role" | "organisationId" | "organisationName" | "deviceId" | "operationId" | "operationName"
>;

/** New install / new user: fresh random data key, held in memory until a PIN is set. */
export async function createVaultKey() {
  dataKey = await generateDataKey();
}

/** Recovery path: unwrap the data key with the account password (after PIN lockout or expiry). */
export async function unlockWithPassword(password: string): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  try {
    const { kek } = await deriveSecretMaterial(password, s.passwordSalt);
    dataKey = await unwrapDataKey(s.passwordWrappedKey, kek);
    return true;
  } catch {
    return false;
  }
}

/** Persist the session, wrapping the in-memory data key with the new PIN and the current password. */
export async function setPinAndSave(identity: SessionIdentity, pin: string, password: string) {
  const key = currentKey();
  const pinSalt = randomBytes(16);
  const passwordSalt = randomBytes(16);
  const pinMat = await deriveSecretMaterial(pin, pinSalt);
  const pwMat = await deriveSecretMaterial(password, passwordSalt);
  const session: AuthSession = {
    id: "current",
    ...identity,
    pinSalt,
    pinVerifier: pinMat.verifier,
    pinWrappedKey: await wrapDataKey(key, pinMat.kek),
    pinExpiresAt: Date.now() + PIN_TTL_MS,
    failedPinAttempts: 0,
    lockedOut: false,
    passwordSalt,
    passwordWrappedKey: await wrapDataKey(key, pwMat.kek),
    createdAt: Date.now(),
  };
  await fieldDb().authSession.put(session);
}

/** After an online re-authentication while unlocked (e.g. session cookie expired), re-wrap with the current password. */
export async function rewrapPassword(password: string, identity?: Partial<SessionIdentity>) {
  const s = await getSession();
  if (!s) return;
  const passwordSalt = randomBytes(16);
  const { kek } = await deriveSecretMaterial(password, passwordSalt);
  await fieldDb().authSession.update("current", { ...identity, passwordSalt, passwordWrappedKey: await wrapDataKey(currentKey(), kek) });
}

export type PinResult = { ok: true } | { ok: false; reason: "wrong"; remaining: number } | { ok: false; reason: "lockedOut" | "expired" | "noSession" };

export async function unlockWithPin(pin: string): Promise<PinResult> {
  const s = await getSession();
  if (!s) return { ok: false, reason: "noSession" };
  if (s.lockedOut) return { ok: false, reason: "lockedOut" };
  if (Date.now() > s.pinExpiresAt) return { ok: false, reason: "expired" };
  const { verifier, kek } = await deriveSecretMaterial(pin, s.pinSalt);
  if (!constantTimeEqual(verifier, s.pinVerifier)) {
    const failed = s.failedPinAttempts + 1;
    const lockedOut = failed >= MAX_PIN_ATTEMPTS;
    await fieldDb().authSession.update("current", { failedPinAttempts: failed, lockedOut });
    return lockedOut ? { ok: false, reason: "lockedOut" } : { ok: false, reason: "wrong", remaining: MAX_PIN_ATTEMPTS - failed };
  }
  dataKey = await unwrapDataKey(s.pinWrappedKey, kek);
  await fieldDb().authSession.update("current", { failedPinAttempts: 0 });
  return { ok: true };
}
