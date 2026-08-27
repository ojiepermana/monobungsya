import type { DatabaseClient } from '#project/database';
import { withLogPartitionRecovery } from './partition';
import { sanitizeLogContext } from './sanitize';

export interface ActivityActor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

export type SessionObservationState = 'authenticated' | 'anonymous' | 'invalid';
export type SessionObservationReason =
  | 'missing_cookie'
  | 'unknown_session'
  | 'revoked'
  | 'absolute_expired'
  | 'idle_expired'
  | 'user_missing'
  | 'user_deleted'
  | 'user_blocked'
  | 'user_suspended';

export interface AuthSessionDetail {
  kind: 'auth_session';
  state: SessionObservationState;
  reason: SessionObservationReason | null;
  permissionCount: number;
}

export interface AccessMetadataV1 {
  schemaVersion: 1;
  durationMs: number;
  requiredPermission: string | null;
  correlationSource: 'client_header' | 'request_id';
  client: { route: string; source: 'client_header' } | null;
  details: AuthSessionDetail | null;
}

interface CorrelationInput {
  requestId?: string | null;
  traceId?: string | null;
  runtimeTraceId?: string | null;
  runtimeSpanId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface WriteLogInput extends CorrelationInput {
  level: string;
  message: string;
  channel?: string | null;
  category?: string | null;
  event?: string | null;
  module?: string | null;
  context?: unknown;
  exceptionClass?: string | null;
  exceptionMessage?: string | null;
  stackTrace?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  referenceNo?: string | null;
  branchCode?: string | null;
  sessionId?: string | null;
  actor?: ActivityActor | null;
}

export interface ApplicationLogRecord {
  id: string;
  level: string;
  channel: string;
  category: string;
  event: string | null;
  module: string | null;
  message: string;
  context: unknown;
  exceptionClass: string | null;
  exceptionMessage: string | null;
  stackTrace: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  entityType: string | null;
  entityId: string | null;
  referenceNo: string | null;
  branchCode: string | null;
  requestId: string | null;
  traceId: string | null;
  runtimeTraceId: string | null;
  runtimeSpanId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  occurredAt: string;
  createdAt: string;
}

export interface WriteAuditInput extends CorrelationInput {
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityLabel?: string | null;
  referenceNo?: string | null;
  transactionNo?: string | null;
  fiscalPeriod?: string | null;
  branchCode?: string | null;
  amount?: number | bigint | null;
  currencyCode?: string | null;
  statusBefore?: string | null;
  statusAfter?: string | null;
  reason?: string | null;
  changeSummary?: string | null;
  beforeState?: unknown;
  afterState?: unknown;
  metadata?: unknown;
  actor?: ActivityActor | null;
}

export interface AuditTrailRecord {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  auditedAt: string;
  createdAt: string;
}

export interface WriteAccessInput extends CorrelationInput {
  event: string;
  outcome?: string | null;
  authenticationMethod?: string | null;
  accessChannel?: string | null;
  guard?: string | null;
  branchCode?: string | null;
  forwardedIp?: string | null;
  deviceName?: string | null;
  platform?: string | null;
  browser?: string | null;
  sessionId?: string | null;
  routeName?: string | null;
  path?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  failureReason?: string | null;
  metadata?: unknown;
  actor?: ActivityActor | null;
}

export interface AccessLogRecord {
  id: string;
  event: string;
  outcome: string;
  authenticationMethod: string | null;
  accessChannel: string;
  guard: string | null;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  ipAddress: string | null;
  forwardedIp: string | null;
  userAgent: string | null;
  sessionId: string | null;
  requestId: string | null;
  traceId: string | null;
  runtimeTraceId: string | null;
  runtimeSpanId: string | null;
  routeName: string | null;
  path: string | null;
  method: string | null;
  httpStatus: number | null;
  failureReason: string | null;
  metadata: unknown;
  accessedAt: string;
  createdAt: string;
}

function text(value: string | null | undefined): string | null {
  return value ?? null;
}

/** null and undefined become SQL NULL; everything else is JSON encoded. */
function encodeJson(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

function encodeAmount(
  value: number | bigint | null | undefined,
): string | null {
  return value === null || value === undefined ? null : String(value);
}

/**
 * Shared write path for the log subsystem (spec
 * docs/specs/0011-log-subsystem). Application and access log writes are
 * best effort: they return synchronously and queue the INSERT on one promise
 * chain, so a failed write never fails the calling request. Audit trail
 * writes are awaited and throw, so a failed audit fails the caller visibly.
 *
 * The composition root of each service calls `ActivityLog.configure(database)`
 * when infrastructure is enabled; unconfigured, queued writes are skipped and
 * audit writes throw. Correlation fields (request id, trace id, session id,
 * ip address, user agent) are the caller's responsibility.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: The public static API keeps one process local queue behind the existing writer contract.
export abstract class ActivityLog {
  private static database: DatabaseClient | undefined;
  private static bestEffortEnabled = true;
  private static pending: Promise<void> = Promise.resolve();

  static configure(
    database: DatabaseClient | undefined,
    options: { bestEffort?: boolean } = {},
  ): void {
    ActivityLog.database = database;
    ActivityLog.bestEffortEnabled = options.bestEffort ?? true;
  }

  /** Wait for every queued write to settle. */
  static async flush(timeoutMs?: number): Promise<void> {
    if (!timeoutMs) {
      await ActivityLog.pending;
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        ActivityLog.pending,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            console.error(
              `[activity-log] flush timed out after ${timeoutMs}ms`,
            );
            resolve();
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  static writeLog(input: WriteLogInput): ApplicationLogRecord {
    const now = new Date().toISOString();
    const record: ApplicationLogRecord = {
      id: Bun.randomUUIDv7(),
      level: input.level,
      channel: input.channel ?? 'application',
      category: input.category ?? 'application',
      event: text(input.event),
      module: text(input.module),
      message: input.message,
      context: sanitizeLogContext(input.context),
      exceptionClass: text(input.exceptionClass),
      exceptionMessage: text(input.exceptionMessage),
      stackTrace: text(input.stackTrace),
      actorUserId: text(input.actor?.id),
      actorName: text(input.actor?.name),
      actorEmail: text(input.actor?.email),
      entityType: text(input.entityType),
      entityId: text(input.entityId),
      referenceNo: text(input.referenceNo),
      branchCode: text(input.branchCode),
      requestId: text(input.requestId),
      traceId: text(input.traceId),
      runtimeTraceId: text(input.runtimeTraceId),
      runtimeSpanId: text(input.runtimeSpanId),
      sessionId: text(input.sessionId),
      ipAddress: text(input.ipAddress),
      userAgent: text(input.userAgent),
      occurredAt: now,
      createdAt: now,
    };

    if (!ActivityLog.bestEffortEnabled) return record;

    ActivityLog.enqueue(async (database) => {
      await withLogPartitionRecovery(
        database,
        'logging',
        record.occurredAt,
        () => database`
          INSERT INTO "logs"."logging" (
            id, level, channel, category, event, module, message, context,
            exception_class, exception_message, stack_trace,
            actor_user_id, actor_name, actor_email,
            entity_type, entity_id, reference_no, branch_code,
            request_id, trace_id, runtime_trace_id, runtime_span_id,
            session_id, ip_address, user_agent,
            occurred_at, created_at
          ) VALUES (
            ${record.id}, ${record.level}, ${record.channel},
            ${record.category}, ${record.event}, ${record.module},
            ${record.message}, ${encodeJson(record.context)},
            ${record.exceptionClass}, ${record.exceptionMessage},
            ${record.stackTrace}, ${record.actorUserId}, ${record.actorName},
            ${record.actorEmail}, ${record.entityType}, ${record.entityId},
            ${record.referenceNo}, ${record.branchCode}, ${record.requestId},
            ${record.traceId}, ${record.runtimeTraceId},
            ${record.runtimeSpanId}, ${record.sessionId}, ${record.ipAddress},
            ${record.userAgent}, ${record.occurredAt}, ${record.createdAt}
          )
        `,
      );
    });

    return record;
  }

  static writeAccess(input: WriteAccessInput): AccessLogRecord {
    const now = new Date().toISOString();
    const record: AccessLogRecord = {
      id: Bun.randomUUIDv7(),
      event: input.event,
      outcome: input.outcome ?? 'success',
      authenticationMethod: text(input.authenticationMethod),
      accessChannel: input.accessChannel ?? 'web',
      guard: text(input.guard),
      actorUserId: text(input.actor?.id),
      actorName: text(input.actor?.name),
      actorEmail: text(input.actor?.email),
      ipAddress: text(input.ipAddress),
      forwardedIp: text(input.forwardedIp),
      userAgent: text(input.userAgent),
      sessionId: text(input.sessionId),
      requestId: text(input.requestId),
      traceId: text(input.traceId),
      runtimeTraceId: text(input.runtimeTraceId),
      runtimeSpanId: text(input.runtimeSpanId),
      routeName: text(input.routeName),
      path: text(input.path),
      method: text(input.method),
      httpStatus: input.httpStatus ?? null,
      failureReason: text(input.failureReason),
      metadata: sanitizeLogContext(input.metadata),
      accessedAt: now,
      createdAt: now,
    };

    if (!ActivityLog.bestEffortEnabled) return record;

    ActivityLog.enqueue(async (database) => {
      await withLogPartitionRecovery(
        database,
        'access_logs',
        record.accessedAt,
        () => database`
          INSERT INTO "logs"."access_logs" (
            id, event, outcome, authentication_method, access_channel, guard,
            actor_user_id, actor_name, actor_email, branch_code,
            ip_address, forwarded_ip, user_agent,
            device_name, platform, browser,
            session_id, request_id, trace_id, runtime_trace_id, runtime_span_id,
            route_name, path, method, http_status, failure_reason, metadata,
            accessed_at, created_at
          ) VALUES (
            ${record.id}, ${record.event}, ${record.outcome},
            ${record.authenticationMethod},
            ${record.accessChannel}, ${record.guard},
            ${record.actorUserId}, ${record.actorName},
            ${record.actorEmail}, ${text(input.branchCode)},
            ${record.ipAddress}, ${record.forwardedIp},
            ${record.userAgent}, ${text(input.deviceName)},
            ${text(input.platform)}, ${text(input.browser)},
            ${record.sessionId}, ${record.requestId},
            ${record.traceId}, ${record.runtimeTraceId},
            ${record.runtimeSpanId}, ${record.routeName},
            ${record.path}, ${record.method},
            ${record.httpStatus}, ${record.failureReason},
            ${encodeJson(record.metadata)},
            ${record.accessedAt}, ${record.createdAt}
          )
        `,
      );
    });

    return record;
  }

  static async writeAudit(input: WriteAuditInput): Promise<AuditTrailRecord> {
    const database = ActivityLog.database;

    if (!database) {
      throw new Error(
        'ActivityLog is not configured with a database; audit writes cannot proceed',
      );
    }

    const now = new Date().toISOString();
    const record: AuditTrailRecord = {
      id: Bun.randomUUIDv7(),
      action: input.action,
      module: input.module,
      entityType: input.entityType,
      entityId: input.entityId,
      entityLabel: text(input.entityLabel),
      auditedAt: now,
      createdAt: now,
    };

    await withLogPartitionRecovery(
      database,
      'audit_trails',
      record.auditedAt,
      () => database`
        INSERT INTO "logs"."audit_trails" (
          id, action, module, entity_type, entity_id, entity_label,
          reference_no, transaction_no, fiscal_period, branch_code,
          amount, currency_code, status_before, status_after,
          actor_user_id, actor_name, actor_email, actor_role,
          reason, change_summary, before_state, after_state, metadata,
          request_id, trace_id, runtime_trace_id, runtime_span_id,
          ip_address, user_agent,
          audited_at, created_at
        ) VALUES (
          ${record.id}, ${record.action}, ${record.module},
          ${record.entityType}, ${record.entityId}, ${record.entityLabel},
          ${text(input.referenceNo)}, ${text(input.transactionNo)},
          ${text(input.fiscalPeriod)}, ${text(input.branchCode)},
          ${encodeAmount(input.amount)}, ${input.currencyCode ?? 'IDR'},
          ${text(input.statusBefore)}, ${text(input.statusAfter)},
          ${text(input.actor?.id)}, ${text(input.actor?.name)},
          ${text(input.actor?.email)}, ${null},
          ${text(input.reason)}, ${text(input.changeSummary)},
          ${encodeJson(input.beforeState)}, ${encodeJson(input.afterState)},
          ${encodeJson(input.metadata)},
          ${text(input.requestId)}, ${text(input.traceId)},
          ${text(input.runtimeTraceId)}, ${text(input.runtimeSpanId)},
          ${text(input.ipAddress)}, ${text(input.userAgent)},
          ${record.auditedAt}, ${record.createdAt}
        )
      `,
    );

    return record;
  }

  private static enqueue(
    run: (database: DatabaseClient) => Promise<void>,
  ): void {
    ActivityLog.pending = ActivityLog.pending
      .then(() => {
        const database = ActivityLog.database;
        return database ? run(database) : undefined;
      })
      .then(
        () => undefined,
        (error) => {
          console.error('[activity-log] write failed:', error);
        },
      );
  }
}
