import * as OTPAuth from 'otpauth';
import {
  ConflictError,
  GoneError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import { hashSecret } from './auth.crypto';
import type { AuthSecurityContext } from './auth.notifications';
import type {
  AuthUser,
  SessionRecord,
  TotpCredentialRecord,
  TotpStatus,
} from './auth.types';
import {
  createEnrollmentTotp,
  decryptTotpSecret,
  encryptTotpSecret,
  generateRecoveryCode,
  hashRecoveryCode,
  normalizedTotpCode,
  parseEncryptionKey,
} from './totp.crypto';
import { type TotpCheck, TotpRepository } from './totp.repository';

const GENERIC_MFA_FAILURE = 'Two factor verification failed';
const GENERIC_ENROLLMENT_FAILURE = 'Two factor enrollment failed';

export interface TotpServiceOptions {
  encryptionKey: string;
  issuer: string;
}

export interface TotpEnrollmentResult {
  secret: string;
  otpauthUri: string;
}

export interface TotpConfirmResult {
  recoveryCodes: string[];
  session: SessionRecord | null;
}

export class TotpService {
  private readonly key: Buffer;

  constructor(
    private readonly options: TotpServiceOptions,
    private readonly repository = new TotpRepository(),
  ) {
    this.key = options.encryptionKey
      ? parseEncryptionKey(options.encryptionKey)
      : Buffer.alloc(0);
  }

  async status(userId: string): Promise<TotpStatus> {
    return this.repository.getStatus(userId);
  }

  async user(userId: string): Promise<AuthUser | null> {
    return this.repository.findUser(userId);
  }

  async enroll(userId: string): Promise<TotpEnrollmentResult> {
    this.requireConfigured();
    const user = await this.repository.findUser(userId);
    if (!user) {
      throw new UnauthorizedError('Authentication is required');
    }

    const current = await this.repository.getStatus(userId);
    if (current.enabled) {
      throw new ConflictError('Two factor authentication is already enabled');
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const base32 = secret.base32;
    const otp = createEnrollmentTotp(base32, this.options.issuer, user.email);
    const stored = await this.repository.saveEnrollment(
      userId,
      encryptTotpSecret(base32, this.key),
    );

    if (!stored) {
      throw new ConflictError('Two factor authentication is already enabled');
    }

    return { secret: base32, otpauthUri: otp.toString() };
  }

  async confirmEnrollment(
    userId: string,
    code: string,
    challengeTokenHash?: string,
    sessionTokenHash?: string,
    securityContext?: AuthSecurityContext,
  ): Promise<TotpConfirmResult> {
    this.requireConfigured();
    const credential = await this.repository.getCredential(userId);
    if (!credential || credential.confirmedAt) {
      throw new ConflictError('Two factor enrollment is not pending');
    }

    const check = this.totpCheck(credential, code);
    if (check?.kind !== 'totp') {
      throw new ValidationError(GENERIC_ENROLLMENT_FAILURE);
    }

    const recoveryCodes = Array.from({ length: 10 }, () =>
      generateRecoveryCode(),
    );
    const outcome = await this.repository.confirmEnrollment({
      userId,
      lastUsedStep: check.step,
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode),
      challengeTokenHash,
      sessionTokenHash,
      securityContext,
    });

    if (!outcome) {
      throw new GoneError(GENERIC_ENROLLMENT_FAILURE);
    }

    return { recoveryCodes, session: outcome.session };
  }

  async verifyLogin(
    challengeToken: string | undefined,
    code: string | undefined,
    recoveryCode: string | undefined,
    ipAddress: string | undefined,
    sessionTokenHash: string,
    securityContext?: AuthSecurityContext,
  ): Promise<{ user: AuthUser; session: SessionRecord }> {
    this.requireConfigured();
    const challengeTokenHash = challengeToken ? hashSecret(challengeToken) : '';
    const challenge = challengeToken
      ? await this.repository.findChallenge(challengeTokenHash, 'login')
      : null;

    const allowedIp = ipAddress
      ? await this.repository.allowAttempt('totp_ip', hashSecret(ipAddress))
      : true;
    const allowedUser = challenge
      ? await this.repository.allowAttempt(
          'totp_user',
          hashSecret(challenge.userId),
        )
      : true;

    if (!allowedIp || !allowedUser) {
      throw new RateLimitError(GENERIC_MFA_FAILURE);
    }

    if (!challenge) {
      throw new UnauthorizedError(GENERIC_MFA_FAILURE);
    }

    const outcome = await this.repository.verifyChallenge({
      tokenHash: challengeTokenHash,
      sessionTokenHash,
      check: (credential) => this.factorCheck(credential, code, recoveryCode),
      securityContext,
    });

    if (outcome.status !== 'authenticated') {
      throw new UnauthorizedError(GENERIC_MFA_FAILURE);
    }

    return outcome;
  }

  async disable(
    userId: string,
    code: string | undefined,
    recoveryCode: string | undefined,
    securityContext?: AuthSecurityContext,
  ): Promise<void> {
    this.requireConfigured();
    const disabled = await this.repository.disable(
      userId,
      (credential) => this.factorCheck(credential, code, recoveryCode),
      securityContext,
    );

    if (!disabled) {
      throw new UnauthorizedError(GENERIC_MFA_FAILURE);
    }
  }

  async regenerateRecoveryCodes(
    userId: string,
    code: string,
    securityContext?: AuthSecurityContext,
  ): Promise<string[]> {
    this.requireConfigured();
    const recoveryCodes = Array.from({ length: 10 }, () =>
      generateRecoveryCode(),
    );
    const regenerated = await this.repository.regenerateRecoveryCodes(
      userId,
      (credential) => this.totpCheck(credential, code),
      recoveryCodes.map(hashRecoveryCode),
      securityContext,
    );

    if (!regenerated) {
      throw new UnauthorizedError(GENERIC_MFA_FAILURE);
    }

    return recoveryCodes;
  }

  async resolveEnrollmentChallenge(
    challengeToken: string | undefined,
  ): Promise<string | null> {
    if (!challengeToken) return null;
    const challenge = await this.repository.findChallenge(
      hashSecret(challengeToken),
      'enroll',
    );
    return challenge?.userId ?? null;
  }

  async adminStatus(userId: string): Promise<TotpStatus> {
    const user = await this.repository.findUser(userId);
    if (!user) throw new NotFoundError('User not found');
    return this.repository.getStatus(userId);
  }

  async adminReset(
    userId: string,
    securityContext?: AuthSecurityContext,
  ): Promise<void> {
    const reset = await this.repository.reset(userId, securityContext);
    if (!reset) throw new NotFoundError('User not found');
  }

  private factorCheck(
    credential: TotpCredentialRecord,
    code: string | undefined,
    recoveryCode: string | undefined,
  ): TotpCheck {
    if (recoveryCode?.trim()) {
      return { kind: 'recovery', codeHash: hashRecoveryCode(recoveryCode) };
    }

    return code ? this.totpCheck(credential, code) : null;
  }

  private totpCheck(
    credential: TotpCredentialRecord,
    code: string,
  ): { kind: 'totp'; step: number } | null {
    if (!/^\d{6}$/.test(normalizedTotpCode(code))) return null;

    try {
      const secret = decryptTotpSecret(credential.secretEncrypted, this.key);
      const totp = createEnrollmentTotp(
        secret,
        this.options.issuer,
        credential.email,
      );
      const delta = totp.validate({
        token: normalizedTotpCode(code),
        window: 1,
      });

      if (delta === null) return null;

      return { kind: 'totp', step: totp.counter() + delta };
    } catch {
      return null;
    }
  }

  private requireConfigured(): void {
    if (this.key.length !== 32) {
      throw new Error('TOTP_ENCRYPTION_KEY is not configured');
    }
  }
}
