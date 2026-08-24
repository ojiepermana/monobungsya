import { expect, type Page, test } from '@playwright/test';

/**
 * Browser flow tests for the log viewer pages, traced to spec logs/0001.
 * Runs as the seeded admin by default (storage state from auth.setup.ts);
 * the staff block switches to the staff storage state.
 *
 * UI labels pass through the localization layer, so every locator accepts
 * the English source label and its Indonesian rendering.
 */

const first = (page: Page) =>
  page.getByRole('button', { name: /^(Pertama|First)$/ });
const previous = (page: Page) =>
  page.getByRole('button', { name: /^(Sebelumnya|Previous)$/ });
const next = (page: Page) =>
  page.getByRole('button', { name: /^(Berikutnya|Next)$/ });
const last = (page: Page) =>
  page.getByRole('button', { name: /^(Terakhir|Last)$/ });
const pageLabel = (page: Page, pageNo: number) =>
  page.getByText(
    new RegExp(`(Halaman|Page) ${pageNo} (dari|of) \\d+ · \\d+ records`),
  );

test.describe('log pages as an admin', () => {
  test('covers AC-9, AC-10, AC-14, and AC-15: a log page has one shell content landmark without overflow', async ({
    page,
  }) => {
    await page.goto('/logs/audit');

    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('navigation')).toHaveCount(1);
    await expect(page.locator('page')).toHaveCount(1);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
  });

  for (const route of ['/logs/audit', '/logs/access', '/logs/application']) {
    test(`covers AC-9: ${route} renders the table with search, filters, clear filters, and paging`, async ({
      page,
    }) => {
      await page.goto(route);

      await expect(page.getByRole('searchbox', { name: /log/i })).toBeVisible();
      expect(await page.getByRole('combobox').count()).toBeGreaterThanOrEqual(
        2,
      );
      await expect(
        page.getByRole('button', { name: /^Clear Filters$/ }),
      ).toBeVisible();
      await expect(page.getByRole('table')).toBeVisible();
      await expect(first(page)).toBeVisible();
      await expect(previous(page)).toBeVisible();
      await expect(next(page)).toBeVisible();
      await expect(last(page)).toBeVisible();
    });
  }

  test('covers AC-4 and AC-9: paging walks to the last page and the buttons disable at each end', async ({
    page,
  }) => {
    await page.goto('/logs/application');

    await expect(pageLabel(page, 1)).toBeVisible();
    await expect(first(page)).toBeDisabled();
    await expect(previous(page)).toBeDisabled();
    await expect(next(page)).toBeEnabled();

    await last(page).click();
    await expect(next(page)).toBeDisabled();
    await expect(last(page)).toBeDisabled();
    await expect(first(page)).toBeEnabled();
    await expect(previous(page)).toBeEnabled();

    await first(page).click();
    await expect(pageLabel(page, 1)).toBeVisible();
    await expect(first(page)).toBeDisabled();
    await expect(previous(page)).toBeDisabled();
  });

  test('covers AC-9: a search reloads on page 1 and Clear Filters resets everything', async ({
    page,
  }) => {
    await page.goto('/logs/application');
    await next(page).click();
    await expect(pageLabel(page, 2)).toBeVisible();

    const search = page.getByRole('searchbox');
    await search.fill('e2e seed row');
    await expect(pageLabel(page, 1)).toBeVisible();
    await expect(
      page.getByRole('cell', { name: /e2e seed row/ }).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: /^Clear Filters$/ }).click();
    await expect(search).toHaveValue('');
    await expect(pageLabel(page, 1)).toBeVisible();
  });

  test('covers AC-7: timestamps render as Indonesian medium dates with short times', async ({
    page,
  }) => {
    await page.goto('/logs/application');

    const timeCell = page.locator('tbody tr').first().locator('td').first();
    await expect(timeCell).toHaveText(/\d{1,2} \w{3} \d{4}, \d{2}\.\d{2}/);
  });

  test('covers AC-11, AC-17, and AC-19: users requests share one trace and remain separately visible', async ({
    page,
  }) => {
    const requests: Array<{
      path: string;
      traceId: string | undefined;
      clientRoute: string | undefined;
    }> = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (
        request.method() === 'GET' &&
        (url.pathname === '/api/v1/auth/session' ||
          url.pathname === '/api/v1/users')
      ) {
        requests.push({
          path: url.pathname,
          traceId: request.headers()['x-correlation-id'],
          clientRoute: request.headers()['x-client-route'],
        });
      }
    });

    await page.goto('/users');
    await expect(
      page.getByRole('heading', { name: 'User Management', exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        () => requests.filter(({ path }) => path === '/api/v1/users').length,
      )
      .toBeGreaterThan(0);

    const sessionRequest = requests.find(
      ({ path }) => path === '/api/v1/auth/session',
    );
    const usersRequest = requests.find(({ path }) => path === '/api/v1/users');
    expect(sessionRequest?.traceId).toBeTruthy();
    expect(usersRequest?.traceId).toBe(sessionRequest?.traceId);
    expect(sessionRequest?.clientRoute).toBe('/users');
    expect(usersRequest?.clientRoute).toBe('/users');

    await page.goto('/logs/access');
    const search = page.getByRole('searchbox', { name: /log/i });
    await search.fill(sessionRequest?.traceId ?? '');
    await expect(
      page.getByRole('cell', { name: '/api/v1/auth/session' }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: '/api/v1/users' }).first(),
    ).toBeVisible();
  });
});

test.describe('log pages as staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('covers AC-5: staff has no logs navigation and /logs/audit redirects away', async ({
    page,
  }) => {
    await page.goto('/logs/audit');

    await expect(page).toHaveURL('http://localhost:4311/');
    expect(await page.locator('a[href^="/logs/"]').count()).toBe(0);
    await expect(page.getByRole('table')).toHaveCount(0);
  });
});
