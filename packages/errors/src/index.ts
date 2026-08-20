export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_SERVER_ERROR";

export interface ErrorResponse {
  error: {
    code: AppErrorCode;
    message: string;
    requestId?: string;
  };
}

export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = code;
  }
}

export class ValidationError extends AppError {
  constructor(message = "Request validation failed", details?: unknown) {
    super("VALIDATION_ERROR", 422, message, details);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super("NOT_FOUND", 404, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication is required") {
    super("UNAUTHORIZED", 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to perform this action") {
    super("FORBIDDEN", 403, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "The request conflicts with current state") {
    super("CONFLICT", 409, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many requests") {
    super("RATE_LIMITED", 429, message);
  }
}

export class InternalServerError extends AppError {
  constructor(message = "An unexpected error occurred") {
    super("INTERNAL_SERVER_ERROR", 500, message);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "An internal service is unavailable") {
    super("SERVICE_UNAVAILABLE", 503, message);
  }
}

export function toErrorResponse(
  error: unknown,
  requestId?: string,
): {
  status: number;
  body: ErrorResponse;
} {
  const appError =
    error instanceof AppError ? error : new InternalServerError();

  return {
    status: appError.status,
    body: {
      error: {
        code: appError.code,
        message: appError.message,
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
