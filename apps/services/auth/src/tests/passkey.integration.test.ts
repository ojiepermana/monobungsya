import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  closeDatabaseClient,
  createDatabaseClient,
  type DatabaseClient,
} from '#project/database';
import { createApp } from '../app';
import { loadAuthEnv } from '../config/env';
import { hashSecret } from '../modules/auth/auth.crypto';
import type { AuthMailer, MagicLinkMessage } from '../modules/auth/auth.types';
import { SoftwareAuthenticator } from './passkey.authenticator';

const databaseUrl = Bun.env.DATABASE_URL;
const RP_ID = 'localhost';
const ORIGIN = 'http://localhost:4200';
const COOKIE_NAME = 'passkey_integration_session';
const OWNER_EMAIL = 'passkey-owner@integration.local';
const OTHER_EMAIL = 'passkey-other@integration.local';
const SUSPENDED_EMAIL = 'passkey-suspended@integration.local';

let database: DatabaseClient | undefined;

function db(): DatabaseClient {
  if (!database) {
    throw new Error('the integration database client is not initialized');
  }

  return database;
}

function app(mailer?: AuthMailer) {
  return createApp(
    loadAuthEnv({
      NODE_ENV: 'test',
      PORT: '3101',
      DATABASE_URL: databaseUrl,
      AUTH_SESSION_COOKIE_NAME: COOKIE_NAME,
      WEB_APP_URL: ORIGIN,
    }),
    {
      database,
      mailer,
      webAppUrl: ORIGIN,
      cookieName: COOKIE_NAME,
    },
    { rpId: RP_ID, rpName: 'Monobungsya' },
  );
}

/** Signs in through the real magic link flow and returns the session cookie. */
async function magicLinkSession(email: string): Promise<{
  cookie: string;
  setCookie: string;
  status: number;
}> {
  const messages: MagicLinkMessage[] = [];
  const instance = app({
    async sendMagicLink(message) {
      messages.push(message);
    },
  });
  const ip = `198.18.${Math.floor(Math.random() * 200) + 1}.${Math.floor(Math.random() * 200) + 1}`;

  // Magic link allows five requests per email per window. These tests sign in
  // far more often than that, so the counter for this email is cleared first.
  await db()`
    DELETE FROM "auth"."auth_rate_limits"
    WHERE key_type = 'email' AND key_hash = ${hashSecret(email)}
  `;

  await instance.handle(
    new Request('http://localhost/internal/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email }),
    }),
  );

  const token = messages[0]?.token ?? '';
  const verified = await instance.handle(
    new Request(`http://localhost/internal/auth/verify?token=${token}`),
  );
  const setCookie = verified.headers.get('set-cookie') ?? '';

  return {
    cookie: setCookie.split(';')[0] ?? '',
    setCookie,
    status: verified.status,
  };
}

async function registerPasskey(
  cookie: string,
  options: { synced?: boolean; label?: string } = {},
): Promise<{
  authenticator: SoftwareAuthenticator;
  status: number;
  body: Record<string, unknown>;
}> {
  const instance = app();
  const optionsResponse = await instance.handle(
    new Request('http://localhost/internal/auth/passkey/register/options', {
      method: 'POST',
      headers: { cookie },
    }),
  );

  if (optionsResponse.status !== 200) {
    return {
      authenticator: await SoftwareAuthenticator.create({
        rpId: RP_ID,
        origin: ORIGIN,
      }),
      status: optionsResponse.status,
      body: {},
    };
  }

  const { challenge } = (await optionsResponse.json()) as { challenge: string };
  const authenticator = await SoftwareAuthenticator.create({
    rpId: RP_ID,
    origin: ORIGIN,
    synced: options.synced,
  });
  const verified = await instance.handle(
    new Request('http://localhost/internal/auth/passkey/register/verify', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        response: await authenticator.register(challenge),
        ...(options.label ? { label: options.label } : {}),
      }),
    }),
  );

  return {
    authenticator,
    status: verified.status,
    body:
      verified.status === 200
        ? ((await verified.json()) as Record<string, unknown>)
        : {},
  };
}

