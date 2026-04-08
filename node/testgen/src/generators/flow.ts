/**
 * 사용자 흐름 테스트 생성
 * - 폼 입력 시나리오
 * - 에러 응답 검증
 * - 인증 흐름 (로그인 → 기능사용 → 로그아웃)
 */

import { writeFile, mkdir } from 'fs/promises';

export async function generateFlowTests(data: any, outputDir: string): Promise<string[]> {
  await mkdir(`${outputDir}/flow`, { recursive: true });
  const files: string[] = [];

  const pages = data.pages || [];
  const components = data.components || [];
  const apiClients = data.api_clients || [];

  // 1. 폼 입력 시나리오 테스트
  const formsTests = generateFormTests(pages);
  if (formsTests) {
    const filePath = `${outputDir}/flow/form-submission.spec.ts`;
    await writeFile(filePath, formsTests, 'utf-8');
    files.push(filePath);
  }

  // 2. 에러 응답 검증 테스트
  const errorTests = generateErrorTests(apiClients);
  if (errorTests) {
    const filePath = `${outputDir}/flow/error-handling.spec.ts`;
    await writeFile(filePath, errorTests, 'utf-8');
    files.push(filePath);
  }

  // 3. 인증 흐름 테스트
  const authTests = generateAuthFlowTests(pages, apiClients);
  if (authTests) {
    const filePath = `${outputDir}/flow/auth-flow.spec.ts`;
    await writeFile(filePath, authTests, 'utf-8');
    files.push(filePath);
  }

  return files;
}

