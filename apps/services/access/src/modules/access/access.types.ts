export interface PermissionRecord {
  id: string;
  name: string;
  code: string;
  namespace: string;
  resource: string;
  action: string;
  scope: string | null;
  description: string | null;
  grantCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PermissionGrant {
  id: string;
  permissionId: string;
  userId: string;
  permission: PermissionRecord;
  createdAt: string;
}

export interface PermissionListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  namespace?: string;
}

export interface PermissionListResult {
  data: PermissionRecord[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { search: string; namespace: string };
}

export interface AccessActor {
  id: string;
  email: string;
}

export interface AccessCorrelation {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}