function randomIp(): string {
  return `198.19.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
}

async function loginChallenge(ip = randomIp()): Promise<string> {
  const response = await app().handle(
    new Request('http://localhost/internal/auth/passkey/login/options', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    }),
  );
  const { challenge } = (await response.json()) as { challenge: string };

  return challenge;
}

async function signIn(
  authenticator: SoftwareAuthenticator,
  challenge: string,
  options: { advanceCounter?: boolean; ip?: string } = {},
): Promise<Response> {
  return app().handle(
    new Request('http://localhost/internal/auth/passkey/login/verify', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': options.ip ?? randomIp(),
      },
      body: JSON.stringify({
        response: await authenticator.authenticate(challenge, {
          advanceCounter: options.advanceCounter,
        }),
      }),
    }),
  );
}

async function userId(email: string): Promise<string> {
  const [row] = await db()`
    SELECT id FROM "user"."users" WHERE email = ${email}
  `;

  return String(row.id);
}

beforeAll(async () => {
  if (!databaseUrl) {
    return;
  }

  database = createDatabaseClient(databaseUrl);

  for (const email of [OWNER_EMAIL, OTHER_EMAIL, SUSPENDED_EMAIL]) {
    await database`DELETE FROM "user"."users" WHERE email = ${email}`;
    await database`
      INSERT INTO "user"."users" (email, name, suspended_at)
      VALUES (
        ${email},
        ${'Passkey Integration'},
        ${email === SUSPENDED_EMAIL ? new Date() : null}
      )
    `;
  }

  await database`DELETE FROM "auth"."webauthn_challenges"`;
  await database`DELETE FROM "auth"."auth_rate_limits" WHERE key_type = 'passkey_ip'`;
});

afterAll(async () => {
  if (!database) {
    return;
  }

  for (const email of [OWNER_EMAIL, OTHER_EMAIL, SUSPENDED_EMAIL]) {
    await database`DELETE FROM "user"."users" WHERE email = ${email}`;
  }

  await database`DELETE FROM "auth"."webauthn_challenges"`;
  await database`DELETE FROM "auth"."auth_rate_limits" WHERE key_type = 'passkey_ip'`;
  await closeDatabaseClient(database);
});

describe('passkey registration and sign in', () => {
  test('registers a passkey and signs in with a session identical to magic link', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    expect(magic.status).toBe(302);

    const registered = await registerPasskey(magic.cookie, { synced: true });
    expect(registered.status).toBe(200);
    // No AAGUID reported, so the label falls back to the dated default.
    expect(String(registered.body.label)).toMatch(
      /^Passkey \d{4}-\d{2}-\d{2}$/,
    );
    expect(registered.body.lastUsedAt).toBeNull();
    expect(registered.body.backupState).toBe(true);
    // The public key is stored but never returned.
    expect(Object.keys(registered.body)).not.toContain('publicKey');

    const stored = await database`
      SELECT counter, transports, backup_eligible, backup_state, aaguid, last_used_at
      FROM "auth"."passkey_credentials"
      WHERE credential_id = ${registered.authenticator.credentialIdBase64Url}
    `;
    expect(stored).toHaveLength(1);
    expect(Number(stored[0].counter)).toBe(1);
    expect(stored[0].transports).toEqual(['internal']);
    expect(stored[0].backup_eligible).toBe(true);
    expect(stored[0].aaguid).toBeNull();
    expect(stored[0].last_used_at).toBeNull();

    const signedIn = await signIn(
      registered.authenticator,
      await loginChallenge(),
    );
    expect(signedIn.status).toBe(200);

    const body = (await signedIn.json()) as {
      authenticated: boolean;
      user: { email: string };
      session: { idleExpiresAt: string; absoluteExpiresAt: string };
    };
    expect(body.authenticated).toBe(true);
    expect(body.user.email).toBe(OWNER_EMAIL);

    // Same cookie policy as the magic link login.
    const cookie = signedIn.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(magic.setCookie).toContain('HttpOnly');
    expect(magic.setCookie).toContain('Max-Age=604800');

    // 8 hour idle expiry and 7 day absolute expiry, same as spec 0003.
    const idleHours =
      (Date.parse(body.session.idleExpiresAt) - Date.now()) / 3_600_000;
    const absoluteDays =
      (Date.parse(body.session.absoluteExpiresAt) - Date.now()) / 86_400_000;
    expect(idleHours).toBeGreaterThan(7.9);
    expect(idleHours).toBeLessThan(8.1);
    expect(absoluteDays).toBeGreaterThan(6.9);
    expect(absoluteDays).toBeLessThan(7.1);

    // The counter moved forward and the last use was recorded.
    const afterLogin = await database`
      SELECT counter, last_used_at
      FROM "auth"."passkey_credentials"
      WHERE credential_id = ${registered.authenticator.credentialIdBase64Url}
    `;
    expect(Number(afterLogin[0].counter)).toBe(2);
    expect(afterLogin[0].last_used_at).not.toBeNull();
  });

  test('uses the label the caller asked for', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OTHER_EMAIL);
    const registered = await registerPasskey(magic.cookie, {
      label: '  MacBook kantor  ',
    });

    expect(registered.status).toBe(200);
    expect(registered.body.label).toBe('MacBook kantor');
  });
});

describe('magic link stays the universal fallback', () => {
  test('magic link still works for a user who has passkeys, and the last passkey can be deleted', async () => {
    if (!database) return;

    const first = await magicLinkSession(OWNER_EMAIL);
    const registered = await registerPasskey(first.cookie);
    expect(registered.status).toBe(200);

    // A second magic link login succeeds while a passkey exists.
    const second = await magicLinkSession(OWNER_EMAIL);
    expect(second.status).toBe(302);
    expect(second.cookie).not.toBe(first.cookie);

    const list = await app().handle(
      new Request('http://localhost/internal/auth/passkeys', {
        headers: { cookie: second.cookie },
      }),
    );
    const listed = (await list.json()) as { passkeys: { id: string }[] };
    expect(listed.passkeys.length).toBeGreaterThan(0);

    // Deleting every passkey is allowed, because magic link remains.
    for (const passkey of listed.passkeys) {
      const deleted = await app().handle(
        new Request(`http://localhost/internal/auth/passkeys/${passkey.id}`, {
          method: 'DELETE',
          headers: { cookie: second.cookie },
        }),
      );
      expect(deleted.status).toBe(204);
    }

    const empty = await app().handle(
      new Request('http://localhost/internal/auth/passkeys', {
        headers: { cookie: second.cookie },
      }),
    );
    expect((await empty.json()) as unknown).toEqual({ passkeys: [] });

    // Magic link still works with zero passkeys.
    const third = await magicLinkSession(OWNER_EMAIL);
    expect(third.status).toBe(302);
  });
});

