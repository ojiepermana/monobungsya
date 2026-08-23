import { describe, expect, test } from 'bun:test';
import { closeDatabaseClient, createDatabaseClient } from '#project/database';
import { createApp } from '../app';
import { loadAuthEnv } from '../config/env';
import { hashSecret } from '../modules/auth/auth.crypto';
import type { AuthMailer, MagicLinkMessage } from '../modules/auth/auth.types';

const databaseUrl = Bun.env.DATABASE_URL;

describe('auth magic link integration', () => {
  test('runs the magic link and session lifecycle', async () => {
    if (!databaseUrl) {
      return;
    }

    const database = createDatabaseClient(databaseUrl);
    const messages: MagicLinkMessage[] = [];
    const mailer: AuthMailer = {
      async sendMagicLink(message) {
        messages.push(message);
      },
    };
    const ipAddress = '198.51.100.42';
    const emailHash = hashSecret('admin@local.app');
    const ipHash = hashSecret(ipAddress);

    await database`
      DELETE FROM "auth"."auth_rate_limits"
      WHERE (key_type = 'email' AND key_hash = ${emailHash})
         OR (key_type = 'ip' AND key_hash = ${ipHash})
    `;

    const app = createApp(
      loadAuthEnv({
        NODE_ENV: 'test',
        PORT: '3101',
        DATABASE_URL: databaseUrl,
        AUTH_SESSION_COOKIE_NAME: 'integration_session',
      }),
      {
        database,
        mailer,
        webAppUrl: 'http://localhost:4200',
        cookieName: 'integration_session',
      },
    );

    try {
      const request = await app.handle(
        new Request('http://localhost/internal/auth/magic-link', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ipAddress,
          },
          body: JSON.stringify({ email: 'ADMIN@LOCAL.APP' }),
        }),
      );

      expect(request.status).toBe(200);
      expect(await request.json()).toEqual({ accepted: true });
      expect(messages).toHaveLength(1);

      const verification = await app.handle(
        new Request(
          `http://localhost/internal/auth/verify?token=${encodeURIComponent(messages[0]?.token ?? '')}`,
        ),
      );
      const cookie = verification.headers.get('set-cookie');

      expect(verification.status).toBe(302);
      expect(verification.headers.get('location')).toBe(
        'http://localhost:4200/auth/callback-complete',
      );
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');

      const session = await app.handle(
        new Request('http://localhost/internal/auth/session', {
          headers: { cookie: cookie?.split(';')[0] ?? '' },
        }),
      );
      const sessionBody = await session.json();

      expect(session.status).toBe(200);
      expect(sessionBody.authenticated).toBe(true);
      expect(sessionBody.user.email).toBe('admin@local.app');

      const replay = await app.handle(
        new Request(
          `http://localhost/internal/auth/verify?token=${encodeURIComponent(messages[0]?.token ?? '')}`,
        ),
      );

      expect(replay.status).toBe(302);
      expect(replay.headers.get('location')).toBe(
        'http://localhost:4200/auth/callback-error',
      );

      const logout = await app.handle(
        new Request('http://localhost/internal/auth/logout', {
          method: 'POST',
          headers: { cookie: cookie?.split(';')[0] ?? '' },
        }),
      );

      expect(logout.status).toBe(204);
    } finally {
      await database`
        DELETE FROM "auth"."auth_rate_limits"
        WHERE (key_type = 'email' AND key_hash = ${emailHash})
           OR (key_type = 'ip' AND key_hash = ${ipHash})
      `;
      await closeDatabaseClient(database);
    }
  });

  test('returns 429 after five requests for the same email and IP window', async () => {
    if (!databaseUrl) {
      return;
    }

    const database = createDatabaseClient(databaseUrl);
    const mailer: AuthMailer = { async sendMagicLink() {} };
    const ipAddress = '198.51.100.43';
    const emailHash = hashSecret('admin@local.app');
    const ipHash = hashSecret(ipAddress);
    const app = createApp(
      loadAuthEnv({
        NODE_ENV: 'test',
        PORT: '3101',
        DATABASE_URL: databaseUrl,
      }),
      { database, mailer, cookieName: 'integration_session' },
    );

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.handle(
          new Request('http://localhost/internal/auth/magic-link', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-forwarded-for': ipAddress,
            },
            body: JSON.stringify({ email: 'admin@local.app' }),
          }),
        );
        expect(response.status).toBe(200);
      }

      const limited = await app.handle(
        new Request('http://localhost/internal/auth/magic-link', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': ipAddress,
          },
          body: JSON.stringify({ email: 'admin@local.app' }),
        }),
      );

      expect(limited.status).toBe(429);
    } finally {
      await database`
        DELETE FROM "auth"."auth_rate_limits"
        WHERE (key_type = 'email' AND key_hash = ${emailHash})
           OR (key_type = 'ip' AND key_hash = ${ipHash})
      `;
      await database`
        DELETE FROM "auth"."login_tokens"
        WHERE user_id = (SELECT id FROM "user"."users" WHERE email = 'admin@local.app')
          AND used_at IS NULL
      `;
      await closeDatabaseClient(database);
    }
  });
});
