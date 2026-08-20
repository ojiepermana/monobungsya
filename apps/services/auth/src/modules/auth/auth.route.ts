import { Elysia } from "elysia";
import { readAndVerifyAuthIdentity } from "#project/contracts";
import type { DatabaseClient } from "#project/database";
import { UnauthorizedError } from "#project/errors";
import { AuthRepository } from "./auth.repository";
import {
  authStatusResponse,
  identityResponse,
  magicLinkAcceptedResponse,
  magicLinkQuery,
  magicLinkRequestBody,
  sessionResponse,
} from "./auth.schema";
import { AuthService } from "./auth.service";
import type { AuthMailer } from "./auth.types";

export interface AuthRouteOptions {
  database?: DatabaseClient;
  mailer?: AuthMailer;
  webAppUrl?: string;
  cookieName?: string;
  cookieSecure?: boolean;
  signingSecret?: string;
  clockSkewSeconds?: number;
}

export function createAuthRoute(
  serviceName: string,
  options: AuthRouteOptions = {},
) {
  const service = new AuthService(
    serviceName,
    new AuthRepository(
      options.database ? { database: options.database } : undefined,
    ),
    options.mailer,
    options.webAppUrl,
  );
  const cookieName = options.cookieName ?? "project_session";
  const cookieSecure = options.cookieSecure ?? false;
  const signingSecret = options.signingSecret ?? "";
  const clockSkewSeconds = options.clockSkewSeconds ?? 30;
  const route = new Elysia({ name: "auth-routes" }).get(
    "/internal/auth/status",
    () => service.getStatus(),
    {
      response: { 200: authStatusResponse },
      detail: {
        tags: ["Auth"],
        summary: "Return auth module status",
      },
    },
  );

  return route
    .get(
      "/internal/auth/identity",
      ({ request }) => {
        const identity = readAndVerifyAuthIdentity(
          request.headers,
          request.method,
          new URL(request.url).pathname,
          signingSecret,
          Date.now(),
          clockSkewSeconds,
        );

        if (!identity) {
          throw new UnauthorizedError("A valid signed identity is required");
        }

        return identity;
      },
      {
        response: { 200: identityResponse },
        detail: {
          hide: true,
          tags: ["Auth"],
          summary: "Verify internal identity",
        },
      },
    )
    .post(
      "/internal/auth/magic-link",
      async ({ body, request }) => {
        const result = await service.requestMagicLink(
          body.email,
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
            "unknown",
        );

        return Response.json({ accepted: result.accepted });
      },
      {
        body: magicLinkRequestBody,
        response: { 200: magicLinkAcceptedResponse },
        detail: {
          tags: ["Auth"],
          summary: "Request a passwordless sign in link",
        },
      },
    )
    .get(
      "/internal/auth/verify",
      async ({ query }) => {
        try {
          const session = await service.verifyMagicLink(query.token);
          const headers = new Headers({
            Location: service.createVerifyRedirect(),
          });
          headers.append(
            "Set-Cookie",
            serializeSessionCookie(
              cookieName,
              session.sessionToken,
              session.absoluteExpiresAt,
              cookieSecure,
            ),
          );
          return new Response(null, { status: 302, headers });
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return Response.redirect(service.createVerifyErrorRedirect(), 302);
          }

          throw error;
        }
      },
      {
        query: magicLinkQuery,
        detail: {
          tags: ["Auth"],
          summary: "Consume a passwordless sign in link",
        },
      },
    )
    .get(
      "/internal/auth/session",
      async ({ request }) =>
        Response.json(
          await service.getSession(
            readCookie(request.headers.get("cookie"), cookieName),
          ),
        ),
      {
        response: { 200: sessionResponse },
        detail: {
          tags: ["Auth"],
          summary: "Return the current browser session",
        },
      },
    )
    .post(
      "/internal/auth/logout",
      async ({ request }) => {
        await service.logout(
          readCookie(request.headers.get("cookie"), cookieName),
        );
        return new Response(null, {
          status: 204,
          headers: {
            "Set-Cookie": clearSessionCookie(cookieName, cookieSecure),
          },
        });
      },
      {
        detail: {
          tags: ["Auth"],
          summary: "Revoke the current browser session",
        },
      },
    );
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");

    if (key === name) {
      return value.join("=");
    }
  }

  return undefined;
}

function serializeSessionCookie(
  name: string,
  value: string,
  expiresAt: Date,
  secure: boolean,
): string {
  return [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
    "Max-Age=604800",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function clearSessionCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}
