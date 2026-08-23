import type { DatabaseClient } from '#project/database';

export type AuthRole = 'admin' | 'manager' | 'bi' | 'staff' | 'legacy';

export type AuthPermission = 'users.manage' | 'logs.read';

export type SessionObservationState = 'authenticated' | 'anonymous' | 'invalid';
export type SessionObservationReason =
  | 'missing_cookie'
  | 'unknown_session'
  | 'revoked'
  | 'absolute_expired'
  | 'idle_expired'
  | 'user_missing'
  | 'user_deleted'
  | 'user_blocked'
  | 'user_suspended';

export interface SessionObservation {
  state: SessionObservationState;
  reason: SessionObservationReason | null;
  role: AuthRole | null;
  permissionCount: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: AuthRole;
  suspendedAt: Date | null;
}

export interface SessionIdentity extends AuthUser {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface MagicLinkMessage {
  recipient: string;
  recipientName: string;
  token: string;
  expiresAt: Date;
}

export interface AuthMailer {
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

export interface AuthRepositoryDependencies {
  database: DatabaseClient;
}
