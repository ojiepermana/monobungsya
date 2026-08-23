import { Service } from '@angular/core';
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
}

export interface UsersResponse {
  data: UserRecord[];
  meta: LogsMeta;
  filters: Omit<UsersFilters, 'page'>;
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
  filters: Omit<AuditTrailFilters, 'page'>;
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
  granted: PermissionRecord[];
  skipped: string[];
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

export interface AccessLogsResponse {
  data: AccessLogItem[];
  meta: LogsMeta;
  filters: Omit<AccessLogFilters, 'page'>;
  options: {
    events: string[];
    outcomes: string[];
  };
}

export interface ApplicationLogFilters {
  search: string;
  level: string;
  module: string;
  event: string;
  page: number;
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

export interface ApplicationLogsResponse {
  data: ApplicationLogItem[];
  meta: LogsMeta;
  filters: Omit<ApplicationLogFilters, 'page'>;
  options: {
    levels: string[];
    modules: string[];
    events: string[];
  };
}

/** The gateway validates actorUserId as a uuid, so an empty value is omitted. */
@Service()
export class ApiService {
  health(): Observable<HealthResponse> {
    return defer(() =>
      sdkRequest<HealthResponse>(() => sdk.getHealth({ throwOnError: true })),
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
    return defer(() =>
      sdkRequest<AccessLogsResponse>(() =>
        sdk.getApiV1LogsAccessLogs({
          query: {
            search: filters.search,
            event: filters.event,
            outcome: filters.outcome,
            traceId: filters.traceId,
            page: String(filters.page),
            actorUserId: filters.actorUserId,
          },
          throwOnError: true,
        }),
      ),
    );
  }

  applicationLogs(
    filters: ApplicationLogFilters & ActorScope,
  ): Observable<ApplicationLogsResponse> {
    return defer(() =>
      sdkRequest<ApplicationLogsResponse>(() =>
        sdk.getApiV1LogsApplicationLogs({
          query: {
            search: filters.search,
            level: filters.level,
            module: filters.module,
            event: filters.event,
            page: String(filters.page),
            actorUserId: filters.actorUserId,
          },
          throwOnError: true,
        }),
      ),
    );
  }

  permissions(filters: {
    search: string;
    namespace: string;
    page: number;
  }): Observable<PermissionsResponse> {
    return defer(() =>
      sdkRequest<PermissionsResponse>(() =>
        sdk.getApiV1AccessPermissions({
          query: {
            search: filters.search,
            namespace: filters.namespace,
            page: String(filters.page),
          },
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