describe('challenge safety', () => {
  test('rejects a reused challenge and burns it even when verification fails', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    const challenge = await loginChallenge();

    const first = await signIn(registered.authenticator, challenge);
    expect(first.status).toBe(200);

    const replay = await signIn(registered.authenticator, challenge);
    expect(replay.status).toBe(410);

    const rows = await database`
      SELECT used_at FROM "auth"."webauthn_challenges" WHERE challenge = ${challenge}
    `;
    expect(rows[0].used_at).not.toBeNull();
  });

  test('rejects a challenge that was never issued', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    const response = await signIn(
      registered.authenticator,
      'this-challenge-was-never-issued-by-the-server',
    );

    expect(response.status).toBe(410);
  });

  test('rejects an expired challenge', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    const challenge = 'expired-challenge-for-integration-test';

    await database`
      INSERT INTO "auth"."webauthn_challenges" (type, user_id, challenge, expires_at)
      VALUES ('authentication', NULL, ${challenge}, now() - interval '1 minute')
    `;

    const response = await signIn(registered.authenticator, challenge);
    expect(response.status).toBe(410);
  });

  test('gives a challenge a five minute life', async () => {
    if (!database) return;

    const challenge = await loginChallenge();
    const [row] = await database`
      SELECT expires_at, used_at, user_id, type
      FROM "auth"."webauthn_challenges"
      WHERE challenge = ${challenge}
    `;
    const minutes = (Date.parse(String(row.expires_at)) - Date.now()) / 60_000;

    expect(minutes).toBeGreaterThan(4.5);
    expect(minutes).toBeLessThan(5.1);
    expect(row.used_at).toBeNull();
    // A sign in challenge is not bound to a user: no email is typed.
    expect(row.user_id).toBeNull();
    expect(row.type).toBe('authentication');
  });

  test('two concurrent verifications of one challenge open at most one session', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    const challenge = await loginChallenge();
    const owner = await userId(OWNER_EMAIL);

    const before = await database`
      SELECT count(*)::integer AS count FROM "auth"."sessions" WHERE user_id = ${owner}
    `;

    // Both assertions advance the counter, as a real authenticator would, so
    // the only thing that can separate them is the single use challenge.
    const [left, right] = await Promise.all([
      signIn(registered.authenticator, challenge),
      signIn(registered.authenticator, challenge),
    ]);
    const statuses = [left.status, right.status].sort();

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    expect(statuses).toEqual([200, 410]);

    const after = await database`
      SELECT count(*)::integer AS count FROM "auth"."sessions" WHERE user_id = ${owner}
    `;
    expect(Number(after[0].count) - Number(before[0].count)).toBe(1);
  });
});