/** 폼 입력 + 제출 테스트 */
function generateFormTests(pages: any[]): string | null {
  const pagesWithForms = pages.filter(
    (p: any) => p.elements?.forms?.length > 0,
  );
  if (pagesWithForms.length === 0) return null;

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('폼 입력 및 제출', () => {`);

  for (const page of pagesWithForms) {
    for (const form of page.elements.forms) {
      const formId = form.id || 'form';
      lines.push('');
      lines.push(`  test.describe('${page.url} - ${formId}', () => {`);

      // 필수 필드 미입력 시 제출 방지 테스트
      const requiredFields = (form.fields || []).filter((f: any) => f.required);
      if (requiredFields.length > 0) {
        lines.push(`    test('필수 필드 미입력 시 제출 방지', async ({ page }) => {`);
        lines.push(`      await page.goto('${page.url}');`);
        const selector = form.id ? `#${form.id}` : 'form';
        lines.push(`      const submitBtn = page.locator('${selector} button[type="submit"], ${selector} input[type="submit"]').first();`);
        lines.push(`      if (await submitBtn.isVisible()) {`);
        lines.push(`        await submitBtn.click();`);
        lines.push(`        // HTML5 validation이 제출을 막아야 함`);
        lines.push(`        await expect(page).toHaveURL('${page.url}');`);
        lines.push(`      }`);
        lines.push(`    });`);
        lines.push('');
      }

      // 정상 입력 후 제출 테스트
      lines.push(`    test('정상 입력 후 제출', async ({ page }) => {`);
      lines.push(`      await page.goto('${page.url}');`);

      for (const field of form.fields || []) {
        if (!field.name) continue;
        const value = generateTestValue(field.fieldType, field.name);
        lines.push(`      await page.fill('[name="${escJs(field.name)}"]', '${escJs(value)}');`);
      }

      const selector = form.id ? `#${form.id}` : 'form';
      lines.push(`      const submitBtn = page.locator('${selector} button[type="submit"], ${selector} input[type="submit"]').first();`);
      lines.push(`      if (await submitBtn.isVisible()) {`);
      lines.push(`        await submitBtn.click();`);
      lines.push(`        await page.waitForLoadState('networkidle');`);
      lines.push(`      }`);
      lines.push(`    });`);

      lines.push(`  });`);
    }
  }

  lines.push(`});`);
  return lines.join('\n');
}

/** API 에러 응답 검증 테스트 */
function generateErrorTests(apiClients: any[]): string | null {
  if (apiClients.length === 0) return null;

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('API 에러 응답 검증', () => {`);

  for (const api of apiClients) {
    const urlPattern = api.url_pattern;

    // 존재하지 않는 리소스 요청 (404 테스트)
    if (urlPattern.includes('{') || urlPattern.includes(':')) {
      lines.push('');
      lines.push(`  test('${api.method} ${urlPattern} - 존재하지 않는 리소스 (404)', async ({ request }) => {`);
      const testUrl = urlPattern
        .replace(/\{[^}]+\}/g, '999999')
        .replace(/:[\w]+/g, '999999');
      lines.push(`    const response = await request.fetch('${testUrl}', { method: '${api.method}' });`);
      lines.push(`    // 존재하지 않는 리소스는 4xx 에러를 반환해야 함`);
      lines.push(`    expect(response.status()).toBeGreaterThanOrEqual(400);`);
      lines.push(`    expect(response.status()).toBeLessThan(500);`);
      lines.push(`  });`);
    }

    // POST/PUT에 빈 바디 전송
    if (['POST', 'PUT', 'PATCH'].includes(api.method)) {
      lines.push('');
      lines.push(`  test('${api.method} ${urlPattern} - 빈 요청 바디', async ({ request }) => {`);
      lines.push(`    const response = await request.fetch('${urlPattern}', {`);
      lines.push(`      method: '${api.method}',`);
      lines.push(`      data: {},`);
      lines.push(`    });`);
      lines.push(`    // 빈 바디는 400 또는 422로 거부되어야 함`);
      lines.push(`    expect(response.status()).toBeGreaterThanOrEqual(400);`);
      lines.push(`  });`);
    }
  }

  lines.push(`});`);
  return lines.join('\n');
}

/** 인증 흐름 테스트: 로그인 → 인증 필요 페이지 → 로그아웃 */
function generateAuthFlowTests(pages: any[], apiClients: any[]): string | null {
  // 로그인 API 감지
  const loginApis = apiClients.filter(
    (a: any) =>
      a.url_pattern.includes('login') ||
      a.url_pattern.includes('auth') ||
      a.url_pattern.includes('signin'),
  );

  if (loginApis.length === 0) return null;

  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('인증 흐름', () => {`);

  // 비인증 상태에서 보호된 페이지 접근 테스트
  const authRequiredPages = pages.filter((p: any) => p.authRequired);
  if (authRequiredPages.length > 0) {
    lines.push(`  test('비인증 상태에서 보호된 페이지 접근 시 리다이렉트', async ({ page }) => {`);
    for (const p of authRequiredPages.slice(0, 3)) {
      lines.push(`    await page.goto('${p.url}');`);
      lines.push(`    // 로그인 페이지로 리다이렉트 확인`);
      lines.push(`    await page.waitForLoadState('networkidle');`);
      lines.push(`    const url = page.url();`);
      lines.push(`    expect(url.includes('login') || url.includes('auth') || url.includes('signin')).toBeTruthy();`);
    }
    lines.push(`  });`);
    lines.push('');
  }

  // 로그인 API 호출 테스트
  for (const api of loginApis) {
    lines.push(`  test('로그인 API (${api.method} ${api.url_pattern}) - 잘못된 credentials', async ({ request }) => {`);
    lines.push(`    const response = await request.fetch('${api.url_pattern}', {`);
    lines.push(`      method: '${api.method}',`);
    lines.push(`      data: { email: 'invalid@test.com', password: 'wrongpassword' },`);
    lines.push(`    });`);
    lines.push(`    // 잘못된 credentials은 4xx 에러를 반환해야 함`);
    lines.push(`    expect(response.status()).toBeGreaterThanOrEqual(400);`);
    lines.push(`    expect(response.status()).toBeLessThan(500);`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  return lines.join('\n');
}

/** JS 문자열 리터럴에 안전하게 삽입하기 위한 이스케이프 */
function escJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}

function generateTestValue(fieldType: string, fieldName: string): string {
  switch (fieldType) {
    case 'email': return 'test@example.com';
    case 'password': return 'TestPass123!';
    case 'tel': return '010-1234-5678';
    case 'number': return '42';
    case 'url': return 'https://example.com';
    case 'date': return '2026-01-01';
    default:
      if (fieldName.includes('name')) return '테스트 사용자';
      if (fieldName.includes('search')) return 'test query';
      return 'test input';
  }
}
