import type { DatabaseClient } from '#project/database';

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
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  suspendedAt: Date | null;
}

export interface SessionIdentity extends AuthUser {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionRecord {
  sessionId: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface MagicLinkMessage {
  recipient: string;
  recipientName: string;
  token: string;
  expiresAt: Date;
  desktop?: boolean;
}

export interface AuthMailer {
  sendMagicLink(message: MagicLinkMessage): Promise<void>;
}

export interface AuthRepositoryDependencies {
  database: DatabaseClient;
}

export type MfaChallengePurpose = 'login' | 'enroll';

export interface MfaChallengeResult {
  user: AuthUser;
  challengeToken: string;
  purpose: MfaChallengePurpose;
}

export interface TotpStatus {
  enabled: boolean;
  confirmedAt: string | null;
  required: boolean;
  recoveryCodesRemaining: number;
}

export interface TotpCredentialRecord {
  userId: string;
  email: string;
  secretEncrypted: string;
  confirmedAt: Date | null;
  lastUsedStep: bigint | null;
}

export type FirstFactorResult =
  | {
      status: 'authenticated';
      user: AuthUser;
      session: SessionRecord;
    }
  | ({ status: 'mfa_required' } & MfaChallengeResult);

export interface RecoveryCodeVerification {
  kind: 'recovery';
  codeHash: string;
}

export interface TotpVerification {
  kind: 'totp';
  step: number;
}
