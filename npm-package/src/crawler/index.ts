import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type { CrawlResult, PageInfo } from '../types.js';

export interface CrawlOptions {
  url: string;
  maxDepth?: number;
  maxPages?: number;
  screenshot?: boolean;
  outputDir?: string;
  auth?: AuthOptions;
  headless?: boolean;
  waitTime?: number;
  ignorePatterns?: string[];
}

export interface AuthOptions {
  cookie?: string;
  bearer?: string;
  loginUrl?: string;
  credentials?: Record<string, string>;
  submitSelector?: string;
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const {
    url,
    maxDepth = 5,
    maxPages = 100,
    screenshot = true,
    outputDir = '.reverse-engine',
    headless = true,
    waitTime = 1500,
    ignorePatterns = ['/logout', '/signout', '/auth/logout'],
  } = options;

  const screenshotDir = join(outputDir, 'screenshots');
  if (screenshot) await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
  });

  // 인증 설정
  if (options.auth) {
    await setupAuth(context, url, options.auth);
  }

  const result: CrawlResult = {
    targetUrl: url,
    pages: [],
    timestamp: new Date().toISOString(),
  };

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
  const baseHost = new URL(url).hostname;

  while (queue.length > 0 && result.pages.length < maxPages) {
    const current = queue.shift()!;
    const normalizedUrl = normalizeUrl(current.url);

    if (visited.has(normalizedUrl) || current.depth > maxDepth) continue;
    if (ignorePatterns.some(p => normalizedUrl.includes(p))) continue;
    visited.add(normalizedUrl);

    const page = await context.newPage();
    try {
      const pageInfo = await scanPage(page, current.url, waitTime);

      // 스크린샷
      if (screenshot) {
        const safeName = normalizedUrl.replace(/[^a-zA-Z0-9가-힣]/g, '_').slice(0, 80);
        const ssPath = join(screenshotDir, `${safeName}.png`);
        await page.screenshot({ path: ssPath, fullPage: true });
        pageInfo.screenshotPath = ssPath;
      }

      // API 호출 수집 (이미 scanPage에서 네트워크 인터셉트)
      result.pages.push(pageInfo);

      // 새 URL 큐에 추가
      for (const link of pageInfo.elements.links) {
        try {
          const linkUrl = new URL(link.href, current.url);
          if (linkUrl.hostname === baseHost && !visited.has(normalizeUrl(linkUrl.href))) {
            queue.push({ url: linkUrl.href, depth: current.depth + 1 });
          }
        } catch { /* invalid URL */ }
      }

      // 버튼 클릭으로 발견되는 URL도 추가
      for (const nav of pageInfo.navigatesTo) {
        try {
          const navUrl = new URL(nav, current.url);
          if (navUrl.hostname === baseHost && !visited.has(normalizeUrl(navUrl.href))) {
            queue.push({ url: navUrl.href, depth: current.depth + 1 });
          }
        } catch { /* invalid URL */ }
      }
    } catch (err) {
      // 페이지 로드 실패 → 건너뜀
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return result;
}

/** 개별 페이지 스캔: DOM 요소 + 네트워크 인터셉트 */
async function scanPage(page: Page, url: string, waitTime: number): Promise<PageInfo> {
  const apiCalls: PageInfo['apiCalls'] = [];

  // 네트워크 인터셉트 — API 호출 캡처
  page.on('response', async (response) => {
    const request = response.request();
    const resUrl = request.url();
    const resourceType = request.resourceType();

    if ((resourceType === 'xhr' || resourceType === 'fetch') && !isStaticResource(resUrl)) {
      apiCalls.push({
        method: request.method(),
        url: resUrl,
        responseStatus: response.status(),
        triggeredBy: null,
      });
    }
  });

  // 페이지 로드
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(waitTime);

  const title = await page.title();

  // DOM 스캔
  const elements = await page.evaluate(() => {
    // 링크
    const links = Array.from(document.querySelectorAll('a[href]')).map((el, i) => {
      const a = el as HTMLAnchorElement;
      return {
        text: a.textContent?.trim().slice(0, 100) || '',
        href: a.href,
        selector: a.id ? `#${a.id}` : `a:nth-of-type(${i + 1})`,
      };
    });

    // 버튼
    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"]')
    ).map((el, i) => {
      const btn = el as HTMLElement;
      return {
        text: btn.textContent?.trim().slice(0, 100) || (btn as HTMLInputElement).value || '',
        selector: btn.id ? `#${btn.id}` : `button:nth-of-type(${i + 1})`,
        navigatesTo: null as string | null,
      };
    });

    // 폼
    const forms = Array.from(document.querySelectorAll('form')).map((el) => {
      const form = el as HTMLFormElement;
      const fields = Array.from(form.querySelectorAll('input, select, textarea')).map((f) => {
        const field = f as HTMLInputElement;
        return {
          name: field.name || field.id || '',
          fieldType: field.type || field.tagName.toLowerCase(),
          required: field.required,
        };
      });
      return {
        id: form.id || null,
        action: form.action || null,
        method: form.method?.toUpperCase() || 'GET',
        fields,
      };
    });

    return { links, buttons, forms };
  });

  // 네비게이션 대상 URL 수집
  const navigatesTo = [
    ...new Set(elements.links.map(l => l.href).filter(Boolean)),
  ];

  // 로그인 페이지 감지
  const authRequired = await page.evaluate(() => {
    const html = document.body?.innerHTML?.toLowerCase() || '';
    return html.includes('login') || html.includes('sign in') || html.includes('로그인');
  });

  return {
    url,
    title,
    screenshotPath: null,
    elements,
    apiCalls,
    navigatesTo,
    authRequired,
  };
}

/** 인증 설정 */
async function setupAuth(context: BrowserContext, baseUrl: string, auth: AuthOptions) {
  const host = new URL(baseUrl).hostname;

  if (auth.cookie) {
    const cookies = auth.cookie.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name, value: rest.join('='), domain: host, path: '/' };
    });
    await context.addCookies(cookies);
  }

  if (auth.bearer) {
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${auth.bearer}`,
    });
  }

  if (auth.loginUrl && auth.credentials) {
    const page = await context.newPage();
    await page.goto(auth.loginUrl, { waitUntil: 'networkidle' });
    for (const [field, value] of Object.entries(auth.credentials)) {
      await page.fill(`[name="${field}"], #${field}, input[type="${field}"]`, value).catch(() => {});
    }
    const submitSelector = auth.submitSelector || 'button[type="submit"], button:has-text("로그인"), button:has-text("Login")';
    await page.click(submitSelector).catch(() => {});
    await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {});
    await page.close();
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
    u.pathname = path;
    return u.href;
  } catch {
    return url;
  }
}

function isStaticResource(url: string): boolean {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)(\?|$)/i.test(url);
}
