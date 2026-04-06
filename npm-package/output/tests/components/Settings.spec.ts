import { test, expect } from '@playwright/test';

test.describe('Settings', () => {
  test('렌더링 확인', async ({ page }) => {
    await page.goto('/settings');
  });

  test('API: DELETE /api/settings/account', async ({ page }) => {
    await page.goto('/settings');
    // TODO: DELETE /api/settings/account 검증
  });

  test('API: PUT /api/settings/profile', async ({ page }) => {
    await page.goto('/settings');
    // TODO: PUT /api/settings/profile 검증
  });
});
