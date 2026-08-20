import {
  RateLimitError,
  ServiceUnavailableError,
  UnauthorizedError,
  ValidationError,
} from "#project/errors";
import { createSecret, hashSecret, normalizeEmail } from "./auth.crypto";
import { AuthRepository } from "./auth.repository";
import type { AuthMailer, SessionIdentity } from "./auth.types";

export interface MagicLinkRequestResult {
  accepted: true;
  rateLimited: boolean;
}

export interface SessionResult {
  authenticated: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
  session?: {
    id: string;
    idleExpiresAt: string;
    absoluteExpiresAt: string;
  };
}

export class AuthService {
  constructor(
    private readonly serviceName: string,
    private readonly repository = new AuthRepository(),
    private readonly mailer?: AuthMailer,
    private readonly webAppUrl = "http://localhost:4200",
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
        "Auth email delivery is not configured",
      );
    }

    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail.includes("@")) {
      throw new ValidationError("A valid email address is required");
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
        throw new ServiceUnavailableError("Auth email delivery failed");
      }
    }

    return { accepted: true, rateLimited: result.rateLimited };
  }

  async verifyMagicLink(
    token: string,
  ): Promise<SessionIdentity & { sessionToken: string }> {
    if (!token || token.length < 20) {
      throw new UnauthorizedError("Magic link is invalid or expired");
    }

    const sessionToken = createSecret();
    const session = await this.repository.consumeMagicToken(
      hashSecret(token),
      hashSecret(sessionToken),
    );

    if (!session) {
      throw new UnauthorizedError("Magic link is invalid or expired");
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
    return new URL("/auth/callback-complete", this.webAppUrl).toString();
  }

  createVerifyErrorRedirect(): string {
    return new URL("/auth/callback-error", this.webAppUrl).toString();
  }

  async getSession(sessionToken: string | undefined): Promise<SessionResult> {
    if (!sessionToken) {
      return { authenticated: false };
    }

    const identity = await this.repository.findSession(
      hashSecret(sessionToken),
    );

    if (!identity) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user: {
        id: identity.id,
        email: identity.email,
        name: identity.name,
        role: identity.role,
      },
      session: {
        id: identity.sessionId,
        idleExpiresAt: identity.idleExpiresAt.toISOString(),
        absoluteExpiresAt: identity.absoluteExpiresAt.toISOString(),
      },
    };
  }

  async logout(sessionToken: string | undefined): Promise<void> {
    if (sessionToken) {
      await this.repository.revokeSession(hashSecret(sessionToken));
    }
  }
}
