import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthRole } from '../auth/auth.service';

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
  role: AuthRole;
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
  options: { roles: AuthRole[]; statuses: UserStatus[] };
}

export interface CreateUserPayload {
  /** A UUIDv7 the client generates, so the caller knows the id up front. */
  id: string;
  name: string;
  email: string;
  role: AuthRole;
}

export interface UpdateUserPayload {
  name?: string;
  role?: AuthRole;
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
  role: string | null;
  permissionCount: number;
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
function withActor(params: HttpParams, actorUserId?: string): HttpParams {
  return actorUserId ? params.set('actorUserId', actorUserId) : params;
}

@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  health(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${this.base}/health`);
  }

  users(filters: UsersFilters): Observable<UsersResponse> {
    return this.http.get<UsersResponse>(`${this.base}/api/v1/users`, {
      params: new HttpParams()
        .set('search', filters.search)
        .set('status', filters.status)
        .set('page', String(filters.page)),
    });
  }

  user(id: string): Observable<UserRecord> {
    return this.http.get<UserRecord>(`${this.userUrl(id)}`);
  }

  createUser(payload: CreateUserPayload): Observable<UserRecord> {
    return this.http.post<UserRecord>(`${this.base}/api/v1/users`, payload);
  }

  updateUser(id: string, payload: UpdateUserPayload): Observable<UserRecord> {
    return this.http.patch<UserRecord>(this.userUrl(id), payload);
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
      return this.http.delete<UserRecord>(this.userUrl(id), {
        body: { reason },
      });
    }

    return this.http.post<UserRecord>(`${this.userUrl(id)}/${action}`, {
      reason,
    });
  }

  auditTrails(
    filters: AuditTrailFilters & ActorScope,
  ): Observable<AuditTrailsResponse> {
    return this.http.get<AuditTrailsResponse>(
      `${this.base}/api/v1/logs/audit-trails`,
      {
        params: withActor(
          new HttpParams()
            .set('search', filters.search)
            .set('module', filters.module)
            .set('action', filters.action)
            .set('page', String(filters.page)),
          filters.actorUserId,
        ),
      },
    );
  }

  accessLogs(
    filters: AccessLogFilters & ActorScope,
  ): Observable<AccessLogsResponse> {
    return this.http.get<AccessLogsResponse>(
      `${this.base}/api/v1/logs/access-logs`,
      {
        params: withActor(
          new HttpParams()
            .set('search', filters.search)
            .set('event', filters.event)
            .set('outcome', filters.outcome)
            .set('traceId', filters.traceId)
            .set('page', String(filters.page)),
          filters.actorUserId,
        ),
      },
    );
  }

  applicationLogs(
    filters: ApplicationLogFilters & ActorScope,
  ): Observable<ApplicationLogsResponse> {
    return this.http.get<ApplicationLogsResponse>(
      `${this.base}/api/v1/logs/application-logs`,
      {
        params: withActor(
          new HttpParams()
            .set('search', filters.search)
            .set('level', filters.level)
            .set('module', filters.module)
            .set('event', filters.event)
            .set('page', String(filters.page)),
          filters.actorUserId,
        ),
      },
    );
  }

  private userUrl(id: string): string {
    return `${this.base}/api/v1/users/${encodeURIComponent(id)}`;
  }
}
