/**
 * API 테스트 코드 생성 (Playwright API Testing)
 */

import { writeFile, mkdir } from 'fs/promises';

export async function generateApiTests(data: any, outputDir: string): Promise<string[]> {
  await mkdir(`${outputDir}/api`, { recursive: true });

  const files: string[] = [];

  // 모든 페이지에서 API 호출 수집 및 중복 제거
  const apiCalls = new Map<string, any>();
  for (const page of data.pages || []) {
    for (const api of page.apiCalls || []) {
      const key = `${api.method}:${api.url}`;
      if (!apiCalls.has(key)) {
        apiCalls.set(key, { ...api, pageUrl: page.url });
      }
    }
  }

  if (apiCalls.size === 0) return files;

  const testCode = generateApiTestFile([...apiCalls.values()]);
  const filePath = `${outputDir}/api/api-endpoints.spec.ts`;
  await writeFile(filePath, testCode, 'utf-8');
  files.push(filePath);

  return files;
}

function generateApiTestFile(apis: any[]): string {
  const lines: string[] = [];
  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test.describe('API 엔드포인트 테스트', () => {`);

  for (const api of apis) {
    const testName = `${api.method} ${new URL(api.url).pathname}`;

    lines.push(`  test('${testName} - 정상 응답 확인', async ({ request }) => {`);

    if (api.method === 'GET') {
      lines.push(`    const response = await request.get('${api.url}');`);
    } else if (api.method === 'POST') {
      const body = api.requestBody ? JSON.stringify(api.requestBody) : '{}';
      lines.push(`    const response = await request.post('${api.url}', {`);
      lines.push(`      data: ${body},`);
      lines.push(`    });`);
    } else {
      lines.push(`    const response = await request.fetch('${api.url}', {`);
      lines.push(`      method: '${api.method}',`);
      lines.push(`    });`);
    }

    lines.push(`    expect(response.status()).toBe(${api.responseStatus || 200});`);

    // 응답 스키마 검증
    if (api.responseBody && typeof api.responseBody === 'object') {
      lines.push(`    const body = await response.json();`);
      for (const key of Object.keys(api.responseBody).slice(0, 5)) {
        lines.push(`    expect(body).toHaveProperty('${key}');`);
      }
    }

    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  return lines.join('\n');
}
