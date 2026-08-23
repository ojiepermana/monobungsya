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

export interface AuditTrailsResult {
  data: AuditTrailItem[];
  meta: LogsMeta;
  filters: AuditTrailFilters;
  options: { modules: string[]; actions: string[] };
}

export interface AccessLogFilters {
  search: string;
  event: string;
  outcome: string;
  traceId: string;
}

export interface SessionSummary {
  state: 'authenticated' | 'anonymous' | 'invalid';
  reason:
    | 'missing_cookie'
    | 'unknown_session'
    | 'revoked'
    | 'absolute_expired'
    | 'idle_expired'
    | 'user_missing'
    | 'user_deleted'
    | 'user_blocked'
    | 'user_suspended'
    | null;
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

export interface AccessLogsResult {
  data: AccessLogItem[];
  meta: LogsMeta;
  filters: AccessLogFilters;
  options: { events: string[]; outcomes: string[] };
}

export interface ApplicationLogFilters {
  search: string;
  level: string;
  module: string;
  event: string;
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

export interface ApplicationLogsResult {
  data: ApplicationLogItem[];
  meta: LogsMeta;
  filters: ApplicationLogFilters;
  options: { levels: string[]; modules: string[]; events: string[] };
}
