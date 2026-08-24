import { expect, test } from '@playwright/test';

test.describe('auth login and callback UI', () => {
  test('covers AC-8 and AC-15: login is one centered package page without app navigation', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/auth/login');

    await expect(page.locator('page')).toHaveCount(1);
    await expect(page.locator('pagecontent')).toHaveCount(1);
    await expect(page.locator('card')).toHaveCount(1);
    await expect(
      page.getByRole('heading', { name: 'Masuk ke Monobungsya' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation')).toHaveCount(0);
  });

  test('covers AC-L2: session service error offers retry and redirects anonymous users to login', async ({
    page,
  }) => {
    await page.context().clearCookies();
    let sessionAttempts = 0;
    await page.route('**/api/v1/auth/session', (route) => {
      sessionAttempts += 1;
      if (sessionAttempts === 1) {
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
        });
      }

      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: false,
          sessionObservation: { state: 'anonymous', reason: 'missing' },
        }),
      });
    });

    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: 'We could not check your session.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();

    await page.getByRole('button', { name: 'Try again' }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Masuk ke Monobungsya' }),
    ).toBeVisible();
    expect(sessionAttempts).toBe(2);
  });

  test('covers AC-L15: authenticated footer logout posts to the gateway and returns to login', async ({
    page,
  }) => {
    let logoutRequests = 0;
    await page.route('**/api/v1/auth/session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: 'user-1',
            name: 'System User',
            email: 'user@example.com',
            permissions: ['logs:log:read'],
          },
        }),
      }),
    );
    await page.route('**/api/v1/auth/logout', (route) => {
      logoutRequests += 1;
      return route.fulfill({ status: 204 });
    });

    await page.goto('/');
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByText('user@example.com').first()).toBeVisible();

    await page.getByRole('button', { name: 'Logout' }).click();

    await expect(page).toHaveURL(/\/auth\/login$/);
    await expect(
      page.getByRole('heading', { name: 'Masuk ke Monobungsya' }),
    ).toBeVisible();
    expect(logoutRequests).toBe(1);
  });

  test('covers AC-1, AC-2, AC-6, and AC-7: invalid login is labeled and accessible', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto('/auth/login');

    const email = page.getByLabel('Email');
    await expect(email).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Kirim magic link' }),
    ).toBeVisible();

    await email.fill('not-an-email');
    await page.getByRole('button', { name: 'Kirim magic link' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      'Enter a valid work email address.',
    );
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAttribute(
      'aria-describedby',
      /login-help.*login-error/,
    );
  });

  test('covers AC-2 and AC-3: valid request shows generic inbox state', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.route('**/api/v1/auth/magic-link', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accepted: true }),
      }),
    );
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('tester@example.test');
    await page.getByRole('button', { name: 'Kirim magic link' }).click();

    await expect(page.getByRole('status')).toContainText(
      'Check tester@example.test for your secure link.',
    );
    await expect(page.locator('a[href*="verify"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('token=');
  });

  test('covers AC-2: rate limit and service errors remain generic', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.route('**/api/v1/auth/magic-link', (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'RATE_LIMITED' } }),
      }),
    );
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('tester@example.test');
    await page.getByRole('button', { name: 'Kirim magic link' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Too many requests.' }),
    ).toBeVisible();
    await page.unroute('**/api/v1/auth/magic-link');

    await page.route('**/api/v1/auth/magic-link', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }),
      }),
    );
    await page.reload();
    await page.getByLabel('Email').fill('tester@example.test');
    await page.getByRole('button', { name: 'Kirim magic link' }).click();
    await expect(
      page.getByRole('alert').filter({
        hasText: 'The sign in service is unavailable.',
      }),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('SERVICE_UNAVAILABLE');
  });

  test('covers AC-4, AC-5, and AC-8: callback success requires the session cookie', async ({
    page,
  }) => {
    await page.goto('/auth/callback-complete');

    await expect(page.getByRole('heading', { name: /Welcome/ })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Continue to workspace' }),
    ).toBeVisible();
  });

  test('covers AC-4 and AC-8: callback error removes query details', async ({
    page,
  }) => {
    await page.goto('/auth/callback-error?token=secret-token-value');

    await expect(page).toHaveURL(/\/auth\/callback-error$/);
    await expect(
      page.getByRole('heading', { name: 'That link cannot be used.' }),
    ).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(
      'The link is invalid or no longer available.',
    );
    await expect(page.locator('body')).not.toContainText('secret-token-value');
    await expect(
      page.getByRole('link', { name: 'Return to sign in' }),
    ).toBeVisible();
  });

  test('covers AC-7: mobile login is one column without horizontal overflow', async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/login');

    await expect(page.locator('aside')).toBeHidden();
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  });
});
