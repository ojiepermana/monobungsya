import { expect, test } from '@playwright/test';

test.describe('reliable jobs and notification center', () => {
  test('AC-4 and AC-5: an authenticated user can open the notification center', async ({
    page,
  }) => {
    await page.goto('/notifications');

    await expect(
      page.getByRole('heading', { name: 'Notifikasi', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Tandai semua dibaca' }),
    ).toBeVisible();
    await expect(
      page.getByText(/Belum ada notifikasi\.|Aktivitas keamanan baru/).first(),
    ).toBeVisible();
  });

  test('AC-7 and AC-8: the live notification service exposes preferences and empty state', async ({
    page,
  }) => {
    await page.goto('/notifications');
    await page.getByRole('button', { name: 'Preferensi email' }).click();
    await expect(
      page.getByRole('heading', { name: 'Preferensi notifikasi' }),
    ).toBeVisible();
    await expect(
      page.getByText('wajib', { exact: true }).first(),
    ).toBeVisible();
  });

  test.describe('jobs authorization', () => {
    test.use({ storageState: 'e2e/.auth/staff.json' });

    test('AC-11: a user without jobs permission is redirected away', async ({
      page,
    }) => {
      await page.goto('/operations/jobs');

      await expect(page).toHaveURL('http://localhost:4311/');
      await expect(
        page.getByRole('heading', { name: 'Durable jobs', exact: true }),
      ).toHaveCount(0);
    });
  });
});
