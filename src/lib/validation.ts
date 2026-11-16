import { z } from "zod";

export const uuid = z.string().uuid();
export const mobileNumber = z
  .string()
  .trim()
  .regex(/^01[3-9][0-9]{8}$/, "Mobile number must be an 11-digit Bangladeshi number starting with 01.");
export const optionalMobile = z
  .union([mobileNumber, z.literal(""), z.null()])
  .transform((v) => (v === "" || v === null ? null : v));
/** English letters only (NFR18 / DB CHECK household_head_name_english). */
export const headName = z
  .string()
  .trim()
  .min(2, "Head of household name is too short.")
  .max(80)
  .regex(/^[A-Za-z][A-Za-z .'-]*$/, "Head of household name must use English letters only.")
  .transform((v) => v.replace(/\s+/g, " "));
export const memberCount = z.coerce.number().int().min(1).max(50);
export const password = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128)
  .regex(/[A-Za-z]/, "Password must contain a letter.")
  .regex(/[0-9]/, "Password must contain a digit.");
export const fullName = z.string().trim().min(2).max(100);
export const gpsLocation = z
  .string()
  .regex(/^-?\d{1,2}\.\d{3,7},-?\d{1,3}\.\d{3,7}$/, "GPS must be 'lat,lng' in decimal degrees.")
  .nullable();
export const isoDateTime = z.string().datetime({ offset: true }).transform((v) => new Date(v));
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD.")
  .transform((v) => new Date(`${v}T00:00:00Z`));
