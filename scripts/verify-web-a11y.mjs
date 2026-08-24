import AxeBuilder from '@axe-core/playwright';
import { chromium } from '@playwright/test';

const baseUrl = process.env.WEB_URL ?? 'http://localhost:4300';
const routes = ['/auth/login', '/auth/callback-error', '/auth/two-factor'];
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const failures = [];

try {
  for (const route of routes) {
    const page = await context.newPage();
    await page.goto(`${baseUrl}${route}`, { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page }).analyze();

    if (results.violations.length)
      failures.push({ route, violations: results.violations });
    console.log(
      `${route}: ${results.violations.length} accessibility violation(s)`,
    );
    await page.close();
  }
} finally {
  await context.close();
  await browser.close();
}

if (failures.length) {
  for (const failure of failures) {
    for (const violation of failure.violations) {
      console.error(`\n${failure.route} · ${violation.id}: ${violation.help}`);
      for (const node of violation.nodes) console.error(`  ${node.html}`);
    }
  }
  process.exitCode = 1;
}
