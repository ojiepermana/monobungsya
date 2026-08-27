import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { defer, type Observable } from 'rxjs';
import * as sdk from '#project/angular-sdk';
import { sdkRequest } from '../../api/generated-client';
import type { AuthPermission } from '../auth/auth.service';

export interface HealthResponse {
  status: string;
}

/** Derived from the three status timestamps by the user service. */
export type UserStatus = 'active' | 'suspended' | 'blocked' | 'deleted';

/** The empty value is the default list view, which hides deleted users. */
export type UserStatusFilter = '' | UserStatus | 'all';

/** The six status actions, each one needing a reason. */
export type UserStatusAction =
  | 'suspend'
  | 'unsuspend'
  | 'block'
  | 'unblock'
  | 'delete'
  | 'restore';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  suspendedAt: string | null;
  blockedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface UsersFilters {
  search: string;
  status: UserStatusFilter;
  page: number;
  pageSize?: number;
}

export interface UsersResponse {
  data: UserRecord[];
  meta: LogsMeta;
  filters: Omit<UsersFilters, 'page' | 'pageSize'>;
  options: { statuses: UserStatus[] };
}

export interface CreateUserPayload {
  /** A UUIDv7 the client generates, so the caller knows the id up front. */
  id: string;
  name: string;
  email: string;
}

export interface UpdateUserPayload {
  name?: string;
}

export interface LogsMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface AuditTrailFilters {
  search: string;
  module: string;
  action: string;
  page: number;
  pageSize?: number;
}

/** Narrows a log list to one actor, for the user detail page tabs. */
export interface ActorScope {
  actorUserId?: string;
}

export interface AuditTrailItem {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityLabel: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  changeSummary: string | null;
  auditedAt: string;
}

export interface AuditTrailsResponse {
  data: AuditTrailItem[];
  meta: LogsMeta;
  filters: Omit<AuditTrailFilters, 'page' | 'pageSize'>;
  options: {
    modules: string[];
    actions: string[];
  };
}

