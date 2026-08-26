import { isoFromDbTimestamp } from '#project/logger';
import type { AccessLogItem, ApplicationLogItem } from './logs.types';

export function parseLogJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

export function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

const SESSION_REASONS = new Set([
  'missing_cookie',
  'unknown_session',
  'revoked',
  'absolute_expired',
  'idle_expired',
  'user_missing',
  'user_deleted',
  'user_blocked',
  'user_suspended',
]);

function accessMetadataProjection(
  value: unknown,
  traceId: string | null,
  requestId: string | null,
): {
  traceSource: 'client_header' | 'request_id' | null;
  clientRoute: string | null;
  sessionSummary: AccessLogItem['sessionSummary'];
} {
  const metadata = parseLogJson(value);
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return {
      traceSource: traceId && traceId === requestId ? 'request_id' : null,
      clientRoute: null,
      sessionSummary: null,
    };
  }

  const record = metadata as Record<string, unknown>;
  const traceSource =
    record.schemaVersion === 1 &&
    (record.correlationSource === 'client_header' ||
      record.correlationSource === 'request_id')
      ? record.correlationSource
      : traceId && traceId === requestId
        ? 'request_id'
        : null;
  const client = record.client;
  const clientRoute =
    record.schemaVersion === 1 &&
    client &&
    typeof client === 'object' &&
    !Array.isArray(client) &&
    (client as Record<string, unknown>).source === 'client_header' &&
    typeof (client as Record<string, unknown>).route === 'string'
      ? String((client as Record<string, unknown>).route)
      : null;

  const details = record.details;
  if (
    record.schemaVersion !== 1 ||
    !details ||
    typeof details !== 'object' ||
    Array.isArray(details)
  ) {
    return { traceSource, clientRoute, sessionSummary: null };
  }

  const detail = details as Record<string, unknown>;
  const reason = detail.reason;
  const permissionCount = detail.permissionCount;
  if (
    detail.kind !== 'auth_session' ||
    !['authenticated', 'anonymous', 'invalid'].includes(String(detail.state)) ||
    (reason !== null && !SESSION_REASONS.has(String(reason))) ||
    typeof permissionCount !== 'number' ||
    !Number.isInteger(permissionCount) ||
    permissionCount < 0
  ) {
    return { traceSource, clientRoute, sessionSummary: null };
  }

  return {
    traceSource,
    clientRoute,
    sessionSummary: {
      state: detail.state as 'authenticated' | 'anonymous' | 'invalid',
      reason: reason as AccessLogItem['sessionSummary'] extends infer T
        ? T extends { reason: infer R }
          ? R
          : never
        : never,
      permissionCount,
    },
  };
}

export function mapAccessLogRow(row: Record<string, unknown>): AccessLogItem {
  const requestId = textOrNull(row.request_id);
  const traceId = textOrNull(row.trace_id);
  const projection = accessMetadataProjection(row.metadata, traceId, requestId);
  return {
    event: String(row.event),
    outcome: String(row.outcome),
    routeName: textOrNull(row.route_name),
    path: textOrNull(row.path),
    method: textOrNull(row.method),
    httpStatus:
      row.http_status === null || row.http_status === undefined
        ? null
        : Number(row.http_status),
    requestId,
    traceId,
    traceSource: projection.traceSource,
    clientRoute: projection.clientRoute,
    sessionId: textOrNull(row.session_id),
    sessionSummary: projection.sessionSummary,
    actorEmail: textOrNull(row.actor_email),
    failureReason: textOrNull(row.failure_reason),
    accessedAt: isoFromDbTimestamp(String(row.accessed_at)),
  };
}

export function mapApplicationLogRow(
  row: Record<string, unknown>,
): ApplicationLogItem {
  return {
    id: String(row.id),
    level: String(row.level),
    channel: textOrNull(row.channel) ?? 'application',
    category: String(row.category),
    event: textOrNull(row.event),
    module: textOrNull(row.module),
    message: String(row.message),
    context: parseLogJson(row.context),
    exceptionClass: textOrNull(row.exception_class),
    exceptionMessage: textOrNull(row.exception_message),
    stackTrace: textOrNull(row.stack_trace),
    actorUserId: textOrNull(row.actor_user_id),
    actorName: textOrNull(row.actor_name),
    actorEmail: textOrNull(row.actor_email),
    occurredAt: isoFromDbTimestamp(String(row.occurred_at)),
    createdAt: isoFromDbTimestamp(String(row.created_at)),
  };
}
