import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { ApiError, conflict } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { coordinatorsOrSysAdmins, notifyUsers } from "@/lib/notify";
import { fullName, mobileNumber, password, uuid } from "@/lib/validation";

const schema = z.object({
  organisationId: uuid,
  fullName,
  mobileNumber,
  password,
  role: z.enum(["FIELD_VOLUNTEER", "GROUP_COORDINATOR"]).default("FIELD_VOLUNTEER"),
});

/** UC-01: self-registration under an Approved organisation. Account starts PendingApproval. */
export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const org = await prisma.organisation.findUnique({ where: { organisationId: body.organisationId } });
  if (!org || org.status !== "Approved") throw new ApiError("BAD_REQUEST", "Choose an approved organisation.");
  if (await prisma.user.findUnique({ where: { mobileNumber: body.mobileNumber }, select: { userId: true } })) {
    throw conflict("An account with this mobile number already exists.");
  }
  const passwordHash = await hashPassword(body.password);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: { organisationId: org.organisationId, fullName: body.fullName, mobileNumber: body.mobileNumber, passwordHash, role: body.role, status: "PendingApproval" },
    });
    await writeAudit(tx, {
      userId: u.userId,
      organisationId: org.organisationId,
      action: "USER_REGISTERED",
      entityType: "USER",
      entityId: u.userId,
      newValue: { role: u.role, status: u.status },
    });
    await notifyUsers(tx, await coordinatorsOrSysAdmins(tx, [org.organisationId]), {
      type: "USER_PENDING",
      message: `A new ${u.role === "GROUP_COORDINATOR" ? "coordinator" : "volunteer"} account for ${org.name} is awaiting approval.`,
      linkPath: "/dashboard/admin?tab=users",
    });
    return u;
  });

  return ok({ userId: user.userId, status: user.status }, { status: 201 });
});
