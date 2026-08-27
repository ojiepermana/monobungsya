import {
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from '#project/errors';
import { createSecret, hashSecret, normalizeEmail } from './auth.crypto';
import type { AuthSecurityContext } from './auth.notifications';
import { AuthRepository, type MagicLinkEligibility } from './auth.repository';
import type { AuthMailer, FirstFactorResult } from './auth.types';

export interface MagicLinkRequestResult {
  status: 'gagal' | 'belum_verifikasi' | 'berhasil';
  keterangan: string;
}

const MAGIC_LINK_MESSAGES: Record<
  MagicLinkEligibility,
  { status: MagicLinkRequestResult['status']; keterangan: string }
> = {
  not_registered: {
    status: 'gagal',
    keterangan: 'Anda belum terdaftar',
  },
  inactive: {
    status: 'gagal',
    keterangan: 'Hubungi admin untuk informasi lebih lanjut',
  },
  unverified: {
    status: 'belum_verifikasi',
    keterangan: 'Email Anda belum diverifikasi',
  },
  active: {
    status: 'berhasil',
    keterangan: 'Silakan login dengan link yang dikirimkan ke email Anda',
  },
};

export interface SessionResult {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    permissions: string[];
  };
  session?: {
    id: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export type MagicLinkVerification = FirstFactorResult & {
  sessionToken?: string;
};

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
    ipAddress: string | undefined,
    options: { desktop?: boolean } = {},
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
      ipAddress ? hashSecret(ipAddress) : undefined,
      hashSecret(token),
      expiresAt,
    );

    if (result.rateLimited) {
      throw new RateLimitError();
    }

    if (result.eligibility === 'active' && result.user) {
      try {
        await this.mailer.sendMagicLink({
          recipient: result.user.email,
          recipientName: result.user.name,
          token,
          expiresAt,
          ...(options.desktop ? { desktop: true } : {}),
        });
      } catch {
        throw new ServiceUnavailableError('Auth email delivery failed');
      }
    }

    return MAGIC_LINK_MESSAGES[result.eligibility];
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
    securityContext?: AuthSecurityContext,
  ): Promise<MagicLinkVerification> {
    if (!token || token.length < 20 || token.length > 512) {
      throw new UnauthorizedError('Magic link is invalid or expired');
    }

    const sessionToken = createSecret();
    const session = await this.repository.consumeMagicToken(
      hashSecret(token),
      hashSecret(sessionToken),
      securityContext,
    );

    if (!session) {
      throw new UnauthorizedError('Magic link is invalid or expired');
    }

    if (session.status === 'mfa_required') {
      return session;
    }

    return { ...session, sessionToken };
  }

  createVerifyRedirect(): string {
    return new URL('/auth/callback-complete', this.webAppUrl).toString();
  }

  createVerifyErrorRedirect(): string {
    return new URL('/auth/callback-error', this.webAppUrl).toString();
  }

  createMfaRedirect(purpose: 'login' | 'enroll'): string {
    return new URL(
      purpose === 'enroll' ? '/auth/two-factor/enroll' : '/auth/two-factor',
      this.webAppUrl,
    ).toString();
  }

  async getSession(sessionToken: string | undefined): Promise<SessionResult> {
    if (!sessionToken) {
      return { authenticated: false };
    }

    const inspection = await this.repository.inspectSession(
      hashSecret(sessionToken),
    );
    const identity = inspection;

    if (!identity) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user: {
        id: identity.id,
        email: identity.email,
        name: identity.name,
        permissions: [],
      },
      session: {
        id: identity.sessionId,
        idleExpiresAt: identity.idleExpiresAt.toISOString(),
        absoluteExpiresAt: identity.absoluteExpiresAt.toISOString(),
      },
    };
  }

  async logout(
    sessionToken: string | undefined,
    securityContext?: AuthSecurityContext,
  ): Promise<void> {
    if (sessionToken) {
      await this.repository.revokeSession(
        hashSecret(sessionToken),
        securityContext,
      );
    }
  }
}
