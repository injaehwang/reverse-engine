import { writeFile, mkdir } from 'fs/promises';
import type { AnalysisResult } from '../types.js';

export interface TestGenOptions {
  types?: ('e2e' | 'api')[];
  outputDir?: string;
}

export async function generateTests(data: AnalysisResult, options: TestGenOptions = {}): Promise<string[]> {
  const types = options.types || ['e2e', 'api'];
  const outputDir = options.outputDir || 'output/tests';
  const files: string[] = [];

  if (types.includes('e2e')) files.push(...await genE2E(data, outputDir));
  if (types.includes('api')) files.push(...await genAPI(data, outputDir));

  return files;
}

async function genE2E(data: AnalysisResult, outDir: string): Promise<string[]> {
  const files: string[] = [];

  // 라우트 테스트
  await mkdir(`${outDir}/e2e`, { recursive: true });
  let code = `import { test, expect } from '@playwright/test';\n\n`;
  for (const r of data.routes) {
    code += `test.describe('${r.path} (${r.component})', () => {\n`;
    code += `  test('페이지 로드', async ({ page }) => {\n`;
    code += `    const response = await page.goto('${r.path}');\n`;
    code += `    expect(response?.status()).toBeLessThan(400);\n`;
    code += `  });\n});\n\n`;
  }
  const p1 = `${outDir}/e2e/routes.spec.ts`;
  await writeFile(p1, code); files.push(p1);

  // 페이지 컴포넌트 테스트
  await mkdir(`${outDir}/components`, { recursive: true });
  for (const c of data.components.filter(c => c.componentType === 'Page')) {
    const route = data.routes.find(r => r.component === c.name);
    const url = route?.path || '/';
    let t = `import { test, expect } from '@playwright/test';\n\n`;
    t += `test.describe('${c.name}', () => {\n`;
    t += `  test('렌더링 확인', async ({ page }) => {\n`;
    t += `    await page.goto('${url}');\n`;
    for (const ch of c.children) t += `    // ${ch} 컴포넌트 확인\n`;
    t += `  });\n`;
    for (const api of c.apiCalls) {
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

async function genAPI(data: AnalysisResult, outDir: string): Promise<string[]> {
  await mkdir(`${outDir}/api`, { recursive: true });
  let code = `import { test, expect } from '@playwright/test';\n\n`;
  code += `test.describe('API 엔드포인트', () => {\n`;

  for (const a of data.apiClients) {
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
