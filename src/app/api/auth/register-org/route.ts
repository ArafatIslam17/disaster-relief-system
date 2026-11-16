import { z } from "zod";
import { prisma } from "@/lib/db";
import { ok, parseJson, route } from "@/lib/api";
import { conflict } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { writeAudit } from "@/lib/audit";
import { activeRoleIds, notifyUsers } from "@/lib/notify";
import { fullName, mobileNumber, password } from "@/lib/validation";

const schema = z.object({
  organisation: z.object({
    name: z.string().trim().min(3).max(120),
    orgType: z.string().trim().min(2).max(60),
  }),
  coordinator: z.object({ fullName, mobileNumber, password }),
});

/** UC-03: registers an organisation (Pending) with its initial Group Coordinator (PendingApproval). */
export const POST = route(async (req) => {
  const body = await parseJson(req, schema);
  const name = body.organisation.name.replace(/\s+/g, " ");
  if (await prisma.organisation.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { organisationId: true } })) {
    throw conflict("An organisation with this name is already registered.");
  }
  if (await prisma.user.findUnique({ where: { mobileNumber: body.coordinator.mobileNumber }, select: { userId: true } })) {
    throw conflict("An account with this mobile number already exists.");
  }
  const passwordHash = await hashPassword(body.coordinator.password);

  const result = await prisma.$transaction(async (tx) => {
    const org = await tx.organisation.create({ data: { name, orgType: body.organisation.orgType, status: "Pending" } });
    const user = await tx.user.create({
      data: {
        organisationId: org.organisationId,
        fullName: body.coordinator.fullName,
        mobileNumber: body.coordinator.mobileNumber,
        passwordHash,
        role: "GROUP_COORDINATOR",
        status: "PendingApproval",
      },
    });
    await writeAudit(tx, { userId: user.userId, organisationId: org.organisationId, action: "ORGANISATION_REGISTERED", entityType: "ORGANISATION", entityId: org.organisationId, newValue: { name, orgType: org.orgType, status: "Pending" } });
    await writeAudit(tx, { userId: user.userId, organisationId: org.organisationId, action: "USER_REGISTERED", entityType: "USER", entityId: user.userId, newValue: { role: "GROUP_COORDINATOR", status: "PendingApproval" } });
    await notifyUsers(tx, await activeRoleIds(tx, "SYSTEM_ADMINISTRATOR"), {
      type: "ORGANISATION_PENDING",
      message: `New organisation registration: ${name}.`,
      linkPath: "/admin/organisations",
    });
    return { organisationId: org.organisationId, userId: user.userId };
  });

  return ok({ ...result, organisationStatus: "Pending", userStatus: "PendingApproval" }, { status: 201 });
});
