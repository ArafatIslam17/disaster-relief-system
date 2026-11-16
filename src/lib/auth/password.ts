import "server-only";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const COST = 12;
/** Real hash of a random string, used to equalise timing when the mobile number is unknown. */
let dummyHash: string | null = null;

export function hashPassword(plain: string) {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string | null) {
  if (!hash) {
    dummyHash ??= await bcrypt.hash(`dummy-${Math.random()}`, COST);
    await bcrypt.compare(plain, dummyHash);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";

/** 10-character temporary password without ambiguous characters (0/O, 1/l/I). Always has a letter and a digit. */
export function generateTemporaryPassword(): string {
  const all = LETTERS + DIGITS;
  const chars = [LETTERS[randomInt(LETTERS.length)], DIGITS[randomInt(DIGITS.length)]];
  while (chars.length < 10) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
