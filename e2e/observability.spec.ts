import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('observability operator surface', () => {
  test('lets an authorized operator reach all nine signal routes', async ({
    page,
  }) => {
    const routes = [
      ['/observability', 'Signal overview'],
      ['/observability/traces', 'Traces'],
      [`/observability/traces/${'a'.repeat(32)}`, 'Trace detail'],
      ['/observability/metrics', 'Metrics'],
      ['/observability/benchmarks', 'Benchmark runs'],
      [
        '/observability/benchmarks/0198f8f8-0000-7000-8000-000000000001',
        'Benchmark run detail',
      ],
      ['/observability/baselines', 'Baselines'],
      ['/observability/alerts', 'Alerts'],
      ['/observability/alerts/telemetry.error_rate', 'Alert rule detail'],
    ] as const;

    for (const [route, heading] of routes) {
      await page.goto(route);
      await expect(
        page.getByRole('heading', { name: heading, exact: true, level: 1 }),
      ).toBeVisible();
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations.filter(
          (violation) =>
            violation.impact === 'serious' || violation.impact === 'critical',
        ),
        `${route} has serious or critical accessibility violations`,
      ).toEqual([]);
    }
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
