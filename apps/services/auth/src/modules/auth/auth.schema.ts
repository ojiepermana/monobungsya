import { t } from 'elysia';

export const authStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal('ok'),
  module: t.Literal('auth'),
});

export const magicLinkRequestBody = t.Object({
  email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
});

export const magicLinkQuery = t.Object({
  token: t.String({ minLength: 20, maxLength: 512 }),
});

export const magicLinkAcceptedResponse = t.Object({
  accepted: t.Literal(true),
});

export const sessionResponse = t.Object({
  authenticated: t.Boolean(),
  sessionObservation: t.Optional(
    t.Object({
      state: t.Union([
        t.Literal('authenticated'),
        t.Literal('anonymous'),
        t.Literal('invalid'),
      ]),
      reason: t.Union([
        t.Literal('missing_cookie'),
        t.Literal('unknown_session'),
        t.Literal('revoked'),
        t.Literal('absolute_expired'),
        t.Literal('idle_expired'),
        t.Literal('user_missing'),
        t.Literal('user_deleted'),
        t.Literal('user_blocked'),
        t.Literal('user_suspended'),
        t.Null(),
      ]),
      role: t.Union([t.String(), t.Null()]),
      permissionCount: t.Integer(),
    }),
  ),
  user: t.Optional(
    t.Object({
      id: t.String(),
      email: t.String(),
      name: t.String(),
      role: t.String(),
      permissions: t.Array(t.String()),
    }),
  ),
  session: t.Optional(
    t.Object({
      id: t.String(),
      idleExpiresAt: t.String(),
      absoluteExpiresAt: t.String(),
    }),
  ),
});

export const identityResponse = t.Object({
  userId: t.String(),
  email: t.String(),
  role: t.String(),
  expiresAt: t.String(),
});
