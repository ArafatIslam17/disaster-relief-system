import "server-only";
import type { Operation } from "@prisma/client";
import { prisma } from "./db";
import type { Tx } from "./audit";
import { ApiError, notFound } from "./errors";

export async function getOperation(operationId: string, db: Tx | typeof prisma = prisma): Promise<Operation> {
  const op = await db.operation.findUnique({ where: { operationId } });
  if (!op) throw notFound("Operation");
  return op;
}

export function assertOperationActive(op: Operation) {
  if (op.status === "Closed") throw new ApiError("OPERATION_CLOSED", "This operation is closed; no further changes are accepted.");
}

/** Resolves an explicit operation id or falls back to the most recently started Active operation. */
export async function resolveOperation(operationId?: string | null): Promise<Operation> {
  if (operationId) return getOperation(operationId);
  const op = await prisma.operation.findFirst({ where: { status: "Active" }, orderBy: { startDate: "desc" } });
  if (!op) throw notFound("Active operation");
  return op;
}

/** Field roles must belong to an organisation with an Approved membership in the operation. */
export async function assertApprovedMembership(operationId: string, organisationId: string | null, db: Tx | typeof prisma = prisma) {
  if (!organisationId) throw new ApiError("FORBIDDEN", "Your account is not attached to an organisation.");
  const m = await db.operationMembership.findUnique({
    where: { operationId_organisationId: { operationId, organisationId } },
    select: { status: true },
  });
  if (m?.status !== "Approved") {
    throw new ApiError("FORBIDDEN", "Your organisation is not an approved member of this operation.");
  }
}
