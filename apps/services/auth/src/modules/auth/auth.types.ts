import type { DatabaseClient } from '#project/database';

export type AuthRole = 'admin' | 'manager' | 'bi' | 'staff' | 'legacy';

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
