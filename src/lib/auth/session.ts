import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import type { UserRole } from "@prisma/client";
import { env } from "../env";

export const SESSION_COOKIE = "relief_session";

export type SessionClaims = {
  sub: string; // user_id
  role: UserRole;
  org: string | null;
  did: string | null; // device_id bound at login
  mcp: boolean; // must change password
};

function key() {
  return new TextEncoder().encode(env().AUTH_JWT_SECRET);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, org: claims.org, did: claims.did, mcp: claims.mcp })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(`${env().AUTH_SESSION_TTL_HOURS}h`)
    .sign(key());
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      org: (payload.org as string | null) ?? null,
      did: (payload.did as string | null) ?? null,
      mcp: payload.mcp === true,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(res: NextResponse, claims: SessionClaims) {
  res.cookies.set(SESSION_COOKIE, await signSession(claims), {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env().AUTH_SESSION_TTL_HOURS * 3600,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}
