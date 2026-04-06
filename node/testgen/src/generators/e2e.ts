/**
 * E2E 테스트 코드 생성 (Playwright Test)
 */

import { writeFile, mkdir } from 'fs/promises';

export async function generateE2ETests(data: any, outputDir: string): Promise<string[]> {
  await mkdir(`${outputDir}/e2e`, { recursive: true });

  const files: string[] = [];
  const pages = data.pages || [];

  for (const page of pages) {
    const testName = urlToTestName(page.url);
    const testCode = generatePageTest(page);
    const filePath = `${outputDir}/e2e/${testName}.spec.ts`;
    await writeFile(filePath, testCode, 'utf-8');
    files.push(filePath);
  }

  // 화면 흐름 테스트
  if (pages.length > 1) {
    const flowCode = generateFlowTests(pages);
    const filePath = `${outputDir}/e2e/navigation-flow.spec.ts`;
    await writeFile(filePath, flowCode, 'utf-8');
    files.push(filePath);
  }

  return files;
}

function generatePageTest(page: any): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('${page.title || page.url}', () => {`);

  // 페이지 로드 테스트
  lines.push(`  test('페이지 로드 및 타이틀 확인', async ({ page }) => {`);
  lines.push(`    await page.goto('${page.url}');`);
  if (page.title) {
    lines.push(`    await expect(page).toHaveTitle(/${escapeRegex(page.title)}/);`);
  }
  lines.push(`    await expect(page).toHaveURL('${page.url}');`);
  lines.push(`  });`);
  lines.push('');

  // 버튼 존재 확인 테스트
  const buttons = page.elements?.buttons || [];
  if (buttons.length > 0) {
    lines.push(`  test('주요 버튼 요소 존재 확인', async ({ page }) => {`);
    lines.push(`    await page.goto('${page.url}');`);
    for (const btn of buttons.slice(0, 10)) {
      if (btn.selector) {
        lines.push(`    await expect(page.locator('${btn.selector}')).toBeVisible();`);
      }
    }
    lines.push(`  });`);
    lines.push('');
  }

  // 링크 네비게이션 테스트
  const links = page.elements?.links || [];
  for (const link of links.slice(0, 5)) {
    if (link.href && link.text) {
      lines.push(`  test('${link.text} 링크 클릭 시 ${link.href}로 이동', async ({ page }) => {`);
      lines.push(`    await page.goto('${page.url}');`);
      lines.push(`    await page.click('${link.selector}');`);
      lines.push(`    await expect(page).toHaveURL('${link.href}');`);
      lines.push(`  });`);
      lines.push('');
    }
  }

  lines.push(`});`);
  return lines.join('\n');
}

function generateFlowTests(pages: any[]): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('화면 네비게이션 흐름', () => {`);

  // 모든 페이지 접근 가능 테스트
  for (const page of pages) {
    lines.push(`  test('${page.url} 접근 가능', async ({ page }) => {`);
    lines.push(`    const response = await page.goto('${page.url}');`);
    lines.push(`    expect(response?.status()).toBeLessThan(400);`);
    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  return lines.join('\n');
}

function urlToTestName(url: string): string {
  return url
    .replace(/https?:\/\/[^/]+/, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'index';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