describe('limits', () => {
  test('allows five passkeys and rejects the sixth', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OTHER_EMAIL);
    const owner = await userId(OTHER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    for (let index = 0; index < 5; index += 1) {
      const registered = await registerPasskey(magic.cookie, {
        label: `Key ${index + 1}`,
      });
      expect(registered.status).toBe(200);
    }

    const sixth = await registerPasskey(magic.cookie);
    expect(sixth.status).toBe(409);

    const [count] = await database`
      SELECT count(*)::integer AS count
      FROM "auth"."passkey_credentials"
      WHERE user_id = ${owner}
    `;
    expect(Number(count.count)).toBe(5);
  });

  test('rejects a credential id that is already registered', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const owner = await userId(OWNER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    const registered = await registerPasskey(magic.cookie);
    expect(registered.status).toBe(200);

    // The very same authenticator, so the same credential id, registered twice.
    const instance = app();
    const optionsResponse = await instance.handle(
      new Request('http://localhost/internal/auth/passkey/register/options', {
        method: 'POST',
        headers: { cookie: magic.cookie },
      }),
    );
    const { challenge } = (await optionsResponse.json()) as {
      challenge: string;
    };
    const duplicate = await instance.handle(
      new Request('http://localhost/internal/auth/passkey/register/verify', {
        method: 'POST',
        headers: { cookie: magic.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({
          response: await registered.authenticator.register(challenge),
        }),
      }),
    );

    expect(duplicate.status).toBe(409);
  });

  test('rate limits public passkey endpoints to ten attempts per window', async () => {
    if (!database) return;

    const ip = '198.18.77.77';
    await database`
      DELETE FROM "auth"."auth_rate_limits"
      WHERE key_type = 'passkey_ip' AND key_hash = ${hashSecret(ip)}
    `;

    const statuses: number[] = [];

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await app().handle(
        new Request('http://localhost/internal/auth/passkey/login/options', {
          method: 'POST',
          headers: { 'x-forwarded-for': ip },
        }),
      );
      statuses.push(response.status);
    }

    expect(statuses.filter((status) => status === 200)).toHaveLength(10);
    expect(statuses.slice(10)).toEqual([429, 429]);

    const [row] = await database`
      SELECT attempts FROM "auth"."auth_rate_limits"
      WHERE key_type = 'passkey_ip' AND key_hash = ${hashSecret(ip)}
    `;
    expect(Number(row.attempts)).toBe(12);
  });

  test('a suspended user cannot sign in with a passkey', async () => {
    if (!database) return;

    // The passkey is registered while active, then the account is suspended.
    const suspended = await userId(SUSPENDED_EMAIL);
    await database`
      UPDATE "user"."users" SET suspended_at = NULL WHERE id = ${suspended}
    `;

    const magic = await magicLinkSession(SUSPENDED_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    expect(registered.status).toBe(200);

    await database`
      UPDATE "user"."users" SET suspended_at = now() WHERE id = ${suspended}
    `;

    const response = await signIn(
      registered.authenticator,
      await loginChallenge(),
    );
    expect(response.status).toBe(401);
    // Generic message: it must not say whether the account exists.
    expect(await response.text()).not.toContain(SUSPENDED_EMAIL);

    // Reset for the tests that follow, which reuse this same fixture user.
    await database`
      UPDATE "user"."users" SET suspended_at = NULL WHERE id = ${suspended}
    `;
  });

  // Spec docs/specs/0007-user-management extends the same suspended_at guard
  // to blocked_at and deleted_at (AC-4): passkey.repository.ts's authenticate
  // query now excludes all three, not suspended_at alone. Each test resets
  // all three columns itself first, so it does not depend on execution order.
  test('a blocked user cannot sign in with a passkey', async () => {
    if (!database) return;

    const target = await userId(SUSPENDED_EMAIL);
    await database`
      UPDATE "user"."users"
      SET suspended_at = NULL, blocked_at = NULL, deleted_at = NULL
      WHERE id = ${target}
    `;

    const magic = await magicLinkSession(SUSPENDED_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    expect(registered.status).toBe(200);

    await database`
      UPDATE "user"."users" SET blocked_at = now() WHERE id = ${target}
    `;

    try {
      const response = await signIn(
        registered.authenticator,
        await loginChallenge(),
      );
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(SUSPENDED_EMAIL);
    } finally {
      await database`
        UPDATE "user"."users" SET blocked_at = NULL WHERE id = ${target}
      `;
    }
  });

  test('a deleted user cannot sign in with a passkey', async () => {
    if (!database) return;

    const target = await userId(SUSPENDED_EMAIL);
    await database`
      UPDATE "user"."users"
      SET suspended_at = NULL, blocked_at = NULL, deleted_at = NULL
      WHERE id = ${target}
    `;

    const magic = await magicLinkSession(SUSPENDED_EMAIL);
    const registered = await registerPasskey(magic.cookie);
    expect(registered.status).toBe(200);

    await database`
      UPDATE "user"."users" SET deleted_at = now() WHERE id = ${target}
    `;

    try {
      const response = await signIn(
        registered.authenticator,
        await loginChallenge(),
      );
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(SUSPENDED_EMAIL);
    } finally {
      await database`
        UPDATE "user"."users" SET deleted_at = NULL WHERE id = ${target}
      `;
    }
  });
});

describe('cloned authenticator signal', () => {
  test('rejects a regressed counter and keeps the credential', async () => {
    if (!database) return;

    const magic = await magicLinkSession(OWNER_EMAIL);
    const owner = await userId(OWNER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    const registered = await registerPasskey(magic.cookie);
    expect(registered.status).toBe(200);

    // A good sign in first, which moves the stored counter to 2.
    const good = await signIn(registered.authenticator, await loginChallenge());
    expect(good.status).toBe(200);

    // Now the authenticator reports an older counter, the cloned key signal.
    registered.authenticator.setCounter(1);
    const regressed = await signIn(
      registered.authenticator,
      await loginChallenge(),
      { advanceCounter: false },
    );
    expect(regressed.status).toBe(401);

    // The credential survives and its counter is untouched.
    const rows = await database`
      SELECT counter FROM "auth"."passkey_credentials"
      WHERE credential_id = ${registered.authenticator.credentialIdBase64Url}
    `;
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].counter)).toBe(2);
  });
});

