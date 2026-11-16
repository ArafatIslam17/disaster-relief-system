import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseQuery, route } from "@/lib/api";
import { requirePermission } from "@/lib/auth/guard";

const query = z.object({ status: z.enum(["Pending", "Approved", "Rejected"]).optional() });

/** UC-04: organisation review queue (System Administrator). */
export const GET = route(async (req) => {
  await requirePermission(req, "organisation.review");
  const { status } = parseQuery(req, query);
  const orgs = await prisma.organisation.findMany({
    where: { status },
    orderBy: [{ status: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { users: true } },
      users: { where: { role: "GROUP_COORDINATOR" }, select: { userId: true, fullName: true, mobileNumber: true, status: true }, orderBy: { createdAt: "asc" } },
    },
  });
  return ok({
    organisations: orgs.map((o) => ({
      organisationId: o.organisationId,
      name: o.name,
      orgType: o.orgType,
      status: o.status,
      rejectionReason: o.rejectionReason,
      createdAt: o.createdAt,
      userCount: o._count.users,
      coordinators: o.users,
    })),
  });
});
