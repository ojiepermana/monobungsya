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

export type GroupStatus = 'active' | 'off';
export type GroupDeletedFilter = 'exclude' | 'include' | 'only';

export interface GroupRecord {
  id: string;
  name: string;
  status: GroupStatus;
  description: string | null;
  permissionCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface GroupListQuery {
  page?: string;
  pageSize?: string;
  search?: string;
  status?: string;
  deleted?: string;
  appliable?: string;
}

export interface GroupListResult {
  data: GroupRecord[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: {
    search: string;
    status: string;
    deleted: GroupDeletedFilter;
    appliable: boolean;
  };
}

export interface GroupMutationResult {
  attached: string[];
  skipped: string[];
}

export interface GroupApplyResult {
  granted: string[];
  skipped: string[];
}

export interface GroupBulkApplyResult {
  applied: Array<GroupApplyResult & { userId: string }>;
  failed: Array<{ userId: string; reason: string }>;
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
