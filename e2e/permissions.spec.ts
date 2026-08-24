import { expect, test } from '@playwright/test';

test.describe('permission catalog', () => {
  test('covers AC-14: admin can open the catalog and see its filter and actions', async ({
    page,
  }) => {
    await page.goto('/access/permissions');

    await expect(
      page.getByRole('heading', { name: 'Permission Catalog', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('table', { name: /Permission catalog/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Show or hide filters/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create permission', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /^(Edit|Ubah)$/ }).first(),
    ).toBeVisible();

    await page.getByRole('button', { name: /Show or hide filters/i }).click();
    await expect(page.getByPlaceholder('Search name or code...')).toBeVisible();
    await expect(page.getByPlaceholder('Namespace')).toBeVisible();
  });

  test('covers AC-14 and AC-15: the delete guard explains the grant cascade and can be cancelled', async ({
    page,
  }) => {
    let dialogMessage = '';
    page.once('dialog', async (dialog) => {
      dialogMessage = dialog.message();
      await dialog.dismiss();
    });

    await page.goto('/access/permissions');
    await page
      .getByRole('button', { name: /^(Delete|Hapus)$/ })
      .first()
      .click();

    expect(dialogMessage).toContain(
      'This will cascade and remove all user grants.',
    );
  });
});

test.describe('permission catalog as staff', () => {
  test.use({ storageState: 'e2e/.auth/staff.json' });

  test('covers AC-9 and AC-14: a user without catalog permission is redirected away', async ({
    page,
  }) => {
    await page.goto('/access/permissions');

    await expect(page).toHaveURL('http://localhost:4311/');
    await expect(
      page.getByRole('heading', { name: 'Permission Catalog', exact: true }),
    ).toHaveCount(0);
  });
});
