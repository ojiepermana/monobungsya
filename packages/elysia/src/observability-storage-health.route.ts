import { Elysia, t } from 'elysia';
import { hasAnyRequiredPermission, PERMISSIONS } from '#project/acl';
import { readAndVerifyAuthIdentity } from '#project/contracts';
import { ForbiddenError, UnauthorizedError } from '#project/errors';

const STORAGE_HEALTH_PATH = '/internal/observability/storage-health';
const SAFE_DIAGNOSTIC_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const SAFE_DIAGNOSTIC_KEY = /^[a-z][a-z0-9_]{0,63}$/;

export const OBSERVABILITY_STORAGE_HEALTH_PERMISSIONS = [
  PERMISSIONS.observabilityTraceRead,
  PERMISSIONS.observabilityMetricRead,
  PERMISSIONS.observabilityBenchmarkRead,
  PERMISSIONS.observabilityAlertRead,
] as const;

export interface ObservabilityStorageHealthDiagnostics {
  state: 'available' | 'blind_spot' | 'disabled';
  queueDepth: number;
  queueBytes: number;
  droppedByReason: Readonly<Record<string, number>>;
  blindSpotSince: string | null;
  lastAcknowledgedAt: string | null;
  schemaVersion: number;
  failureCode: string | null;
}

export interface ObservabilityStorageHealthSource {
  diagnostics(): ObservabilityStorageHealthDiagnostics;
}

export interface ObservabilityStorageHealthRouteOptions {
  signalStore?: ObservabilityStorageHealthSource;
  signingSecret: string;
  clockSkewSeconds: number;
  now?: () => Date;
}

export interface ObservabilityStorageHealthResponse {
  state: 'available' | 'blind_spot' | 'disabled';
  blindSpotSince: string | null;
  droppedByReason: Record<string, number>;
  queueDepth: number;
  queueBytes: number;
  lastAcknowledgedAt: string | null;
  schemaVersion: number;
  failureCode: string | null;
  checkedAt: string;
}

const nullableString = t.Union([t.String(), t.Null()]);

const storageHealthResponse = t.Object({
  state: t.Union([
    t.Literal('available'),
    t.Literal('blind_spot'),
    t.Literal('disabled'),
  ]),
  blindSpotSince: nullableString,
  droppedByReason: t.Record(t.String(), t.Integer({ minimum: 0 })),
  queueDepth: t.Integer({ minimum: 0 }),
  queueBytes: t.Integer({ minimum: 0 }),
  lastAcknowledgedAt: nullableString,
  schemaVersion: t.Integer({ minimum: 0 }),
  failureCode: nullableString,
  checkedAt: t.String(),
});

function safeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function safeTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 64) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeFailureCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' && SAFE_DIAGNOSTIC_CODE.test(value)
    ? value
    : 'storage_failure';
}

function safeDropCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([reason, count]) => {
        return (
          SAFE_DIAGNOSTIC_KEY.test(reason) &&
          typeof count === 'number' &&
          Number.isSafeInteger(count) &&
          count >= 0
        );
      })
      .map(([reason, count]) => [reason, count as number]),
  );
}

function disabledDiagnostics(): ObservabilityStorageHealthDiagnostics {
  return {
    state: 'disabled',
    queueDepth: 0,
    queueBytes: 0,
    droppedByReason: {},
    blindSpotSince: null,
    lastAcknowledgedAt: null,
    schemaVersion: 0,
    failureCode: 'signal_store_unconfigured',
  };
}

function authorizeStorageHealthRequest(
  request: Request,
  options: ObservabilityStorageHealthRouteOptions,
): void {
  const identity = readAndVerifyAuthIdentity(
    request.headers,
    request.method,
    new URL(request.url).pathname,
    options.signingSecret,
    Date.now(),
    options.clockSkewSeconds,
  );
  if (!identity) {
    throw new UnauthorizedError('A valid signed identity is required');
  }
  if (
    !hasAnyRequiredPermission(
      identity.permissions,
      OBSERVABILITY_STORAGE_HEALTH_PERMISSIONS,
    )
  ) {
    throw new ForbiddenError(
      'The current identity does not have the required permission',
      'insufficient_permissions',
    );
  }
}

/**
 * Exposes one process's bounded Signal storage diagnostics. The response
 * deliberately omits target metadata and error text so credentials, endpoint
 * details, SQL, and raw exceptions never escape the private health surface.
 */
export function storageHealthResponseFromDiagnostics(
  diagnostics: ObservabilityStorageHealthDiagnostics,
  checkedAt: Date,
): ObservabilityStorageHealthResponse {
  return {
    state:
      diagnostics.state === 'available' ||
      diagnostics.state === 'blind_spot' ||
      diagnostics.state === 'disabled'
        ? diagnostics.state
        : 'disabled',
    blindSpotSince: safeTimestamp(diagnostics.blindSpotSince),
    droppedByReason: safeDropCounts(diagnostics.droppedByReason),
    queueDepth: safeNonNegativeInteger(diagnostics.queueDepth),
    queueBytes: safeNonNegativeInteger(diagnostics.queueBytes),
    lastAcknowledgedAt: safeTimestamp(diagnostics.lastAcknowledgedAt),
    schemaVersion: safeNonNegativeInteger(diagnostics.schemaVersion),
    failureCode: safeFailureCode(diagnostics.failureCode),
    checkedAt: checkedAt.toISOString(),
  };
}

/**
 * A private health route shared by every Bun process that owns a Signal store.
 * It authenticates with the existing signed identity envelope and accepts any
 * observability read permission because it reveals only process-local counters.
 */
export function createObservabilityStorageHealthRoute(
  options: ObservabilityStorageHealthRouteOptions,
) {
  const now = options.now ?? (() => new Date());

  return new Elysia({ name: 'observability-storage-health' }).get(
    STORAGE_HEALTH_PATH,
    () =>
      storageHealthResponseFromDiagnostics(
        options.signalStore?.diagnostics() ?? disabledDiagnostics(),
        now(),
      ),
    {
      beforeHandle: ({ request }) =>
        authorizeStorageHealthRequest(request, options),
      response: { 200: storageHealthResponse },
      detail: {
        hide: true,
        tags: ['Health'],
        summary: 'Read local observability storage health',
      },
    },
  );
}
