"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { UserRole } from "@prisma/client";
import { dashTranslator, type DashKey, type Locale } from "@/lib/i18n/dictionary";
import type { Permission } from "@/lib/auth/rbac";

export type DashOperation = { operationId: string; name: string; status: "Active" | "Closed" };
export type DashUser = { userId: string; fullName: string; role: UserRole; organisationId: string | null; organisationName: string | null };

type Ctx = {
  user: DashUser;
  locale: Locale;
  t: (key: DashKey, vars?: Record<string, string | number>) => string;
  can: (p: Permission) => boolean;
  operations: DashOperation[];
  operation: DashOperation | null;
  setOperationId: (id: string) => void;
};

const DashCtx = createContext<Ctx | null>(null);

export const OPERATION_COOKIE = "dash_op";

export function useDash() {
  const v = useContext(DashCtx);
  if (!v) throw new Error("useDash must be used inside <DashProvider>");
  return v;
}

export function DashProvider({
  user,
  locale,
  permissions,
  operations,
  initialOperationId,
  children,
}: {
  user: DashUser;
  locale: Locale;
  permissions: Permission[];
  operations: DashOperation[];
  initialOperationId: string | null;
  children: ReactNode;
}) {
  const [operationId, setOpState] = useState(initialOperationId);
  const setOperationId = useCallback((id: string) => {
    document.cookie = `${OPERATION_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    setOpState(id);
  }, []);
  const value = useMemo<Ctx>(() => {
    const perms = new Set(permissions);
    return {
      user,
      locale,
      t: dashTranslator(locale),
      can: (p) => perms.has(p),
      operations,
      operation: operations.find((o) => o.operationId === operationId) ?? null,
      setOperationId,
    };
  }, [user, locale, permissions, operations, operationId, setOperationId]);
  return <DashCtx.Provider value={value}>{children}</DashCtx.Provider>;
}
