import { t } from 'elysia';

export const authStatusResponse = t.Object({
  service: t.String(),
  status: t.Literal('ok'),
  module: t.Literal('auth'),
});

export const magicLinkRequestBody = t.Object({
  email: t.String({ format: 'email', minLength: 3, maxLength: 255 }),
  desktop: t.Optional(t.Literal(true)),
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
      permissionCount: t.Integer(),
    }),
  ),
  user: t.Optional(
    t.Object({
      id: t.String(),
      email: t.String(),
      name: t.String(),
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
  expiresAt: t.String(),
});

const sixDigitCode = t.String({ pattern: '^[0-9]{6}$' });
const recoveryCode = t.String({ minLength: 8, maxLength: 32 });

export const totpCodeBody = t.Object({ code: sixDigitCode });
export const totpFactorBody = t.Object({
  code: t.Optional(sixDigitCode),
  recoveryCode: t.Optional(recoveryCode),
});
export const totpVerifyBody = t.Object({
  code: t.Optional(sixDigitCode),
  recoveryCode: t.Optional(recoveryCode),
});
export const totpReasonBody = t.Object({
  reason: t.String({ minLength: 3, maxLength: 500 }),
});
export const userIdParams = t.Object({ id: t.String({ format: 'uuid' }) });

export const totpEnrollmentResponse = t.Object({
  secret: t.String(),
  otpauthUri: t.String(),
});
export const totpRecoveryCodesResponse = t.Object({
  recoveryCodes: t.Array(t.String()),
});
export const totpVerifyResponse = t.Object({
  authenticated: t.Literal(true),
  redirectTo: t.String(),
});
export const totpStatusResponse = t.Object({
  enabled: t.Boolean(),
  confirmedAt: t.Union([t.String(), t.Null()]),
  required: t.Boolean(),
  recoveryCodesRemaining: t.Integer(),
});
export const totpOkResponse = t.Object({ ok: t.Literal(true) });