export interface AccessLogFilters {
  search: string;
  event: string;
  outcome: string;
  traceId: string;
  page: number;
  pageSize?: number;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface SessionSummary {
  state: 'authenticated' | 'anonymous' | 'invalid';
  reason: string | null;
  permissionCount: number;
}

export interface PermissionRecord {
  id: string;
  name: AuthPermission;
  code: string;
  namespace: string;
  resource: string;
  action: string;
  scope: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionsResponse {
  data: PermissionRecord[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { search: string; namespace: string };
}

export interface PermissionGrant {
  id: string;
  permissionId: string;
  userId: string;
  permission: PermissionRecord;
  createdAt: string;
}

export type PermissionGrantResponse = PermissionGrant[];

export interface PermissionMutationResponse {
  granted: string[];
  skipped: string[];
}

export type GroupStatus = 'active' | 'off';
export type GroupDeletedFilter = 'exclude' | 'include' | 'only';

export interface PermissionGroupRecord {
  id: string;
  name: string;
  status: GroupStatus;
  description: string | null;
  permissionCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PermissionGroupsResponse {
  data: PermissionGroupRecord[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: {
    search: string;
    status: string;
    deleted: GroupDeletedFilter;
    appliable: boolean;
  };
}

export interface GroupApplyResult {
  granted: string[];
  skipped: string[];
}

export interface GroupBulkApplyResult {
  applied: Array<GroupApplyResult & { userId: string }>;
  failed: Array<{ userId: string; reason: string }>;
}

export interface AccessLogItem {
  event: string;
  outcome: string;
  routeName: string | null;
  path: string | null;
  method: string | null;
  httpStatus: number | null;
  requestId: string | null;
  traceId: string | null;
  traceSource: 'client_header' | 'request_id' | null;
  clientRoute: string | null;
  sessionId: string | null;
  sessionSummary: SessionSummary | null;
  actorEmail: string | null;
  failureReason: string | null;
  accessedAt: string;
}

export interface PostgresAccessLogsResponse {
  data: AccessLogItem[];
  meta: LogsMeta;
  filters: Omit<
    AccessLogFilters,
    'page' | 'pageSize' | 'from' | 'to' | 'cursor'
  >;
  options: {
    events: string[];
    outcomes: string[];
  };
}

export interface SignalAccessLogsResponse {
  data: AccessLogItem[];
  prevCursor: string | null;
  nextCursor: string | null;
  filters: Omit<AccessLogFilters, 'page' | 'from' | 'to' | 'cursor'>;
  options: {
    events: string[];
    outcomes: string[];
  };
  storageStatus: 'available' | 'blind_spot';
  blindSpotSince: string | null;
}

export type AccessLogsResponse =
  | PostgresAccessLogsResponse
  | SignalAccessLogsResponse;

export interface ApplicationLogFilters {
  search: string;
  level: string;
  module: string;
  event: string;
  page: number;
  pageSize?: number;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface ApplicationLogItem {
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
  occurredAt: string;
  createdAt: string;
}

export interface PostgresApplicationLogsResponse {
  data: ApplicationLogItem[];
  meta: LogsMeta;
  filters: Omit<
    ApplicationLogFilters,
    'page' | 'pageSize' | 'from' | 'to' | 'cursor'
  >;
  options: {
    levels: string[];
    modules: string[];
    events: string[];
  };
}

export interface SignalApplicationLogsResponse {
  data: ApplicationLogItem[];
  prevCursor: string | null;
  nextCursor: string | null;
  filters: Omit<ApplicationLogFilters, 'page' | 'from' | 'to' | 'cursor'>;
  options: {
    levels: string[];
    modules: string[];
    events: string[];
  };
  storageStatus: 'available' | 'blind_spot';
  blindSpotSince: string | null;
}

export type ApplicationLogsResponse =
  | PostgresApplicationLogsResponse
  | SignalApplicationLogsResponse;

export type NotificationCategory =
  | 'security'
  | 'access'
  | 'account'
  | 'operational';
export type NotificationChannel = 'in_app' | 'email';
export interface NotificationRecord {
  id: string;
  category: NotificationCategory;
  severity: string;
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  actionRoute: string | null;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationsResponse {
  data: NotificationRecord[];
  meta: LogsMeta;
  filters: { page: number; category: string; unreadOnly: boolean };
  options: { categories: NotificationCategory[] };
}
export interface UnreadCountResponse {
  total: number;
  categories: Record<NotificationCategory, number>;
}
export interface NotificationPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  mandatory: boolean;
}
export interface NotificationPreferencesResponse {
  categories: Array<{
    category: NotificationCategory;
    channels: NotificationPreference[];
  }>;
}
export type JobStatus =
  | 'queued'
  | 'running'
  | 'retry_wait'
  | 'completed'
  | 'failed';
export interface JobRecord {
  id: string;
  type: string;
  version: number;
  sourceService: string;
  targetService: string;
  status: JobStatus;
  priority: number;
  runAt: string;
  attemptCount: number;
  maxAttempts: number;
  lockedBy: string | null;
  lockedAt: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  scheduleCode: string | null;
  retryOfJobId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface JobsResponse {
  data: JobRecord[];
  meta: LogsMeta;
  filters: {
    page: number;
    pageSize?: number;
    status: string;
    type: string;
    sourceService: string;
    targetService: string;
    from: string;
    to: string;
  };
  options: {
    statuses: JobStatus[];
    types: string[];
    sourceServices: string[];
    targetServices: string[];
  };
}
export interface JobDetail extends JobRecord {
  payload: Record<string, unknown>;
  attempts: Array<{
    id: string;
    attemptNumber: number;
    workerId: string;
    startedAt: string;
    finishedAt: string | null;
    outcome: string | null;
    durationMs: number | null;
    errorCode: string | null;
    errorMessage: string | null;
  }>;
}

export interface RuntimeTraceSummary {
  traceId: string;
  serviceName: string;
  resourceName: string;
  status: 'ok' | 'error' | 'unset';
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  spanCount: number | string;
  samplingReason: string;
  complete: boolean;
  correlationId: string | null;
  requestId: string | null;
  runId: string | null;
}

export interface RuntimeTraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  serviceName: string;
  serviceInstanceId: string;
  resourceKind: string;
  resourceName: string;
  operation: string;
  status: 'ok' | 'error' | 'unset';
  samplingReason: string;
  attributes: unknown;
  errorType: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  orphan: boolean;
}

export interface RuntimeTracesResponse {
  data: RuntimeTraceSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    services: string[];
    resourceKinds: string[];
    resourceNames: string[];
  };
  completeness: 'complete' | 'partial';
  storageStatus: 'available' | 'blind_spot';
}

export interface RuntimeTraceDetail {
  traceId: string;
  spans: RuntimeTraceSpan[];
  orphanRoots: string[];
  completeness: 'complete' | 'partial';
  samplingReasons: string[];
  storageStatus: 'available' | 'blind_spot';
}

export interface RuntimeMetricsResponse {
  data: Array<{
    bucketStart: string;
    value: number;
    count: number | string;
    serviceName: string;
    resourceKind: string;
    resourceName: string;
    metricName: string;
    unit: string;
    labels: unknown;
  }>;
  statistic: 'count' | 'sum' | 'min' | 'max';
  stepSeconds: number | string;
  coverage: {
    expectedBuckets: number | string;
    storedBuckets: number | string;
    missingBuckets: number | string;
    storageStatus: 'available' | 'blind_spot';
  };
  options: {
    metrics: string[];
    services: string[];
    resourceKinds: string[];
  };
}

export type RuntimeMetricGroup =
  | 'service'
  | 'resourceKind'
  | 'resourceName'
  | 'status';

export interface BenchmarkRunSummary {
  runId: string;
  scenarioId: string;
  scenarioVersion: string;
  status: string;
  sourceCommitSha: string;
  fixtureVersion: string;
  environment: string;
  bunVersion: string;
  completeness: string;
  startedAt: string;
  finishedAt: string | null;
  createdAt: string;
  comparisonStatus: string | null;
}

export interface BenchmarkRunDetail extends BenchmarkRunSummary {
  sourceBranch: string | null;
  sourceChecksum: string;
  runnerProfile: unknown;
  instrumentationSchemaVersion: string;
  thresholdPolicyVersion: string;
  artifactUri: string | null;
  traceUri: string | null;
  artifactChecksum: string | null;
  comparisons: Array<{
    comparisonId: string;
    resourceKind: string;
    resourceName: string;
    metricKey: string;
    statistic: string;
    unit: string;
    baselineValue: number | null;
    candidateValue: number;
    absoluteDelta: number | null;
    relativeDeltaPercent: number | null;
    absoluteThreshold: number | null;
    relativeThreshold: number | null;
    decision: 'pass' | 'fail' | 'not_comparable';
    evidenceUri: string | null;
  }>;
}

export interface BenchmarkRunsResponse {
  data: BenchmarkRunSummary[];
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    scenarioIds: string[];
    statuses: string[];
    bunVersions: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

export interface BenchmarkBaselinesResponse {
  data: Array<{
    baselineId: string;
    scenarioId: string;
    scenarioVersion: string;
    approvedRunId: string;
    fixtureVersion: string;
    environment: string;
    instrumentationSchemaVersion: string;
    thresholdPolicyVersion: string;
    approvalCommitSha: string;
    active: boolean;
    promotedAt: string;
  }>;
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    scenarioIds: string[];
    environments: string[];
    fixtureVersions: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

export type RuntimeAlertStatus = 'pending' | 'firing' | 'resolved' | 'unknown';
export interface RuntimeAlertsResponse {
  data: Array<{
    ruleId: string;
    ruleVersion: string;
    seriesFingerprint: string;
    serviceName: string;
    resourceKind: string;
    resourceName: string;
    status: RuntimeAlertStatus;
    consecutiveBreachWindows: number | string;
    transitionSequence: number | string;
    firstBreachedAt: string | null;
    lastEvaluatedAt: string;
    evidenceBucket: string | null;
    lastNotifiedAt: string | null;
    resolvedAt: string | null;
    title?: string;
    severity?: 'warning' | 'critical';
    metric?: string;
    threshold?: number;
    windowSeconds?: number;
    ruleChecksum?: string;
  }>;
  prevCursor: string | null;
  nextCursor: string | null;
  options: {
    ruleIds: string[];
    services: string[];
  };
  storageStatus: 'available' | 'blind_spot';
}

/** The gateway validates actorUserId as a uuid, so an empty value is omitted. */
@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  health(): Observable<HealthResponse> {
    return defer(() =>
      sdkRequest<HealthResponse>(() => sdk.getHealth({ throwOnError: true })),
    );
  }

  notifications(filters: {
    page: number;
    pageSize?: number;
    category: string;
    unreadOnly: boolean;
  }): Observable<NotificationsResponse> {
    return this.http.get<NotificationsResponse>('/api/v1/notifications', {
      params: {
        page: filters.page,
        ...(filters.pageSize ? { pageSize: filters.pageSize } : {}),
        category: filters.category,
        unreadOnly: filters.unreadOnly,
      },
    });
  }

  unreadNotificationCount(): Observable<UnreadCountResponse> {
    return this.http.get<UnreadCountResponse>(
      '/api/v1/notifications/unread-count',
    );
  }

  markNotificationRead(id: string): Observable<NotificationRecord> {
    return this.http.patch<NotificationRecord>(
      `/api/v1/notifications/${id}/read`,
      {},
    );
  }

  markAllNotificationsRead(): Observable<{ changed: number }> {
    return this.http.post<{ changed: number }>(
      '/api/v1/notifications/read-all',
      {},
    );
  }

  notificationPreferences(): Observable<NotificationPreferencesResponse> {
    return this.http.get<NotificationPreferencesResponse>(
      '/api/v1/notifications/preferences',
    );
  }

  updateNotificationPreference(
    category: NotificationCategory,
    channel: NotificationChannel,
    enabled: boolean,
  ): Observable<NotificationPreference> {
    return this.http.patch<NotificationPreference>(
      `/api/v1/notifications/preferences/${category}/${channel}`,
      { enabled },
    );
  }

  jobs(filters: {
    page: number;
    pageSize?: number;
    status: string;
  }): Observable<JobsResponse> {
    return this.http.get<JobsResponse>('/api/v1/jobs', {
      params: {
        page: filters.page,
        ...(filters.pageSize ? { pageSize: filters.pageSize } : {}),
        ...(filters.status ? { status: filters.status } : {}),
      },
    });
  }

  job(id: string): Observable<JobDetail> {
    return this.http.get<JobDetail>(`/api/v1/jobs/${id}`);
  }

  retryJob(id: string, reason: string): Observable<JobRecord> {
    return this.http.post<JobRecord>(
      `/api/v1/jobs/${id}/retry`,
      { reason },
      { headers: { 'Idempotency-Key': crypto.randomUUID() } },
    );
  }

  users(filters: UsersFilters): Observable<UsersResponse> {
    return defer(() =>
      sdkRequest<UsersResponse>(() =>
        sdk.getApiV1Users({
          query: {
            search: filters.search,
            status: filters.status,
            page: String(filters.page),
            ...(filters.pageSize ? { pageSize: String(filters.pageSize) } : {}),
          },
          throwOnError: true,
        }),
      ),
    );
  }

  user(id: string): Observable<UserRecord> {
    return defer(() =>
      sdkRequest<UserRecord>(() =>
        sdk.getApiV1UsersById({ path: { id }, throwOnError: true }),
      ),
    );
  }

  createUser(payload: CreateUserPayload): Observable<UserRecord> {
    return defer(() =>
      sdkRequest<UserRecord>(() =>
        sdk.postApiV1Users({ body: payload, throwOnError: true }),
      ),
    );
  }

  updateUser(id: string, payload: UpdateUserPayload): Observable<UserRecord> {
    return defer(() =>
      sdkRequest<UserRecord>(() =>
        sdk.patchApiV1UsersById({
          path: { id },
          body: payload,
          throwOnError: true,
        }),
      ),
    );
  }

  /**
   * Every status action carries a mandatory reason, which lands in the audit
   * trail. Soft delete is the only one that is an HTTP DELETE, and it still
   * sends the reason in the body.
   */
  runUserStatusAction(
    id: string,
    action: UserStatusAction,
    reason: string,
  ): Observable<UserRecord> {
    if (action === 'delete') {
      return defer(() =>
        sdkRequest<UserRecord>(() =>
          sdk.deleteApiV1UsersById({
            path: { id },
            body: { reason },
            throwOnError: true,
          }),
        ),
      );
    }

    const operation = {
      suspend: sdk.postApiV1UsersByIdSuspend,
      unsuspend: sdk.postApiV1UsersByIdUnsuspend,
      block: sdk.postApiV1UsersByIdBlock,
      unblock: sdk.postApiV1UsersByIdUnblock,
      restore: sdk.postApiV1UsersByIdRestore,
    }[action];
    return defer(() =>
      sdkRequest<UserRecord>(() =>
        operation({ path: { id }, body: { reason }, throwOnError: true }),
      ),
    );
  }

  auditTrails(
    filters: AuditTrailFilters & ActorScope,
  ): Observable<AuditTrailsResponse> {
    return defer(() =>
      sdkRequest<AuditTrailsResponse>(() =>
        sdk.getApiV1LogsAuditTrails({
          query: {
            search: filters.search,
            module: filters.module,
            action: filters.action,
            page: String(filters.page),
            ...(filters.pageSize ? { pageSize: String(filters.pageSize) } : {}),
            actorUserId: filters.actorUserId,
          },
          throwOnError: true,
        }),
      ),
    );
  }

  accessLogs(
    filters: AccessLogFilters & ActorScope,
  ): Observable<AccessLogsResponse> {
    return this.http.get<AccessLogsResponse>('/api/v1/logs/access-logs', {
      params: {
        ...(filters.search ? { search: filters.search } : {}),
        ...(filters.event ? { event: filters.event } : {}),
        ...(filters.outcome ? { outcome: filters.outcome } : {}),
        ...(filters.traceId ? { traceId: filters.traceId } : {}),
        page: filters.page,
        ...(filters.from ? { from: filters.from } : {}),
        ...(filters.to ? { to: filters.to } : {}),
        ...(filters.cursor ? { cursor: filters.cursor } : {}),
        ...(filters.pageSize ? { pageSize: filters.pageSize } : {}),
        ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
      },
    });
  }

  applicationLogs(
    filters: ApplicationLogFilters & ActorScope,
  ): Observable<ApplicationLogsResponse> {
    return this.http.get<ApplicationLogsResponse>(
      '/api/v1/logs/application-logs',
      {
        params: {
          ...(filters.search ? { search: filters.search } : {}),
          ...(filters.level ? { level: filters.level } : {}),
          ...(filters.module ? { module: filters.module } : {}),
          ...(filters.event ? { event: filters.event } : {}),
          page: filters.page,
          ...(filters.from ? { from: filters.from } : {}),
          ...(filters.to ? { to: filters.to } : {}),
          ...(filters.cursor ? { cursor: filters.cursor } : {}),
          ...(filters.pageSize ? { pageSize: filters.pageSize } : {}),
          ...(filters.actorUserId ? { actorUserId: filters.actorUserId } : {}),
        },
      },
    );
  }

  runtimeTraces(
    filters: {
      from?: string;
      to?: string;
      service?: string;
      resourceKind?: string;
      resourceName?: string;
      status?: 'ok' | 'error' | 'unset';
      correlationId?: string;
      requestId?: string;
      runId?: string;
      cursor?: string;
    } = {},
  ): Observable<RuntimeTracesResponse> {
    return defer(() =>
      sdkRequest<RuntimeTracesResponse>(() =>
        sdk.getApiV1ObservabilityTraces({
          query: filters,
          throwOnError: true,
        }),
      ),
    );
  }

  runtimeTrace(traceId: string): Observable<RuntimeTraceDetail> {
    return defer(() =>
      sdkRequest<RuntimeTraceDetail>(() =>
        sdk.getApiV1ObservabilityTracesByTraceId({
          path: { traceId },
          throwOnError: true,
        }),
      ),
    );
  }

  runtimeMetrics(
    filters: {
      from?: string;
      to?: string;
      metric?: string;
      service?: string;
      resourceKind?: string;
      resourceName?: string;
      statistic?: 'count' | 'sum' | 'min' | 'max';
      step?: string;
      group?: RuntimeMetricGroup;
    } = {},
  ): Observable<RuntimeMetricsResponse> {
    return defer(() =>
      sdkRequest<RuntimeMetricsResponse>(() =>
        sdk.getApiV1ObservabilityMetrics({
          query: filters,
          throwOnError: true,
        }),
      ),
    );
  }

  benchmarkRuns(
    filters: {
      scenarioId?: string;
      status?: string;
      sourceCommitSha?: string;
      bunVersion?: string;
      cursor?: string;
    } = {},
  ): Observable<BenchmarkRunsResponse> {
    return defer(() =>
      sdkRequest<BenchmarkRunsResponse>(() =>
        sdk.getApiV1ObservabilityBenchmarksRuns({
          query: filters,
          throwOnError: true,
        }),
      ),
    );
  }

  benchmarkRun(runId: string): Observable<BenchmarkRunDetail> {
    return defer(() =>
      sdkRequest<BenchmarkRunDetail>(() =>
        sdk.getApiV1ObservabilityBenchmarksRunsByRunId({
          path: { runId },
          throwOnError: true,
        }),
      ),
    );
  }

  benchmarkBaselines(
    filters: {
      scenarioId?: string;
      scenarioVersion?: string;
      fixtureVersion?: string;
      environment?: string;
      cursor?: string;
    } = {},
  ): Observable<BenchmarkBaselinesResponse> {
    return defer(() =>
      sdkRequest<BenchmarkBaselinesResponse>(() =>
        sdk.getApiV1ObservabilityBenchmarksBaselines({
          query: filters,
          throwOnError: true,
        }),
      ),
    );
  }

  runtimeAlerts(
    filters: {
      status?: RuntimeAlertStatus;
      severity?: 'warning' | 'critical';
      service?: string;
      ruleId?: string;
      seriesFingerprint?: string;
      cursor?: string;
    } = {},
  ): Observable<RuntimeAlertsResponse> {
    return defer(() =>
      sdkRequest<RuntimeAlertsResponse>(() =>
        sdk.getApiV1ObservabilityAlerts({
          query: filters,
          throwOnError: true,
        }),
      ),
    );
  }

  permissions(filters: {
    search: string;
    namespace: string;
    page: number;
    pageSize?: number;
  }): Observable<PermissionsResponse> {
    return defer(() =>
      sdkRequest<PermissionsResponse>(() =>
        sdk.getApiV1AccessPermissions({
          query: {
            search: filters.search,
            namespace: filters.namespace,
            page: String(filters.page),
            ...(filters.pageSize ? { pageSize: String(filters.pageSize) } : {}),
          },
          throwOnError: true,
        }),
      ),
    );
  }

  groups(
    filters: {
      search?: string;
      status?: GroupStatus;
      deleted?: GroupDeletedFilter;
      appliable?: boolean;
      page?: number;
      pageSize?: number;
    } = {},
  ): Observable<PermissionGroupsResponse> {
    return defer(() =>
      sdkRequest<PermissionGroupsResponse>(() =>
        sdk.getApiV1AccessGroups({
          query: {
            ...(filters.search ? { search: filters.search } : {}),
            ...(filters.status ? { status: filters.status } : {}),
            ...(filters.deleted ? { deleted: filters.deleted } : {}),
            ...(filters.appliable === undefined
              ? {}
              : { appliable: String(filters.appliable) }),
            ...(filters.page ? { page: String(filters.page) } : {}),
            ...(filters.pageSize ? { pageSize: String(filters.pageSize) } : {}),
          },
          throwOnError: true,
        }),
      ),
    );
  }

  group(id: string): Observable<PermissionGroupRecord> {
    return defer(() =>
      sdkRequest<PermissionGroupRecord>(() =>
        sdk.getApiV1AccessGroupsById({ path: { id }, throwOnError: true }),
      ),
    );
  }

  createGroup(payload: {
    name: string;
    description?: string;
    status?: GroupStatus;
  }): Observable<PermissionGroupRecord> {
    return defer(() =>
      sdkRequest<PermissionGroupRecord>(() =>
        sdk.postApiV1AccessGroups({ body: payload, throwOnError: true }),
      ),
    );
  }

  updateGroup(
    id: string,
    payload: { name?: string; description?: string; status?: GroupStatus },
  ): Observable<PermissionGroupRecord> {
    return defer(() =>
      sdkRequest<PermissionGroupRecord>(() =>
        sdk.putApiV1AccessGroupsById({
          path: { id },
          body: payload,
          throwOnError: true,
        }),
      ),
    );
  }

  deleteGroup(id: string): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() =>
        sdk.deleteApiV1AccessGroupsById({ path: { id }, throwOnError: true }),
      ),
    );
  }

  restoreGroup(id: string): Observable<PermissionGroupRecord> {
    return defer(() =>
      sdkRequest<PermissionGroupRecord>(() =>
        sdk.postApiV1AccessGroupsByIdRestore({
          path: { id },
          throwOnError: true,
        }),
      ),
    );
  }

  groupPermissions(id: string): Observable<PermissionRecord[]> {
    return defer(() =>
      sdkRequest<PermissionRecord[]>(() =>
        sdk.getApiV1AccessGroupsByIdPermissions({
          path: { id },
          throwOnError: true,
        }),
      ),
    );
  }

  attachGroupPermissions(
    id: string,
    permissionIds: string[],
  ): Observable<{ attached: string[]; skipped: string[] }> {
    return defer(() =>
      sdkRequest<{ attached: string[]; skipped: string[] }>(() =>
        sdk.postApiV1AccessGroupsByIdPermissions({
          path: { id },
          body: { permissionIds },
          throwOnError: true,
        }),
      ),
    );
  }

  detachGroupPermission(id: string, permissionId: string): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() =>
        sdk.deleteApiV1AccessGroupsByIdPermissionsByPermissionId({
          path: { id, permissionId },
          throwOnError: true,
        }),
      ),
    );
  }

