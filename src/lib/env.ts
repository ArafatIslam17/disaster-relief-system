import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  AUTH_JWT_SECRET: z.string().min(32, "AUTH_JWT_SECRET must be at least 32 characters"),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(72),
  AUTH_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  DUPLICATE_LIKELY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
  DUPLICATE_POSSIBLE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.65),
  REPEAT_DISTRIBUTION_WINDOW_HOURS: z.coerce.number().positive().default(24),
  VOID_WINDOW_HOURS: z.coerce.number().positive().default(24),
  PII_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

let cached: z.infer<typeof schema> | null = null;

/** Parsed lazily so `next build` does not require runtime secrets. */
export function env() {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}
