import "server-only";
import { cookies } from "next/headers";
import type { UserRole } from "@prisma/client";
import { prisma } from "../db";
import { SESSION_COOKIE, verifySession } from "./session";

export type PageSession = {
  userId: string;
  fullName: string;
  role: UserRole;
  organisationId: string | null;
  organisationName: string | null;
  mustChangePassword: boolean;
};

/** Server-component session check, re-validated against the database like `authenticate()`. */
export async function getPageSession(): Promise<PageSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySession(token) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({
    where: { userId: claims.sub },
    select: { userId: true, fullName: true, role: true, status: true, organisationId: true, mustChangePassword: true, organisation: { select: { name: true } } },
  });
  if (!user || user.status !== "Active") return null;
  return {
    userId: user.userId,
    fullName: user.fullName,
    role: user.role,
    organisationId: user.organisationId,
    organisationName: user.organisation?.name ?? null,
    mustChangePassword: user.mustChangePassword,
  };
}

export function homeFor(role: UserRole): string {
  return role === "FIELD_VOLUNTEER" ? "/field" : "/dashboard/coverage";
}
