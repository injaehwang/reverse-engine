/**
 * 스크린샷 캡처 유틸리티
 */

import type { Page } from 'playwright';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';

export async function captureScreenshot(
  page: Page,
  url: string,
  outputDir: string,
): Promise<string> {
  const safeName = url
    .replace(/https?:\/\//, '')
    .replace(/[^a-zA-Z0-9가-힣]/g, '_')
    .slice(0, 100);

  const filePath = `${outputDir}/${safeName}.png`;
  await mkdir(dirname(filePath), { recursive: true });

  await page.screenshot({
    path: filePath,
    fullPage: true,
  });

  return filePath;
}

export async function captureElementScreenshot(
  page: Page,
  selector: string,
  outputPath: string,
): Promise<void> {
  const element = page.locator(selector);
  await mkdir(dirname(outputPath), { recursive: true });
  await element.screenshot({ path: outputPath });
}
