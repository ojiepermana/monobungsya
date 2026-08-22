import type { UserRecord } from '../../users.types';

export type UsersModuleStatus = {
  status: 'ok';
  module: 'users';
};

export interface UsersPage {
  items: UserRecord[];
  total: number;
}

/** Which of the three status timestamps a mutation sets or clears. */
export interface StatusTimestampPatch {
  suspendedAt?: 'now' | null;
  blockedAt?: 'now' | null;
  deletedAt?: 'now' | null;
}

/** Told apart so the create path can return a distinct 409 reason. */
export type CreateConflict = 'id_taken' | 'email_taken';
