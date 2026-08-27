import { describe, expect, it, spyOn } from 'bun:test';
import { type AddressInfo, createServer } from 'node:net';
import { loadEnv } from '#project/config';
import {
  USER_INVITED_SUBJECT,
  type UserInvitedEvent,
} from '#project/contracts';
import { Logger } from '#project/logger';
import type { Subscriber } from '#project/messaging';
import { createApp } from '../app';
import { subscribeUserInvited } from '../modules/auth/auth.events';
import { SmtpAuthMailer } from '../modules/auth/auth.mailer';
import type { AuthRepository } from '../modules/auth/auth.repository';
import { AuthService } from '../modules/auth/auth.service';
import type {
  AuthMailer,
  AuthUser,
  MagicLinkMessage,
} from '../modules/auth/auth.types';

describe('auth service', () => {
  it('returns an unauthenticated result when the session cookie is missing', async () => {
    const service = new AuthService('auth');

    await expect(service.getSession(undefined)).resolves.toEqual({
      authenticated: false,
    });
  });

  it('returns an unauthenticated result for an invalid session', async () => {
    const repository = {
      inspectSession: async () => null,
    } as unknown as AuthRepository;
    const service = new AuthService('auth', repository);

    await expect(service.getSession('invalid-session')).resolves.toEqual({
      authenticated: false,
    });
  });

  it('does not use an unavailable client IP as a shared rate-limit key', async () => {
    let receivedIpHash: string | undefined;
    const repository = {
      issueMagicLink: async (
        _email: string,
        _emailHash: string,
        ipHash: string | undefined,
      ) => {
        receivedIpHash = ipHash;
        return {
          user: null,
          eligibility: 'not_registered' as const,
          rateLimited: false,
        };
      },
    } as unknown as AuthRepository;
    const mailer: AuthMailer = { sendMagicLink: async () => undefined };
    const service = new AuthService('auth', repository, mailer);

    await expect(
      service.requestMagicLink('me@ojiepermana.com', undefined),
    ).resolves.toEqual({
      status: 'gagal',
      keterangan: 'Anda belum terdaftar',
    });
    expect(receivedIpHash).toBeUndefined();
  });

  it('returns the requested login status and only sends mail for active verified users', async () => {
    const outcomes = [
      {
        eligibility: 'not_registered' as const,
        expected: {
          status: 'gagal',
          keterangan: 'Anda belum terdaftar',
        } as const,
        user: null,
      },
      {
        eligibility: 'inactive' as const,
        expected: {
          status: 'gagal',
          keterangan: 'Hubungi admin untuk informasi lebih lanjut',
        } as const,
        user: null,
      },
      {
        eligibility: 'unverified' as const,
        expected: {
          status: 'belum_verifikasi',
          keterangan: 'Email Anda belum diverifikasi',
        } as const,
        user: null,
      },
      {
        eligibility: 'active' as const,
        expected: {
          status: 'berhasil',
          keterangan: 'Silakan login dengan link yang dikirimkan ke email Anda',
        } as const,
        user: {
          id: 'user-1',
          email: 'user@example.com',
          name: 'System User',
          suspendedAt: null,
        },
      },
    ];

    for (const outcome of outcomes) {
      const sent: MagicLinkMessage[] = [];
      const repository = {
        issueMagicLink: async () => ({
          user: outcome.user,
          eligibility: outcome.eligibility,
          rateLimited: false,
        }),
      } as unknown as AuthRepository;
      const service = new AuthService('auth', repository, {
        sendMagicLink: async (message) => {
          sent.push(message);
        },
      });

      await expect(
        service.requestMagicLink('user@example.com', undefined),
      ).resolves.toEqual(outcome.expected);
      expect(sent).toHaveLength(outcome.eligibility === 'active' ? 1 : 0);
    }
  });

  it('returns the authenticated session identity', async () => {
    const repository = {
      inspectSession: async () => ({
        id: '0198f8a0-0000-7000-8000-000000000001',
        email: 'admin@project.local',
        name: 'Admin',
        suspendedAt: null,
        sessionId: 'session-1',
        idleExpiresAt: new Date('2026-08-24T10:00:00.000Z'),
        absoluteExpiresAt: new Date('2026-08-24T18:00:00.000Z'),
      }),
    } as unknown as AuthRepository;
    const service = new AuthService('auth', repository);

    await expect(service.getSession('session-value')).resolves.toEqual({
      authenticated: true,
      user: {
        id: '0198f8a0-0000-7000-8000-000000000001',
        email: 'admin@project.local',
        name: 'Admin',
        permissions: [],
      },
      session: {
        id: 'session-1',
        idleExpiresAt: '2026-08-24T10:00:00.000Z',
        absoluteExpiresAt: '2026-08-24T18:00:00.000Z',
      },
    });
  });

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

  it('bounds an SMTP connection that never responds', async () => {
    const server = createServer();

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;

    try {
      const mailer = new SmtpAuthMailer({
        host: '127.0.0.1',
        port: address.port,
        username: '',
        password: '',
        from: 'no-reply@localhost',
        publicApiUrl: 'http://localhost:3000',
        webAppUrl: 'http://localhost:4200',
        timeoutMs: 50,
      });

      await expect(
        mailer.sendMagicLink({
          recipient: 'system@project.local',
          recipientName: 'System User',
          token: 'token-with-more-than-twenty-characters',
          expiresAt: new Date('2026-08-21T03:00:00.000Z'),
        }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});

describe('AuthService.sendInvitation (spec docs/specs/0007-user-management, AC-2)', () => {
  it('sends an invitation magic link for an active user and returns true', async () => {
    const sent: MagicLinkMessage[] = [];
    const user: AuthUser = {
      id: '0198f8a0-0000-7000-8000-000000000010',
      email: 'new.hire@project.local',
      name: 'New Hire',
      suspendedAt: null,
    };
    const repository = {
      issueInvitationLink: async () => user,
    } as unknown as AuthRepository;
    const mailer: AuthMailer = {
      sendMagicLink: async (message) => {
        sent.push(message);
      },
    };
    const service = new AuthService('auth', repository, mailer);

    const result = await service.sendInvitation(user.id);

    expect(result).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.recipient).toBe(user.email);
    expect(sent[0]?.recipientName).toBe(user.name);
    expect(sent[0]?.token.length).toBeGreaterThanOrEqual(20);
  });

  it('returns false without sending mail when the user is missing or not active', async () => {
    const sent: MagicLinkMessage[] = [];
    const repository = {
      issueInvitationLink: async () => null,
    } as unknown as AuthRepository;
    const mailer: AuthMailer = {
      sendMagicLink: async (message) => {
        sent.push(message);
      },
    };
    const service = new AuthService('auth', repository, mailer);

    const result = await service.sendInvitation(
      '0198f8a0-0000-7000-8000-000000000011',
    );

    expect(result).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('throws when no mailer is configured, the same as a self requested link', async () => {
    const repository = {
      issueInvitationLink: async () => null,
    } as unknown as AuthRepository;
    const service = new AuthService('auth', repository, undefined);

    await expect(
      service.sendInvitation('0198f8a0-0000-7000-8000-000000000012'),
    ).rejects.toThrow('Auth email delivery is not configured');
  });
});

describe('subscribeUserInvited (spec docs/specs/0007-user-management, AC-2)', () => {
  /**
   * The handler owns every failure mode itself (bad payload, inactive user,
   * mail transport error): it never rethrows, so a fake Subscriber only needs
   * to capture the handler `subscribeUserInvited` registers and let the test
   * invoke it directly, the same way a real message arriving would.
   */
  function fakeSubscriber(): {
    subscriber: Subscriber;
    emit: (event: unknown) => Promise<void>;
  } {
    let handler: ((event: unknown, message: unknown) => unknown) | undefined;
    const subscriber = {
      subscribe: (
        subject: string,
        subscribedHandler: (event: unknown, message: unknown) => unknown,
      ) => {
        expect(subject).toBe(USER_INVITED_SUBJECT);
        handler = subscribedHandler;

        return {};
      },
    } as unknown as Subscriber;

    return {
      subscriber,
      emit: async (event: unknown) => {
        if (!handler) {
          throw new Error('handler was never subscribed');
        }

        await handler(event, undefined);
      },
    };
  }

  function fakeAuthService(
    sendInvitation: (userId: string) => Promise<boolean>,
  ) {
    return { sendInvitation } as unknown as AuthService;
  }

  it('sends the invitation and logs success when the user is active', async () => {
    const { subscriber, emit } = fakeSubscriber();
    const service = fakeAuthService(async () => true);
    const logger = new Logger('auth-test', 'debug');
    const infoSpy = spyOn(logger, 'info');

    subscribeUserInvited(subscriber, service, logger);
    await emit({
      type: 'user.invited',
      version: 1,
      occurredAt: new Date().toISOString(),
      userId: '0198f8a0-0000-7000-8000-000000000020',
      email: 'new@project.local',
      name: 'New User',
      requestedBy: 'admin-id',
    } satisfies UserInvitedEvent);

    expect(infoSpy).toHaveBeenCalledWith('user.invited.sent', {
      userId: '0198f8a0-0000-7000-8000-000000000020',
    });
  });

  it('logs a warning and drops the event when the payload has no userId', async () => {
    const { subscriber, emit } = fakeSubscriber();
    let calls = 0;
    const service = fakeAuthService(async () => {
      calls += 1;

      return true;
    });
    const logger = new Logger('auth-test', 'debug');
    const warnSpy = spyOn(logger, 'warn');

    subscribeUserInvited(subscriber, service, logger);
    await emit({});

    expect(warnSpy).toHaveBeenCalledWith('user.invited.ignored', {
      reason: 'missing userId',
    });
    expect(calls).toBe(0);
  });

  it('logs a warning when the user is missing or not active', async () => {
    const { subscriber, emit } = fakeSubscriber();
    const service = fakeAuthService(async () => false);
    const logger = new Logger('auth-test', 'debug');
    const warnSpy = spyOn(logger, 'warn');

    subscribeUserInvited(subscriber, service, logger);
    await emit({ userId: 'missing-user' });

    expect(warnSpy).toHaveBeenCalledWith('user.invited.skipped', {
      userId: 'missing-user',
      reason: 'user is missing or not active',
    });
  });

  it('logs an error and drops the event when sending the invitation throws', async () => {
    const { subscriber, emit } = fakeSubscriber();
    const service = fakeAuthService(async () => {
      throw new Error('smtp exploded');
    });
    const logger = new Logger('auth-test', 'debug');
    const errorSpy = spyOn(logger, 'error');

    subscribeUserInvited(subscriber, service, logger);
    await emit({ userId: 'user-1' });

    expect(errorSpy).toHaveBeenCalledWith('user.invited.failed', {
      userId: 'user-1',
      error: 'smtp exploded',
    });
  });
});
