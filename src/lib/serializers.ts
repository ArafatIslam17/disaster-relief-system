import type { AuthContext } from "./auth/guard";
import { visibleMobile } from "./privacy";

type HouseholdRow = {
  householdId: string;
  shortCode: string;
  areaId: string;
  headName: string;
  mobileNumber: string | null;
  memberCount: number;
  consentGiven: boolean;
  consentAt: Date;
  gpsLocation: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  registeredBy: string;
  registeredByUser: { organisationId: string | null };
};

/** The only way a household leaves the API: phone masked unless the caller's org registered it (NFR06). */
export function serializeHousehold(auth: Pick<AuthContext, "organisationId">, h: HouseholdRow) {
  const phone = visibleMobile(auth, h.registeredByUser.organisationId, h.mobileNumber);
  return {
    householdId: h.householdId,
    shortCode: h.shortCode,
    areaId: h.areaId,
    headName: h.headName,
    mobileNumber: phone.mobileNumber,
    mobileMasked: phone.mobileMasked,
    memberCount: h.memberCount,
    consentGiven: h.consentGiven,
    consentAt: h.consentAt.toISOString(),
    gpsLocation: h.gpsLocation,
    version: h.version,
    registeredBy: h.registeredBy,
    registeredByOrganisationId: h.registeredByUser.organisationId,
    ownOrganisation: !!auth.organisationId && auth.organisationId === h.registeredByUser.organisationId,
    createdAt: h.createdAt.toISOString(),
    updatedAt: h.updatedAt.toISOString(),
  };
}

export const householdSelect = {
  householdId: true,
  shortCode: true,
  areaId: true,
  headName: true,
  mobileNumber: true,
  memberCount: true,
  consentGiven: true,
  consentAt: true,
  gpsLocation: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  registeredBy: true,
  registeredByUser: { select: { organisationId: true } },
} as const;
