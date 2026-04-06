/**
 * Playwright 브라우저 관리 및 BFS 크롤링 엔진
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { PageScanner, type PageInfo } from './page-scanner.js';
import { NetworkInterceptor } from './network-interceptor.js';

export interface CrawlOptions {
  url: string;
  maxDepth: number;
  maxPages: number;
  screenshot: boolean;
  har: boolean;
  authCookie?: string;
}

export interface CrawlResult {
  targetUrl: string;
  pages: PageInfo[];
  timestamp: string;
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
  });

  // 인증 쿠키 설정
  if (options.authCookie) {
    const [name, value] = options.authCookie.split('=');
    const url = new URL(options.url);
    await context.addCookies([{
      name,
      value,
      domain: url.hostname,
      path: '/',
    }]);
  }

  const result: CrawlResult = {
    targetUrl: options.url,
    pages: [],
    timestamp: new Date().toISOString(),
  };

  // BFS 탐색
  const visited = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [
    { url: options.url, depth: 0 },
  ];

  while (queue.length > 0 && result.pages.length < options.maxPages) {
    const current = queue.shift()!;

    if (visited.has(current.url) || current.depth > options.maxDepth) {
      continue;
    }
    visited.add(current.url);

    try {
      const page = await context.newPage();
      const interceptor = new NetworkInterceptor(page);
      await interceptor.start();

      await page.goto(current.url, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // 페이지 스캔
      const scanner = new PageScanner(page);
      const pageInfo = await scanner.scan(current.url);

      // API 호출 수집
      pageInfo.apiCalls = interceptor.getCapturedCalls();

      // 스크린샷
      if (options.screenshot) {
        const screenshotPath = `output/screenshots/${encodeURIComponent(current.url)}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        pageInfo.screenshotPath = screenshotPath;
      }

      result.pages.push(pageInfo);

      // 발견된 링크를 큐에 추가
      const baseUrl = new URL(options.url);
      for (const link of pageInfo.elements.links) {
        try {
          const linkUrl = new URL(link.href, options.url);
          if (linkUrl.hostname === baseUrl.hostname && !visited.has(linkUrl.href)) {
            queue.push({ url: linkUrl.href, depth: current.depth + 1 });
          }
        } catch {
          // 잘못된 URL은 무시
        }
      }

      await page.close();
    } catch (error) {
      console.error(`크롤링 실패: ${current.url} - ${error}`);
    }
  }

  await browser.close();
  return result;
}
