/**
 * Domain types for user lifecycle management
 * (spec docs/specs/0007-user-management).
 *
 * Status is not a column. It is derived from three nullable timestamps with the
 * precedence deleted, then blocked, then suspended, then active, so the login
 * checks in the auth service extend the ones that already existed instead of
 * being rewritten. A user row is never hard deleted.
 */

export const USER_STATUSES = [
  'active',
  'suspended',
  'blocked',
  'deleted',
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];

/**
 * List filter values. The empty string is the default view, which shows every
 * status except deleted (AC-5 hides a deleted user from the default list);
 * 'all' is the only value that includes deleted rows.
 */
export const USER_STATUS_FILTERS = ['', ...USER_STATUSES, 'all'] as const;

export type UserStatusFilter = (typeof USER_STATUS_FILTERS)[number];

/** The six status actions, each one requiring a reason. */
export const USER_STATUS_ACTIONS = [
  'suspend',
  'unsuspend',
  'block',
  'unblock',
  'delete',
  'restore',
] as const;

export type UserStatusAction = (typeof USER_STATUS_ACTIONS)[number];

export interface UserStatusTimestamps {
  suspendedAt: string | null;
  blockedAt: string | null;
  deletedAt: string | null;
}

export interface UserRecord extends UserStatusTimestamps {
  id: string;
  name: string;
  email: string;
  status: UserStatus;
  emailVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface UsersListQuery {
  search: string;
  status: UserStatusFilter;
  page: number;
}

export interface UsersListMeta {
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}

export interface UsersListResult {
  data: UserRecord[];
  meta: UsersListMeta;
  filters: { search: string; status: UserStatusFilter };
  options: { statuses: UserStatus[] };
}

export interface CreateUserInput {
  id: string;
  name: string;
  email: string;
}

export interface UpdateUserInput {
  name?: string;
}

/** The verified caller, used as the audit actor on every mutation. */
export interface UserActor {
  id: string;
  email: string;
}

/** Correlation fields the route reads off the request for the audit trail. */
export interface RequestCorrelation {
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

export function deriveUserStatus(timestamps: UserStatusTimestamps): UserStatus {
  if (timestamps.deletedAt) {
    return 'deleted';
  }

  if (timestamps.blockedAt) {
    return 'blocked';
  }

  if (timestamps.suspendedAt) {
    return 'suspended';
  }

  return 'active';
}
