import { test, expect } from '@playwright/test';

test.describe('API 엔드포인트', () => {
  test('PUT /api/settings/profile', async ({ request }) => {
    const response = await request.put('/api/settings/profile', { data: {} });
    expect(response.status()).toBeLessThan(500);
  });

  test('DELETE /api/settings/account', async ({ request }) => {
    const response = await request.delete('/api/settings/account');
    expect(response.status()).toBeLessThan(500);
  });

  test('POST /api/auth/login', async ({ request }) => {
    const response = await request.post('/api/auth/login', { data: {} });
    expect(response.status()).toBeLessThan(500);
  });

  test('POST /api/export', async ({ request }) => {
    const response = await request.post('/api/export', { data: {} });
    expect(response.status()).toBeLessThan(500);
  });

  test('GET /api/dashboard/stats', async ({ request }) => {
    const response = await request.get('/api/dashboard/stats');
    expect(response.status()).toBeLessThan(500);
  });

  test('GET /api/dashboard/activities', async ({ request }) => {
    const response = await request.get('/api/dashboard/activities');
    expect(response.status()).toBeLessThan(500);
  });

  test('POST /api/projects', async ({ request }) => {
    const response = await request.post('/api/projects', { data: {} });
    expect(response.status()).toBeLessThan(500);
  });

});
