import { expect, test } from '@playwright/test';

test.describe('observability operator surface', () => {
  test('lets an authorized operator move across every evidence projection', async ({
    page,
  }) => {
    await page.goto('/observability');

    await expect(
      page.getByRole('heading', {
        name: 'Observability',
        exact: true,
        level: 1,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('tab', { name: 'Traces', exact: true }),
    ).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.getByRole('heading', { name: 'Trace search' }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Metrics', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Metric explorer' }),
    ).toBeVisible();
    await expect(page.getByText('Coverage gap', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Benchmarks', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Benchmark comparisons' }),
    ).toBeVisible();

    await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Alert state' }),
    ).toBeVisible();
    await expect(
      page
        .getByText(
          /No active or historical alert state|Telemetry storage is unavailable|pending|firing|resolved|unknown/,
        )
        .first(),
    ).toBeVisible();
  });
});

test.describe('observability operator surface as staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('redirects a user without observability permission', async ({
    page,
  }) => {
    await page.goto('/observability');

    await expect(page).toHaveURL('http://localhost:4311/');
    await expect(
      page.getByRole('heading', {
        name: 'Observability',
        exact: true,
        level: 1,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: 'Observability', exact: true }),
    ).toHaveCount(0);
  });
});