  applyGroupToUsers(
    id: string,
    userIds: string[],
  ): Observable<GroupBulkApplyResult> {
    return defer(() =>
      sdkRequest<GroupBulkApplyResult>(() =>
        sdk.postApiV1AccessGroupsByIdApply({
          path: { id },
          body: { userIds },
          throwOnError: true,
        }),
      ),
    );
  }

  applyGroupToUser(
    userId: string,
    groupId: string,
  ): Observable<GroupApplyResult> {
    return defer(() =>
      sdkRequest<GroupApplyResult>(() =>
        sdk.postApiV1AccessUsersByUserIdPermissionsApplyGroup({
          path: { userId },
          body: { groupId },
          throwOnError: true,
        }),
      ),
    );
  }

  createPermission(payload: {
    name: string;
    description: string;
  }): Observable<PermissionRecord> {
    return defer(() =>
      sdkRequest<PermissionRecord>(() =>
        sdk.postApiV1AccessPermissions({ body: payload, throwOnError: true }),
      ),
    );
  }

  updatePermission(
    id: string,
    description: string,
  ): Observable<PermissionRecord> {
    return defer(() =>
      sdkRequest<PermissionRecord>(() =>
        sdk.putApiV1AccessPermissionsById({
          path: { id },
          body: { description },
          throwOnError: true,
        }),
      ),
    );
  }

