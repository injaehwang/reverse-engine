/**
 * CLI에서 직접 호출되는 진입점
 * Usage: node cli-entry.js <input-json> <output-dir> <types>
 */

import { readFile, writeFile, mkdir } from 'fs/promises';

const [,, inputPath, outputDir, typesArg] = process.argv;

if (!inputPath || !outputDir) {
  console.error('Usage: node cli-entry.js <input.json> <output-dir> [e2e,api]');
  process.exit(1);
}

const types = (typesArg || 'e2e,api').split(',');

async function main() {
  const data = JSON.parse(await readFile(inputPath, 'utf-8'));
  const files: string[] = [];

  if (types.includes('e2e')) {
    const f = await generateE2E(data, outputDir);
    files.push(...f);
  }

  if (types.includes('api')) {
    const f = await generateAPI(data, outputDir);
    files.push(...f);
  }

  process.stdout.write(JSON.stringify({ success: true, data: { files } }));
}

async function generateE2E(data: any, outDir: string): Promise<string[]> {
  await mkdir(`${outDir}/e2e`, { recursive: true });
  const files: string[] = [];

  // 라우트별 E2E 테스트
  let code = `import { test, expect } from '@playwright/test';\n\n`;
  for (const r of data.routes || []) {
    const comp = r.component.replace(/[<>/]/g, '').trim();
    code += `test.describe('${r.path} (${comp})', () => {\n`;
    code += `  test('페이지 로드', async ({ page }) => {\n`;
    code += `    const response = await page.goto('${r.path}');\n`;
    code += `    expect(response?.status()).toBeLessThan(400);\n`;
    code += `  });\n`;
    code += `});\n\n`;
  }

  const path = `${outDir}/e2e/routes.spec.ts`;
  await writeFile(path, code, 'utf-8');
  files.push(path);

  // 페이지 컴포넌트별 테스트
  await mkdir(`${outDir}/components`, { recursive: true });
  for (const c of data.components || []) {
    if (c.component_type !== 'Page') continue;
    const route = (data.routes || []).find((r: any) => r.component.includes(c.name));
    const url = route ? route.path : '/';

    let t = `import { test, expect } from '@playwright/test';\n\n`;
    t += `test.describe('${c.name} 컴포넌트', () => {\n`;
    t += `  test('렌더링 확인', async ({ page }) => {\n`;
    t += `    await page.goto('${url}');\n`;
    for (const ch of c.children || []) {
      t += `    // ${ch} 컴포넌트 렌더링 확인\n`;
    }
    t += `  });\n\n`;
    for (const api of c.api_calls || []) {
      t += `  test('API 호출: ${api}', async ({ page }) => {\n`;
      t += `    await page.goto('${url}');\n`;
      t += `    // TODO: ${api} 호출 검증\n`;
      t += `  });\n\n`;
    }
    t += `});\n`;

    const p = `${outDir}/components/${c.name}.spec.ts`;
    await writeFile(p, t, 'utf-8');
    files.push(p);
  }

  return files;
}

async function generateAPI(data: any, outDir: string): Promise<string[]> {
  await mkdir(`${outDir}/api`, { recursive: true });

  let code = `import { test, expect } from '@playwright/test';\n\n`;
  code += `test.describe('API 엔드포인트', () => {\n`;

  for (const a of data.api_clients || []) {
    code += `  test('${a.method} ${a.url_pattern}', async ({ request }) => {\n`;
    switch (a.method) {
      case 'GET':
        code += `    const response = await request.get('${a.url_pattern}');\n`; break;
      case 'POST':
        code += `    const response = await request.post('${a.url_pattern}', { data: {} });\n`; break;
      case 'PUT':
        code += `    const response = await request.put('${a.url_pattern}', { data: {} });\n`; break;
      case 'DELETE':
        code += `    const response = await request.delete('${a.url_pattern}');\n`; break;
      default:
        code += `    const response = await request.fetch('${a.url_pattern}', { method: '${a.method}' });\n`;
    }
    code += `    expect(response.status()).toBeLessThan(500);\n`;
    code += `  });\n\n`;
  }

  code += `});\n`;
  const path = `${outDir}/api/endpoints.spec.ts`;
  await writeFile(path, code, 'utf-8');
  return [path];
}

main().catch((e) => {
  process.stdout.write(JSON.stringify({ success: false, error: String(e) }));
  process.exit(1);
});
