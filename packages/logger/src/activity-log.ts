import type { DatabaseClient } from '#project/database';
import {
  type AccessLogSignal,
  type ApplicationLogSignal,
  OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
  type ObservabilitySignalStore,
} from '#project/observability';
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
  branchCode: string | null;
  ipAddress: string | null;
  forwardedIp: string | null;
  userAgent: string | null;
  deviceName: string | null;
  platform: string | null;
  browser: string | null;
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
  private static signalStore: ObservabilitySignalStore | undefined;
  private static bestEffortEnabled = true;

  static configure(
    database: DatabaseClient | undefined,
    options: {
      bestEffort?: boolean;
      signalStore?: ObservabilitySignalStore;
    } = {},
  ): void {
    ActivityLog.database = database;
    ActivityLog.bestEffortEnabled = options.bestEffort ?? true;
    ActivityLog.signalStore = options.signalStore;
  }

  /** Wait for every queued write to settle. */
  static async flush(timeoutMs?: number): Promise<void> {
    await ActivityLog.signalStore?.flush(timeoutMs);
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
    ActivityLog.appendApplicationLog(record);

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
      branchCode: text(input.branchCode),
      ipAddress: text(input.ipAddress),
      forwardedIp: text(input.forwardedIp),
      userAgent: text(input.userAgent),
      deviceName: text(input.deviceName),
      platform: text(input.platform),
      browser: text(input.browser),
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
    ActivityLog.appendAccessLog(record);

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

  private static appendApplicationLog(record: ApplicationLogRecord): void {
    try {
      ActivityLog.signalStore?.append({
        kind: 'application_log',
        ...record,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      } satisfies ApplicationLogSignal);
    } catch {
      console.error('[observability] application log enqueue failed');
    }
  }

  private static appendAccessLog(record: AccessLogRecord): void {
    try {
      ActivityLog.signalStore?.append({
        kind: 'access_log',
        ...record,
        schemaVersion: OBSERVABILITY_SIGNAL_SCHEMA_VERSION,
      } satisfies AccessLogSignal);
    } catch {
      console.error('[observability] access log enqueue failed');
    }
  }
}
