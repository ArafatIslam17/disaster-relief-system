import { prisma } from "@/lib/db";
import { ok, route } from "@/lib/api";

/** Public: approved organisations a new user can register under. Names only, no counts or members. */
export const GET = route(async () => {
  const orgs = await prisma.organisation.findMany({
    where: { status: "Approved" },
    select: { organisationId: true, name: true, orgType: true },
    orderBy: { name: "asc" },
  });
  return ok({ organisations: orgs });
});
