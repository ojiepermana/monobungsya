import { t } from 'elysia';

/**
 * The ceremony payloads are passed through to the WebAuthn library, which does
 * the strict structural checks. The schemas here keep the OpenAPI contract
 * honest and reject obvious junk early.
 */
const webAuthnResponse = t.Object(
  {
    id: t.String({ minLength: 1, maxLength: 1024 }),
    rawId: t.String({ minLength: 1, maxLength: 1024 }),
    type: t.String({ minLength: 1, maxLength: 32 }),
    response: t.Record(t.String(), t.Unknown()),
    clientExtensionResults: t.Optional(t.Record(t.String(), t.Unknown())),
    authenticatorAttachment: t.Optional(t.String({ maxLength: 32 })),
  },
  { additionalProperties: true },
);

export const passkeyLabel = t.String({ minLength: 1, maxLength: 100 });

export const passkeyRegisterVerifyBody = t.Object({
  response: webAuthnResponse,
  label: t.Optional(passkeyLabel),
});

export const passkeyLoginVerifyBody = t.Object({
  response: webAuthnResponse,
});

export const passkeyRenameBody = t.Object({
  label: passkeyLabel,
});

export const passkeyIdParams = t.Object({
  id: t.String({ format: 'uuid' }),
});

/** Ceremony options come straight from the WebAuthn library. */
export const passkeyCeremonyOptionsResponse = t.Record(t.String(), t.Unknown());

export const passkeySummaryResponse = t.Object({
  id: t.String(),
  label: t.String(),
  createdAt: t.String(),
  lastUsedAt: t.Union([t.String(), t.Null()]),
  backupState: t.Boolean(),
});

export const passkeyListResponse = t.Object({
  passkeys: t.Array(passkeySummaryResponse),
});

export const passkeyLoginResponse = t.Object({
  authenticated: t.Literal(true),
  user: t.Object({
    id: t.String(),
    email: t.String(),
    name: t.String(),
    role: t.String(),
  }),
  session: t.Object({
    id: t.String(),
    idleExpiresAt: t.String(),
    absoluteExpiresAt: t.String(),
  }),
});
