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
