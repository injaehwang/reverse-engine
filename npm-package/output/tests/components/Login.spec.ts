import { test, expect } from '@playwright/test';

test.describe('Login', () => {
  test('렌더링 확인', async ({ page }) => {
    await page.goto('/login');
  });

  test('API: POST /api/auth/login', async ({ page }) => {
    await page.goto('/login');
    // TODO: POST /api/auth/login 검증
  });
});
