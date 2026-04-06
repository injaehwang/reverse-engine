import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('렌더링 확인', async ({ page }) => {
    await page.goto('/');
    // ActivityFeed 컴포넌트 확인
    // StatsCard 컴포넌트 확인
  });

  test('API: GET /api/export', async ({ page }) => {
    await page.goto('/');
    // TODO: GET /api/export 검증
  });
});
