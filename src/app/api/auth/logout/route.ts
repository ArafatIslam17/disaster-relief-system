import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { route } from "@/lib/api";
import { clearSessionCookie, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export const POST = route(async (req) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const claims = token ? await verifySession(token) : null;
  if (claims) {
    const user = await prisma.user.findUnique({ where: { userId: claims.sub }, select: { organisationId: true } });
    if (user) {
      await prisma.auditLog.create({
        data: { userId: claims.sub, organisationId: user.organisationId, deviceId: claims.did, action: "LOGOUT", entityType: "USER", entityId: claims.sub },
      });
    }
  }
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
});
