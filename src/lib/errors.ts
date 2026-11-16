export type ErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "ACCOUNT_LOCKED"
  | "ACCOUNT_PENDING"
  | "ACCOUNT_DEACTIVATED"
  | "DEVICE_REVOKED"
  | "OPERATION_CLOSED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  UNAUTHENTICATED: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ACCOUNT_LOCKED: 403,
  ACCOUNT_PENDING: 403,
  ACCOUNT_DEACTIVATED: 403,
  DEVICE_REVOKED: 403,
  OPERATION_CLOSED: 403,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const badRequest = (m: string, d?: unknown) => new ApiError("BAD_REQUEST", m, d);
export const forbidden = (m = "You do not have permission to perform this action.") => new ApiError("FORBIDDEN", m);
export const notFound = (what: string) => new ApiError("NOT_FOUND", `${what} not found.`);
export const conflict = (m: string, d?: unknown) => new ApiError("CONFLICT", m, d);
