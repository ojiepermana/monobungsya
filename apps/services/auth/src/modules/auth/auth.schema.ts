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
  user: t.Optional(
    t.Object({
      id: t.String(),
      email: t.String(),
      name: t.String(),
      role: t.String(),
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
