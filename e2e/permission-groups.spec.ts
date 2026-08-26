import { expect, test } from '@playwright/test';

test.describe('permission group grant templates', () => {
  test('covers AC-12, AC-13, and AC-14: an admin creates, fills, and applies a group', async ({
    page,
  }) => {
    const groupName = `E2E Permission Group ${Date.now()}`;

    await page.goto('/permission/group');
    await expect(
      page.getByRole('heading', { name: 'Permission groups', exact: true }),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Create group', exact: true })
      .click();
    await page.locator('#group-name').fill(groupName);
    await page.getByRole('button', { name: /^(Save|Simpan)$/ }).click();
    await expect(
      page.getByRole('link', { name: groupName, exact: true }),
    ).toBeVisible();

    await page.getByRole('link', { name: groupName, exact: true }).click();
    await expect(
      page.getByRole('heading', { name: groupName, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Group permissions', exact: true }),
    ).toBeVisible();

    const permissionRow = page
      .locator('label')
      .filter({ hasText: 'access:group:list' })
      .first();
    await permissionRow.locator('input[type="checkbox"]').check();
    await page
      .getByRole('button', { name: 'Attach selected', exact: true })
      .click();
    await expect(
      page.getByText('access:group:list', { exact: true }),
    ).toBeVisible();

    const userRow = page
      .locator('label')
      .filter({ hasText: 'e2e-admin@local.test' })
      .first();
    await userRow.locator('input[type="checkbox"]').check();
    await page
      .getByRole('button', { name: 'Apply to 1 users', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      '1 user(s) updated; 0 failed.',
    );

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /^(Delete|Hapus)$/ }).click();
    await expect(
      page.getByRole('button', { name: 'Restore', exact: true }),
    ).toBeVisible();
  });

  test.describe('staff access', () => {
    test.use({ storageState: 'e2e/.auth/staff.json' });

    test('covers AC-15: a user without group list permission is redirected', async ({
      page,
    }) => {
      await page.goto('/permission/group');
      await expect(page).toHaveURL('http://localhost:4311/');
      await expect(
        page.getByRole('heading', { name: 'Permission groups', exact: true }),
      ).toHaveCount(0);
    });
  });
});
