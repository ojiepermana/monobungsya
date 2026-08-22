import { execFileSync } from 'node:child_process';
import { expect, request, test as setup } from '@playwright/test';

/**
 * Seeds the database (users, tokens, log rows) through bun, then consumes
 * each magic-link token against the real gateway verify endpoint and saves
 * the resulting session cookie as a storage state per role.
 *
 * The gateway is always addressed as localhost (not 127.0.0.1) so the
 * session cookie lands on the same host the web app is served from.
 */
const GATEWAY = 'http://localhost:3000';

setup('seed fixtures and sign in both roles', async () => {
  const output = execFileSync('bun', ['e2e/fixtures/seed.ts'], {
    encoding: 'utf8',
  });
  const lastLine = output.trim().split('\n').at(-1) ?? '{}';
  const tokens = JSON.parse(lastLine) as {
    adminToken: string;
    staffToken: string;
  };

  const states = [
    { token: tokens.adminToken, path: 'e2e/.auth/admin.json' },
    { token: tokens.staffToken, path: 'e2e/.auth/staff.json' },
  ];
  for (const { token, path } of states) {
    const context = await request.newContext();
    const response = await context.get(
      `${GATEWAY}/api/v1/auth/verify?token=${token}`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(302);
    await context.storageState({ path });
    await context.dispose();
  }
});
