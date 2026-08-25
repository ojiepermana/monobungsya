export {
  type AccessLogRecord,
  type AccessMetadataV1,
  type ActivityActor,
  ActivityLog,
  type ApplicationLogRecord,
  type AuditTrailRecord,
  type AuthSessionDetail,
  type SessionObservationReason,
  type SessionObservationState,
  type WriteAccessInput,
  type WriteAuditInput,
  type WriteLogInput,
} from './activity-log';
export { isoFromDbTimestamp } from './db-timestamp';
export {
  ensureLogPartition,
  isMissingLogPartitionError,
  jakartaYear,
  jakartaYearBoundaryUtc,
  LOG_TABLES,
  type LogTable,
  logPartitionName,
  withLogPartitionRecovery,
} from './partition';
export { sanitizeLogContext } from './sanitize';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogContext = Record<string, unknown>;

import { ActivityLog } from './activity-log';
import { sanitizeLogContext } from './sanitize';

const SENSITIVE_QUERY_KEYS = new Set(['token', 'session', 'code', 'secret']);

export function redactRequestUrl(value: string): string {
  try {
    const url = new URL(value);

    for (const key of SENSITIVE_QUERY_KEYS) {
      if (url.searchParams.has(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }

    return url.toString();
  } catch {
    return '[REDACTED_URL]';
  }
}

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  constructor(
    private readonly serviceName: string,
    private readonly minimumLevel: LogLevel = 'info',
    private readonly options: { persist?: boolean } = {},
  ) {}

  debug(message: string, context: LogContext = {}): void {
    this.write('debug', message, context);
  }

  info(message: string, context: LogContext = {}): void {
    this.write('info', message, context);
  }

  warn(message: string, context: LogContext = {}): void {
    this.write('warn', message, context);
  }

  error(message: string, context: LogContext = {}): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context: LogContext): void {
    if (levelRank[level] < levelRank[this.minimumLevel]) {
      return;
    }

    const { error, exception, ...contextWithoutExceptions } = context;
    const contextForOutput = {
      ...contextWithoutExceptions,
      ...(error instanceof Error || error === undefined ? {} : { error }),
      ...(exception instanceof Error || exception === undefined
        ? {}
        : { exception }),
    };
    const caughtException =
      exception instanceof Error
        ? exception
        : error instanceof Error
          ? error
          : undefined;
    const sanitizedContext = sanitizeLogContext(contextForOutput) as LogContext;
    if (isSafeErrorEnvelope(error)) {
      sanitizedContext.error = error;
    }
    const errorDetails: {
      exceptionClass?: string;
      exceptionMessage?: string;
      stackTrace?: string | null;
    } = caughtException
      ? {
          exceptionClass: caughtException.constructor.name,
          exceptionMessage: caughtException.message,
          stackTrace: caughtException.stack ?? null,
        }
      : {};

    console.log(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service: this.serviceName,
        event: message,
        message,
        ...sanitizedContext,
        ...errorDetails,
      }),
    );

    if (this.options.persist) {
      ActivityLog.writeLog({
        level: level === 'warn' ? 'warning' : level,
        message,
        event: message,
        module: this.serviceName,
        context: sanitizedContext,
        exceptionClass: errorDetails.exceptionClass,
        exceptionMessage: errorDetails.exceptionMessage,
        stackTrace: errorDetails.stackTrace,
        requestId: stringValue(context.requestId),
        traceId: stringValue(context.traceId ?? context.correlationId),
        runtimeTraceId: stringValue(context.runtimeTraceId),
        runtimeSpanId: stringValue(context.runtimeSpanId),
        sessionId: stringValue(context.sessionId),
        ipAddress: stringValue(context.ipAddress),
        userAgent: stringValue(context.userAgent),
      });
    }
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isSafeErrorEnvelope(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const error = (value as Record<string, unknown>).error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) return false;
  const body = error as Record<string, unknown>;
  return typeof body.code === 'string' && typeof body.message === 'string';
}
