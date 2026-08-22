import { describe, expect, it } from 'bun:test';
import { type AddressInfo, createServer } from 'node:net';
import { loadEnv } from '#project/config';
import { signAuthIdentity } from '#project/contracts';
import type { DatabaseClient } from '#project/database';
import { createApp } from '../app';
import { SmtpAuthMailer } from '../modules/auth/auth.mailer';
import { permissionsForRole } from '../modules/auth/auth.service';

function createFakeDatabase(
  rows: Array<Record<string, unknown>>,
): DatabaseClient {
  return {
    unsafe: async () => rows,
  } as unknown as DatabaseClient;
}

describe('auth service', () => {
  it('exposes health and module status endpoints', async () => {
    const app = createApp(loadEnv('auth', { NODE_ENV: 'test', PORT: '3101' }));

    const health = await app.handle(new Request('http://localhost/health'));
    const moduleStatus = await app.handle(
      new Request('http://localhost/internal/auth/status'),
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'auth' });
    expect(moduleStatus.status).toBe(200);
    expect(await moduleStatus.json()).toEqual({
      service: 'auth',
      status: 'ok',
      module: 'auth',
    });
  });

  it('returns the shared error envelope for unsigned internal identity', async () => {
    const app = createApp(loadEnv('auth', { NODE_ENV: 'test', PORT: '3101' }));

    const response = await app.handle(
      new Request('http://localhost/internal/auth/identity', {
        headers: { 'x-request-id': 'request-123' },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHORIZED',
        message: 'A valid signed identity is required',
        requestId: 'request-123',
      },
    });
  });

  it('sends magic links through SMTP without local credentials', async () => {
    const commands: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding('utf8');
      socket.write('220 localhost ESMTP\r\n');

      let buffer = '';
      let readingMessage = false;

      socket.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\r\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line) continue;

          if (readingMessage) {
            if (line === '.') {
              readingMessage = false;
              socket.write('250 2.0.0 Queued\r\n');
            }
            continue;
          }

          commands.push(line);

          if (/^(EHLO|HELO)/.test(line)) {
            socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
          } else if (line === 'DATA') {
            readingMessage = true;
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          } else if (line === 'QUIT') {
            socket.write('221 2.0.0 Bye\r\n');
            socket.end();
          } else {
            socket.write('250 2.0.0 OK\r\n');
          }
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;

    try {
      const mailer = new SmtpAuthMailer({
        host: '127.0.0.1',
        port: address.port,
        username: 'monobungsia',
        password: '',
        from: 'no-reply@localhost',
        publicApiUrl: 'http://localhost:3000',
        webAppUrl: 'http://localhost:4200',
      });

      await mailer.sendMagicLink({
        recipient: 'system@project.local',
        recipientName: 'System User',
        token: 'token-with-more-than-twenty-characters',
        expiresAt: new Date('2026-08-21T03:00:00.000Z'),
      });

      expect(commands.some((command) => command.startsWith('AUTH'))).toBe(
        false,
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe('permissionsForRole (covers AC-5 of spec logs/0001)', () => {
  it('grants users.manage and logs.read to admin and manager', () => {
    expect(permissionsForRole('admin')).toEqual(['users.manage', 'logs.read']);
    expect(permissionsForRole('manager')).toEqual([
      'users.manage',
      'logs.read',
    ]);
  });

  it('grants no permissions to staff, bi, and legacy', () => {
    expect(permissionsForRole('staff')).toEqual([]);
    expect(permissionsForRole('bi')).toEqual([]);
    expect(permissionsForRole('legacy')).toEqual([]);
  });
});

describe('auth user administration', () => {
  it('lists users for a signed admin identity', async () => {
    const secret = 'auth-service-signing-secret';
    const identity = {
      userId: '0198f8a0-0000-7000-8000-000000000001',
      email: 'admin@project.local',
      role: 'admin' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const signature = signAuthIdentity(
      'GET',
      '/internal/auth/users',
      identity,
      secret,
    );
    const app = createApp(loadEnv('auth', { NODE_ENV: 'test', PORT: '3101' }), {
      database: createFakeDatabase([
        {
          id: '0198f8a0-0000-7000-8000-000000000002',
          name: 'System User',
          email: 'system@project.local',
          role: 'admin',
          suspended_at: null,
        },
      ]),
      signingSecret: secret,
    });

    const response = await app.handle(
      new Request('http://localhost/internal/auth/users?search=system', {
        headers: {
          'x-auth-user-id': identity.userId,
          'x-auth-email': identity.email,
          'x-auth-role': identity.role,
          'x-auth-expires-at': identity.expiresAt,
          'x-auth-signature': signature,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          id: '0198f8a0-0000-7000-8000-000000000002',
          name: 'System User',
          email: 'system@project.local',
          role: 'admin',
          suspendedAt: null,
        },
      ],
    });
  });
});
