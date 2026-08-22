import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthRole } from '../auth/auth.service';

export interface HealthResponse {
  status: string;
}

export interface AuthUserAdmin {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  suspendedAt: string | null;
}

export interface AuthUsersResponse {
  data: AuthUserAdmin[];
}

export interface AuthUsersFilters {
  search: string;
}

export interface SaveAuthUserPayload {
  id?: string;
  name: string;
  email: string;
  role: AuthRole;
}

export interface SuspendAuthUserPayload {
  suspended: boolean;
}

export interface AdminMagicLinkResponse {
  status: 'sent';
  message: string;
  magicLink?: string;
  expiresAt: string;
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
  page: number;
}

export interface AccessLogItem {
  event: string;
  outcome: string;
  actorEmail: string | null;
  failureReason: string | null;
  createdAt: string;
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

@Service()
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiUrl;

  health(): Observable<HealthResponse> {
    return this.http.get<HealthResponse>(`${this.base}/health`);
  }

  authUsers(filters: AuthUsersFilters): Observable<AuthUsersResponse> {
    return this.http.get<AuthUsersResponse>(`${this.base}/api/v1/auth/users`, {
      params: new HttpParams().set('search', filters.search),
    });
  }

  saveAuthUser(payload: SaveAuthUserPayload): Observable<AuthUserAdmin> {
    return this.http.post<AuthUserAdmin>(
      `${this.base}/api/v1/auth/users`,
      payload,
    );
  }

  suspendAuthUser(
    id: string,
    payload: SuspendAuthUserPayload,
  ): Observable<AuthUserAdmin> {
    return this.http.patch<AuthUserAdmin>(
      `${this.base}/api/v1/auth/users/${encodeURIComponent(id)}/suspension`,
      payload,
    );
  }

  generateAuthUserMagicLink(id: string): Observable<AdminMagicLinkResponse> {
    return this.http.post<AdminMagicLinkResponse>(
      `${this.base}/api/v1/auth/users/${encodeURIComponent(id)}/magic-link`,
      {},
    );
  }

  auditTrails(filters: AuditTrailFilters): Observable<AuditTrailsResponse> {
    return this.http.get<AuditTrailsResponse>(
      `${this.base}/api/v1/logs/audit-trails`,
      {
        params: new HttpParams()
          .set('search', filters.search)
          .set('module', filters.module)
          .set('action', filters.action)
          .set('page', String(filters.page)),
      },
    );
  }

  accessLogs(filters: AccessLogFilters): Observable<AccessLogsResponse> {
    return this.http.get<AccessLogsResponse>(
      `${this.base}/api/v1/logs/access-logs`,
      {
        params: new HttpParams()
          .set('search', filters.search)
          .set('event', filters.event)
          .set('outcome', filters.outcome)
          .set('page', String(filters.page)),
      },
    );
  }

  applicationLogs(
    filters: ApplicationLogFilters,
  ): Observable<ApplicationLogsResponse> {
    return this.http.get<ApplicationLogsResponse>(
      `${this.base}/api/v1/logs/application-logs`,
      {
        params: new HttpParams()
          .set('search', filters.search)
          .set('level', filters.level)
          .set('module', filters.module)
          .set('event', filters.event)
          .set('page', String(filters.page)),
      },
    );
  }
}
