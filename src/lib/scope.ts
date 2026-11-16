import type { Prisma } from "@prisma/client";
import type { AuthContext } from "./auth/guard";

/** Coordinators only see households their organisation registered; other permitted roles see all. */
export function householdScope(auth: AuthContext): Prisma.HouseholdWhereInput {
  return auth.role === "GROUP_COORDINATOR" ? { registeredByUser: { organisationId: auth.organisationId } } : {};
}