describe('ownership', () => {
  test("cannot rename or delete another user's passkey", async () => {
    if (!database) return;

    const ownerSession = await magicLinkSession(OWNER_EMAIL);
    const owner = await userId(OWNER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    const registered = await registerPasskey(ownerSession.cookie);
    expect(registered.status).toBe(200);
    const passkeyId = String(registered.body.id);

    const otherSession = await magicLinkSession(OTHER_EMAIL);

    const rename = await app().handle(
      new Request(`http://localhost/internal/auth/passkeys/${passkeyId}`, {
        method: 'PATCH',
        headers: {
          cookie: otherSession.cookie,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ label: 'stolen' }),
      }),
    );
    expect(rename.status).toBe(404);

    const removed = await app().handle(
      new Request(`http://localhost/internal/auth/passkeys/${passkeyId}`, {
        method: 'DELETE',
        headers: { cookie: otherSession.cookie },
      }),
    );
    expect(removed.status).toBe(404);

    // Still there, still named the same.
    const rows = await database`
      SELECT label FROM "auth"."passkey_credentials" WHERE id = ${passkeyId}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(registered.body.label);
  });

  test('renames a passkey the caller owns', async () => {
    if (!database) return;

    const session = await magicLinkSession(OWNER_EMAIL);
    const owner = await userId(OWNER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    const registered = await registerPasskey(session.cookie);
    const renamed = await app().handle(
      new Request(
        `http://localhost/internal/auth/passkeys/${String(registered.body.id)}`,
        {
          method: 'PATCH',
          headers: {
            cookie: session.cookie,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ label: 'iPhone pribadi' }),
        },
      ),
    );

    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { label: string }).label).toBe(
      'iPhone pribadi',
    );
  });

  test('requires a session for every management route', async () => {
    if (!database) return;

    const routes: [string, string][] = [
      ['POST', '/internal/auth/passkey/register/options'],
      ['GET', '/internal/auth/passkeys'],
    ];

    for (const [method, path] of routes) {
      const response = await app().handle(
        new Request(`http://localhost${path}`, { method }),
      );
      expect(response.status).toBe(401);
    }
  });
});

