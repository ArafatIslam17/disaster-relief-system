import type { AuthContext } from "./auth/guard";

/** NFR06: "01712345892" → "017XX-XXX892". */
export function maskMobile(mobile: string | null): string | null {
  if (!mobile) return null;
  if (mobile.length < 6) return "XXX";
  return `${mobile.slice(0, 3)}XX-XXX${mobile.slice(-3)}`;
}

/**
 * Full phone numbers are visible only to members of the organisation that registered the
 * household. Everyone else (other organisations, operation administrators) sees a mask.
 */
export function visibleMobile(
  auth: Pick<AuthContext, "organisationId">,
  registrarOrganisationId: string | null,
  mobile: string | null,
): { mobileNumber: string | null; mobileMasked: boolean } {
  if (!mobile) return { mobileNumber: null, mobileMasked: false };
  const sameOrg = !!auth.organisationId && auth.organisationId === registrarOrganisationId;
  return sameOrg ? { mobileNumber: mobile, mobileMasked: false } : { mobileNumber: maskMobile(mobile), mobileMasked: true };
}
