import type { DatabaseClient } from '#project/database';
import { withLogPartitionRecovery } from './partition';

export interface ActivityActor {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

interface CorrelationInput {
  requestId?: string | null;
  traceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
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
 * Shared write path for the Audit Trail (spec docs/specs/0011-log-subsystem).
 * Audit Trail writes are awaited and throw, so a failed audit fails the caller
 * visibly.
 *
 * The composition root of each service calls `ActivityLog.configure(database)`
 * when infrastructure is enabled; unconfigured audit writes throw.
 * Correlation fields are the caller's responsibility.
 */
// biome-ignore lint/complexity/noStaticOnlyClass: The public static API keeps one process local queue behind the existing writer contract.
export abstract class ActivityLog {
  private static database: DatabaseClient | undefined;

  static configure(database: DatabaseClient | undefined): void {
    ActivityLog.database = database;
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
          request_id, trace_id, ip_address, user_agent,
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
          ${text(input.ipAddress)}, ${text(input.userAgent)},
          ${record.auditedAt}, ${record.createdAt}
        )
      `,
    );

    return record;
  }
}