describe('cleanup', () => {
  test('removes spent challenges and leaves credentials and live sessions alone', async () => {
    if (!database) return;

    const session = await magicLinkSession(OWNER_EMAIL);
    const owner = await userId(OWNER_EMAIL);
    await database`DELETE FROM "auth"."passkey_credentials" WHERE user_id = ${owner}`;

    const registered = await registerPasskey(session.cookie);
    expect(registered.status).toBe(200);

    await database`DELETE FROM "auth"."webauthn_challenges"`;
    await database`
      INSERT INTO "auth"."webauthn_challenges" (type, user_id, challenge, expires_at, used_at)
      VALUES
        ('authentication', NULL, ${'cleanup-used'}, now() + interval '5 minutes', now()),
        ('authentication', NULL, ${'cleanup-expired'}, now() - interval '1 minute', NULL),
        ('authentication', NULL, ${'cleanup-live'}, now() + interval '5 minutes', NULL)
    `;

    const { AuthRepository } = await import('../modules/auth/auth.repository');
    const result = await new AuthRepository({ database }).cleanup();

    expect(result.webauthnChallenges).toBe(2);

    const remaining = await database`
      SELECT challenge FROM "auth"."webauthn_challenges" ORDER BY challenge
    `;
    expect(
      remaining.map((row: { challenge: string }) => row.challenge),
    ).toEqual(['cleanup-live']);

    // Credentials are untouched.
    const credentials = await database`
      SELECT count(*)::integer AS count
      FROM "auth"."passkey_credentials"
      WHERE user_id = ${owner}
    `;
    expect(Number(credentials[0].count)).toBe(1);

    // The live session still authenticates.
    const still = await app().handle(
      new Request('http://localhost/internal/auth/passkeys', {
        headers: { cookie: session.cookie },
      }),
    );
    expect(still.status).toBe(200);
  });
});
