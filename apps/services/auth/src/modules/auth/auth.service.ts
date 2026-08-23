import {
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import { createSecret, hashSecret, normalizeEmail } from './auth.crypto';
import { AuthRepository } from './auth.repository';
import type {
  AuthMailer,
  AuthPermission,
  AuthRole,
  SessionIdentity,
  SessionObservation,
} from './auth.types';

export interface MagicLinkRequestResult {
  accepted: true;
  rateLimited: boolean;
}

export interface SessionResult {
  authenticated: boolean;
  sessionObservation: SessionObservation;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
    permissions: AuthPermission[];
  };
  session?: {
    id: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

/**
 * Permissions derived from the global role. Log rows carry PII, so the admin
 * and manager roles hold logs.read. User management is admin only
 * (spec docs/specs/0007-user-management, AC-8), so the web menu and route guard
 * agree with the gateway instead of showing a manager a page every call would
 * refuse. Manager level read access to the user pages is a follow up.
 */
export function permissionsForRole(role: AuthRole): AuthPermission[] {
  if (role === 'admin') {
    return ['users.manage', 'logs.read'];
  }

  return role === 'manager' ? ['logs.read'] : [];
}

export class AuthService {
  constructor(
    private readonly serviceName: string,
    private readonly repository = new AuthRepository(),
    private readonly mailer?: AuthMailer,
    private readonly webAppUrl = 'http://localhost:4200',
  ) {}

  getStatus() {
    return {
      service: this.serviceName,
      ...this.repository.getModuleStatus(),
    };
  }

  async requestMagicLink(
    email: string,
    ipAddress: string,
  ): Promise<MagicLinkRequestResult> {
    if (!this.mailer) {
      throw new ServiceUnavailableError(
        'Auth email delivery is not configured',
      );
    }

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail.includes('@')) {
      throw new ValidationError('A valid email address is required');
    }

    const token = createSecret();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const result = await this.repository.issueMagicLink(
      normalizedEmail,
      hashSecret(normalizedEmail),
      hashSecret(ipAddress),
      hashSecret(token),
      expiresAt,
    );

    if (result.rateLimited) {
      throw new RateLimitError();
    }

    if (result.user) {
      try {
        await this.mailer.sendMagicLink({
          recipient: result.user.email,
          recipientName: result.user.name,
          token,
          expiresAt,
        });
      } catch {
        throw new ServiceUnavailableError('Auth email delivery failed');
      }
    }

    return { accepted: true, rateLimited: result.rateLimited };
  }

  /**
   * Sends the invitation magic link for a newly created user, driven by the
   * `user.invited` event the user service publishes
   * (spec docs/specs/0007-user-management, AC-2). It reuses the same token
   * shape and lifetime as a self requested link, so consuming it goes through
   * the ordinary verify route and produces an ordinary session.
   */
  async sendInvitation(userId: string): Promise<boolean> {
    if (!this.mailer) {
      throw new ServiceUnavailableError(
        'Auth email delivery is not configured',
      );
    }

    const token = createSecret();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const user = await this.repository.issueInvitationLink(
      userId,
      hashSecret(token),
      expiresAt,
    );

    if (!user) {
      return false;
    }

    await this.mailer.sendMagicLink({
      recipient: user.email,
      recipientName: user.name,
      token,
      expiresAt,
    });

    return true;
  }

  async verifyMagicLink(
    token: string,
  ): Promise<SessionIdentity & { sessionToken: string }> {
    if (!token || token.length < 20) {
      throw new UnauthorizedError('Magic link is invalid or expired');
    }

    const sessionToken = createSecret();
    const session = await this.repository.consumeMagicToken(
      hashSecret(token),
      hashSecret(sessionToken),
    );

    if (!session) {
      throw new UnauthorizedError('Magic link is invalid or expired');
    }

    return {
      ...session.user,
      sessionId: session.sessionId,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      sessionToken,
    };
  }

  createVerifyRedirect(): string {
    return new URL('/auth/callback-complete', this.webAppUrl).toString();
  }

  createVerifyErrorRedirect(): string {
    return new URL('/auth/callback-error', this.webAppUrl).toString();
  }

  async getSession(sessionToken: string | undefined): Promise<SessionResult> {
    if (!sessionToken) {
      return {
        authenticated: false,
        sessionObservation: {
          state: 'anonymous',
          reason: 'missing_cookie',
          role: null,
          permissionCount: 0,
        },
      };
    }

    const inspection = await this.repository.inspectSession(
      hashSecret(sessionToken),
    );
    const identity = inspection.identity;

    if (!identity) {
      return {
        authenticated: false,
        sessionObservation: inspection.observation,
      };
    }

    return {
      authenticated: true,
      user: {
        id: identity.id,
        email: identity.email,
        name: identity.name,
        role: identity.role,
        permissions: permissionsForRole(identity.role),
      },
      session: {
        id: identity.sessionId,
        idleExpiresAt: identity.idleExpiresAt.toISOString(),
        absoluteExpiresAt: identity.absoluteExpiresAt.toISOString(),
      },
      sessionObservation: {
        ...inspection.observation,
        reason: null,
      },
    };
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken) {
      await this.repository.revokeSession(hashSecret(sessionToken));
    }
  }
}
