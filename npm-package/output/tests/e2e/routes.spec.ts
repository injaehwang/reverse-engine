import { test, expect } from '@playwright/test';

test.describe('/ (Dashboard)', () => {
  test('페이지 로드', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.status()).toBeLessThan(400);
  });
});

test.describe('/settings (Settings)', () => {
  test('페이지 로드', async ({ page }) => {
    const response = await page.goto('/settings');
    expect(response?.status()).toBeLessThan(400);
  });
});

test.describe('/login (Login)', () => {
  test('페이지 로드', async ({ page }) => {
    const response = await page.goto('/login');
    expect(response?.status()).toBeLessThan(400);
  });
});

