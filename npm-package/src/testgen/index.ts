import { writeFile, mkdir } from 'fs/promises';

export interface TestGenOptions {
  types?: ('e2e' | 'api')[];
  outputDir?: string;
}

export async function generateTests(data: any, options: TestGenOptions = {}): Promise<string[]> {
  const types = options.types || ['e2e', 'api'];
  const outputDir = options.outputDir || 'output/tests';
  const files: string[] = [];

  // 크롤링 데이터인지 분석 데이터인지 판별
  const isCrawl = Array.isArray(data.pages) && data.pages.length > 0;

  if (types.includes('e2e')) {
    if (isCrawl) {
      files.push(...await genCrawlE2E(data, outputDir));
    } else {
      files.push(...await genAnalysisE2E(data, outputDir));
    }
  }

  if (types.includes('api')) {
    if (isCrawl) {
      files.push(...await genCrawlAPI(data, outputDir));
    } else {
      files.push(...await genAnalysisAPI(data, outputDir));
    }
  }

  return files;
}

// ── 크롤링 결과 기반 테스트 ──

async function genCrawlE2E(data: any, outDir: string): Promise<string[]> {
  const files: string[] = [];
  await mkdir(`${outDir}/e2e`, { recursive: true });

  let code = `import { test, expect } from '@playwright/test';\n\n`;

  for (const page of data.pages || []) {
    const pathname = safeUrl(page.url);
    code += `test.describe('${page.title || pathname}', () => {\n`;
    code += `  test('페이지 로드: ${pathname}', async ({ page }) => {\n`;
    code += `    const response = await page.goto('${page.url}');\n`;
    code += `    expect(response?.status()).toBeLessThan(400);\n`;
    code += `  });\n\n`;

    // 버튼 존재 확인
    const buttons = page.elements?.buttons || [];
    if (buttons.length > 0) {
      code += `  test('주요 요소 확인', async ({ page }) => {\n`;
      code += `    await page.goto('${page.url}');\n`;
      for (const btn of buttons.slice(0, 5)) {
        if (btn.text) {
          code += `    // "${btn.text}" 버튼\n`;
        }
      }
      code += `  });\n\n`;
    }

    code += `});\n\n`;
  }

  const p = `${outDir}/e2e/pages.spec.ts`;
  await writeFile(p, code);
  files.push(p);
  return files;
}

async function genCrawlAPI(data: any, outDir: string): Promise<string[]> {
  await mkdir(`${outDir}/api`, { recursive: true });

  // 모든 페이지에서 API 호출 수집, 중복 제거
  const apiMap = new Map<string, { method: string; url: string; status: number }>();
  for (const page of data.pages || []) {
    for (const api of page.apiCalls || []) {
      const key = `${api.method}:${api.url}`;
      if (!apiMap.has(key)) {
        apiMap.set(key, { method: api.method, url: api.url, status: api.responseStatus });
      }
    }
  }

  if (apiMap.size === 0) return [];

  let code = `import { test, expect } from '@playwright/test';\n\n`;
  code += `test.describe('API 엔드포인트 (크롤링 발견)', () => {\n`;

  for (const [, api] of apiMap) {
    const urlPath = safeUrl(api.url);
    code += `  test('${api.method} ${urlPath}', async ({ request }) => {\n`;
    switch (api.method) {
      case 'GET': code += `    const response = await request.get('${api.url}');\n`; break;
      case 'POST': code += `    const response = await request.post('${api.url}', { data: {} });\n`; break;
      case 'PUT': code += `    const response = await request.put('${api.url}', { data: {} });\n`; break;
      case 'DELETE': code += `    const response = await request.delete('${api.url}');\n`; break;
      default: code += `    const response = await request.fetch('${api.url}', { method: '${api.method}' });\n`;
    }
    code += `    expect(response.status()).toBeLessThan(500);\n`;
    code += `  });\n\n`;
  }

  code += `});\n`;
  const p = `${outDir}/api/endpoints.spec.ts`;
  await writeFile(p, code);
  return [p];
}

// ── 소스코드 분석 결과 기반 테스트 ──

async function genAnalysisE2E(data: any, outDir: string): Promise<string[]> {
  const files: string[] = [];
  const routes = data.routes || [];
  const components = data.components || [];

  await mkdir(`${outDir}/e2e`, { recursive: true });
  let code = `import { test, expect } from '@playwright/test';\n\n`;
  for (const r of routes) {
    code += `test.describe('${r.path} (${r.component})', () => {\n`;
    code += `  test('페이지 로드', async ({ page }) => {\n`;
    code += `    const response = await page.goto('${r.path}');\n`;
    code += `    expect(response?.status()).toBeLessThan(400);\n`;
    code += `  });\n});\n\n`;
  }
  if (routes.length > 0) {
    const p = `${outDir}/e2e/routes.spec.ts`;
    await writeFile(p, code); files.push(p);
  }

  await mkdir(`${outDir}/components`, { recursive: true });
  for (const c of components.filter((c: any) => c.componentType === 'Page')) {
    const route = routes.find((r: any) => r.component === c.name);
    const url = route?.path || '/';
    let t = `import { test, expect } from '@playwright/test';\n\n`;
    t += `test.describe('${c.name}', () => {\n`;
    t += `  test('렌더링 확인', async ({ page }) => {\n`;
    t += `    await page.goto('${url}');\n`;
    for (const ch of c.children || []) t += `    // ${ch} 컴포넌트 확인\n`;
    t += `  });\n`;
    for (const api of c.apiCalls || []) {
      t += `\n  test('API: ${api}', async ({ page }) => {\n`;
      t += `    await page.goto('${url}');\n`;
      t += `    // TODO: ${api} 검증\n`;
      t += `  });\n`;
    }
    t += `});\n`;
    const p = `${outDir}/components/${c.name}.spec.ts`;
    await writeFile(p, t); files.push(p);
  }

  return files;
}

async function genAnalysisAPI(data: any, outDir: string): Promise<string[]> {
  const apiClients = data.apiClients || [];
  if (apiClients.length === 0) return [];

  await mkdir(`${outDir}/api`, { recursive: true });
  let code = `import { test, expect } from '@playwright/test';\n\n`;
  code += `test.describe('API 엔드포인트', () => {\n`;

  for (const a of apiClients) {
    code += `  test('${a.method} ${a.urlPattern}', async ({ request }) => {\n`;
    switch (a.method) {
      case 'GET': code += `    const response = await request.get('${a.urlPattern}');\n`; break;
      case 'POST': code += `    const response = await request.post('${a.urlPattern}', { data: {} });\n`; break;
      case 'PUT': code += `    const response = await request.put('${a.urlPattern}', { data: {} });\n`; break;
      case 'DELETE': code += `    const response = await request.delete('${a.urlPattern}');\n`; break;
      default: code += `    const response = await request.fetch('${a.urlPattern}', { method: '${a.method}' });\n`;
    }
    code += `    expect(response.status()).toBeLessThan(500);\n`;
    code += `  });\n\n`;
  }

  code += `});\n`;
  const p = `${outDir}/api/endpoints.spec.ts`;
  await writeFile(p, code);
  return [p];
}

function safeUrl(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}
