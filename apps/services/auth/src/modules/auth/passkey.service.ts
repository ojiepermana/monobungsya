import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import {
  ConflictError,
  GoneError,
  NotFoundError,
  RateLimitError,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import type { Logger } from '#project/logger';
import { createSecret, hashSecret } from './auth.crypto';
import type { AuthSecurityContext } from './auth.notifications';
import type { AuthRepository } from './auth.repository';
import type { SessionIdentity } from './auth.types';
import { defaultPasskeyLabel, normalizeAaguid } from './passkey.authenticators';
import { PasskeyRepository } from './passkey.repository';
import type {
  AssertionCheck,
  AttestationCheck,
  PasskeySummary,
  StoredCredential,
} from './passkey.types';

export const MAX_PASSKEYS_PER_USER = 5;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 60_000;
/** Generic on purpose: public passkey errors must not reveal account existence. */
const GENERIC_LOGIN_FAILURE = 'Passkey sign in failed';

export interface PasskeyServiceOptions {
  /** Relying party id: the registrable domain the passkey binds to. */
  rpId: string;
  rpName: string;
  /** The exact web origin the ceremony must run on. */
  expectedOrigin: string;
  logger?: Logger;
}

export interface PasskeyLoginResult {
  status: 'authenticated' | 'mfa_required';
  user: { id: string; email: string; name: string };
  session?: { id: string; idleExpiresAt: Date; absoluteExpiresAt: Date };
  sessionToken?: string;
  challengeToken?: string;
  purpose?: 'login' | 'enroll';
}

export class PasskeyService {
  constructor(
    private readonly options: PasskeyServiceOptions,
    private readonly repository = new PasskeyRepository(),
    private readonly authRepository?: AuthRepository,
  ) {}

  /**
   * Resolves the session cookie into an identity, the same way every other
   * session backed auth route does.
   */
  async requireSession(
    sessionToken: string | undefined,
  ): Promise<SessionIdentity> {
    if (!sessionToken || !this.authRepository) {
      throw new UnauthorizedError('Authentication is required');
    }

    const identity = await this.authRepository.findSession(
      hashSecret(sessionToken),
    );

    if (!identity) {
      throw new UnauthorizedError('Authentication is required');
    }

    return identity;
  }

  async createRegistrationOptions(
    userId: string,
  ): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.repository.findActiveUser(userId);

    if (!user) {
      throw new UnauthorizedError('Authentication is required');
    }

    const existing = await this.repository.countCredentials(userId);

    if (existing >= MAX_PASSKEYS_PER_USER) {
      throw new ConflictError(
        `A maximum of ${MAX_PASSKEYS_PER_USER} passkeys per account is allowed`,
      );
    }

    const excluded = await this.repository.listExcludedCredentials(userId);
    const options = await generateRegistrationOptions({
      rpID: this.options.rpId,
      rpName: this.options.rpName,
      userID: new TextEncoder().encode(user.id),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: 'none',
      timeout: CEREMONY_TIMEOUT_MS,
      excludeCredentials: excluded.map((credential) => ({
        id: credential.credentialId,
        transports: toTransports(credential.transports),
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        // Preferred, not required, for the widest authenticator support.
        userVerification: 'preferred',
      },
    });

    await this.repository.issueChallenge(
      'registration',
      user.id,
      options.challenge,
      this.challengeExpiry(),
    );

    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    label?: string,
    securityContext?: AuthSecurityContext,
  ): Promise<PasskeySummary> {
    const requestedLabel = label?.trim();

    if (requestedLabel !== undefined && requestedLabel.length > 100) {
      throw new ValidationError(
        'A passkey label may be at most 100 characters',
      );
    }

    const challenge = response.response.clientDataJSON
      ? readChallenge(response.response.clientDataJSON)
      : null;

    if (!challenge) {
      throw new ValidationError('The passkey response is malformed');
    }

    const outcome = await this.repository.registerCredential({
      userId,
      challenge,
      maxCredentials: MAX_PASSKEYS_PER_USER,
      check: () => this.checkAttestation(response, challenge, requestedLabel),
      securityContext,
    });

    switch (outcome.status) {
      case 'created':
        this.options.logger?.info('auth.passkey.registered', {
          userId,
          passkeyId: outcome.credential.id,
        });
        return outcome.credential;
      case 'challenge_invalid':
        throw new GoneError('The passkey challenge is expired or already used');
      case 'limit_reached':
        throw new ConflictError(
          `A maximum of ${MAX_PASSKEYS_PER_USER} passkeys per account is allowed`,
        );
      case 'duplicate':
        throw new ConflictError('This passkey is already registered');
      default:
        this.options.logger?.warn('auth.passkey.registration_rejected', {
          userId,
          reason: outcome.reason,
        });
        throw new ValidationError('The passkey could not be verified');
    }
  }

  async createLoginOptions(
    ipAddress: string,
  ): Promise<PublicKeyCredentialRequestOptionsJSON> {
    await this.guardRate(ipAddress);

    const options = await generateAuthenticationOptions({
      rpID: this.options.rpId,
      // Left empty on purpose: the browser offers any discoverable passkey for
      // this domain, so the user never types an email.
      allowCredentials: [],
      userVerification: 'preferred',
      timeout: CEREMONY_TIMEOUT_MS,
    });

    await this.repository.issueChallenge(
      'authentication',
      null,
      options.challenge,
      this.challengeExpiry(),
    );

    return options;
  }

  async verifyLogin(
    response: AuthenticationResponseJSON,
    ipAddress: string,
    securityContext?: AuthSecurityContext,
  ): Promise<PasskeyLoginResult> {
    await this.guardRate(ipAddress);

    const challenge = readChallenge(response.response.clientDataJSON);

    if (!challenge || !response.id) {
      throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
    }

    const sessionToken = createSecret();
    const outcome = await this.repository.authenticate({
      challenge,
      credentialId: response.id,
      sessionTokenHash: hashSecret(sessionToken),
      check: (credential) =>
        this.checkAssertion(response, challenge, credential),
      securityContext,
    });

    switch (outcome.status) {
      case 'authenticated':
        this.options.logger?.info('auth.passkey.login', {
          userId: outcome.user.id,
          sessionId: outcome.session.sessionId,
        });
        return {
          status: 'authenticated',
          user: {
            id: outcome.user.id,
            email: outcome.user.email,
            name: outcome.user.name,
          },
          session: {
            id: outcome.session.sessionId,
            idleExpiresAt: outcome.session.idleExpiresAt,
            absoluteExpiresAt: outcome.session.absoluteExpiresAt,
          },
          sessionToken,
        };
      case 'mfa_required':
        return {
          status: 'mfa_required',
          user: {
            id: outcome.user.id,
            email: outcome.user.email,
            name: outcome.user.name,
          },
          challengeToken: outcome.challengeToken,
          purpose: outcome.purpose,
        };
      case 'challenge_invalid':
        throw new GoneError('The passkey challenge is expired or already used');
      case 'counter_regression':
        // Possible cloned authenticator. The credential survives on purpose:
        // synced passkeys make counters unreliable, so we warn, never destroy.
        this.options.logger?.warn('auth.passkey.counter_regression', {
          userId: outcome.userId,
          passkeyId: outcome.credentialDatabaseId,
        });
        throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
      default:
        throw new UnauthorizedError(GENERIC_LOGIN_FAILURE);
    }
  }

  async listPasskeys(userId: string): Promise<PasskeySummary[]> {
    return this.repository.listCredentials(userId);
  }

  async renamePasskey(
    userId: string,
    passkeyId: string,
    label: string,
    securityContext?: AuthSecurityContext,
  ): Promise<PasskeySummary> {
    const trimmed = label.trim();

    if (trimmed.length === 0 || trimmed.length > 100) {
      throw new ValidationError(
        'A passkey label must be between 1 and 100 characters',
      );
    }

    const updated = await this.repository.renameCredential(
      userId,
      passkeyId,
      trimmed,
      securityContext,
    );

    if (!updated) {
      throw new NotFoundError('Passkey not found');
    }

    return updated;
  }

  async deletePasskey(
    userId: string,
    passkeyId: string,
    securityContext?: AuthSecurityContext,
  ): Promise<void> {
    const deleted = await this.repository.deleteCredential(
      userId,
      passkeyId,
      securityContext,
    );

    if (!deleted) {
      throw new NotFoundError('Passkey not found');
    }

    this.options.logger?.info('auth.passkey.deleted', {
      userId,
      passkeyId: deleted.id,
    });
  }

  private async checkAttestation(
    response: RegistrationResponseJSON,
    challenge: string,
    label: string | undefined,
  ): Promise<AttestationCheck> {
    try {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.options.expectedOrigin,
        expectedRPID: this.options.rpId,
        // Matches the `preferred` user verification we asked for.
        requireUserVerification: false,
      });

      if (!verification.verified) {
        return {
          status: 'verification_failed',
          reason: 'attestation rejected',
        };
      }

      const info = verification.registrationInfo;
      const aaguid = normalizeAaguid(info.aaguid);

      return {
        status: 'ok',
        credential: {
          credentialId: info.credential.id,
          publicKey: info.credential.publicKey,
          counter: info.credential.counter,
          transports: info.credential.transports
            ? [...info.credential.transports]
            : null,
          aaguid,
          label:
            label && label.length > 0
              ? label
              : defaultPasskeyLabel(aaguid, new Date()),
          backupEligible: info.credentialDeviceType === 'multiDevice',
          backupState: info.credentialBackedUp,
        },
      };
    } catch (error) {
      return {
        status: 'verification_failed',
        reason: error instanceof Error ? error.message : 'attestation failed',
      };
    }
  }

  private async checkAssertion(
    response: AuthenticationResponseJSON,
    challenge: string,
    credential: StoredCredential,
  ): Promise<AssertionCheck> {
    try {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.options.expectedOrigin,
        expectedRPID: this.options.rpId,
        credential: {
          id: credential.credentialId,
          publicKey: credential.publicKey,
          // Zero disables the library's own counter check so the signature is
          // proven first; the stored counter is compared below instead.
          counter: 0,
          transports: toTransports(credential.transports),
        },
        requireUserVerification: false,
      });

      if (!verification.verified) {
        return { status: 'verification_failed', reason: 'assertion rejected' };
      }

      const newCounter = verification.authenticationInfo.newCounter;

      // Same rule the library applies, run after the signature is proven so a
      // clone warning can never be triggered by an unsigned request. Counters
      // that stay at zero (common for synced passkeys) are not a regression.
      if (
        (newCounter > 0 || credential.counter > 0) &&
        newCounter <= credential.counter
      ) {
        return { status: 'counter_regression', newCounter };
      }

      return { status: 'ok', newCounter };
    } catch (error) {
      return {
        status: 'verification_failed',
        reason: error instanceof Error ? error.message : 'assertion failed',
      };
    }
  }

  private async guardRate(ipAddress: string): Promise<void> {
    const allowed = await this.repository.allowAttempt(hashSecret(ipAddress));

    if (!allowed) {
      throw new RateLimitError();
    }
  }

  private challengeExpiry(): Date {
    return new Date(Date.now() + CHALLENGE_TTL_MS);
  }
}

function toTransports(
  value: string[] | null,
): AuthenticatorTransportFuture[] | undefined {
  if (!value || value.length === 0) {
    return undefined;
  }

  return value as AuthenticatorTransportFuture[];
}

/**
 * Reads the challenge straight out of the client data the authenticator signed,
 * so the server looks up the very challenge the ceremony used.
 */
function readChallenge(clientDataJSON: string): string | null {
  try {
    const decoded = JSON.parse(
      Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
    ) as { challenge?: unknown };

    return typeof decoded.challenge === 'string' && decoded.challenge.length > 0
      ? decoded.challenge
      : null;
  } catch {
    return null;
  }
}