  deletePermission(id: string): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() =>
        sdk.deleteApiV1AccessPermissionsById({
          path: { id },
          throwOnError: true,
        }),
      ),
    );
  }

  userPermissions(userId: string): Observable<PermissionGrantResponse> {
    return defer(() =>
      sdkRequest<PermissionGrantResponse>(() =>
        sdk.getApiV1AccessUsersByUserIdPermissions({
          path: { userId },
          throwOnError: true,
        }),
      ),
    );
  }

  grantUserPermissions(
    userId: string,
    permissionIds: string[],
  ): Observable<PermissionMutationResponse> {
    return defer(() =>
      sdkRequest<PermissionMutationResponse>(() =>
        sdk.postApiV1AccessUsersByUserIdPermissions({
          path: { userId },
          body: { permissionIds },
          throwOnError: true,
        }),
      ),
    );
  }

  copyUserPermissions(
    userId: string,
    sourceUserId: string,
  ): Observable<PermissionMutationResponse> {
    return defer(() =>
      sdkRequest<PermissionMutationResponse>(() =>
        sdk.postApiV1AccessUsersByUserIdPermissionsCopy({
          path: { userId },
          body: { sourceUserId },
          throwOnError: true,
        }),
      ),
    );
  }

  revokeUserPermission(userId: string, permissionId: string): Observable<void> {
    return defer(() =>
      sdkRequest<void>(() =>
        sdk.deleteApiV1AccessUsersByUserIdPermissionsByPermissionId({
          path: { userId, permissionId },
          throwOnError: true,
        }),
      ),
    );
  }
}
