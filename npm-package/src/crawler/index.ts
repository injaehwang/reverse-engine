import { chromium, type Page, type BrowserContext } from 'playwright';
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
  onProgress?: (msg: string) => void;
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
    waitTime = 2000,
    ignorePatterns = ['/logout', '/signout', '/auth/logout'],
    onProgress,
  } = options;

  const screenshotDir = join(outputDir, 'screenshots');
  if (screenshot) await mkdir(screenshotDir, { recursive: true });

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
    ignoreHTTPSErrors: true,
  });

  // ── 인증 ──
  if (options.auth) {
    onProgress?.('로그인 처리 중...');
    await handleAuth(context, url, options.auth, onProgress);
  }

  const result: CrawlResult = {
    targetUrl: url,
    pages: [],
    timestamp: new Date().toISOString(),
  };

  const visited = new Set<string>();
  const queue: { url: string; depth: number }[] = [{ url, depth: 0 }];
  const baseHost = new URL(url).hostname;
  let ssCounter = 0;

  while (queue.length > 0 && result.pages.length < maxPages) {
    const current = queue.shift()!;
    const normalizedUrl = normalizeUrl(current.url);

    if (visited.has(normalizedUrl) || current.depth > maxDepth) continue;
    if (ignorePatterns.some(p => normalizedUrl.includes(p))) continue;
    visited.add(normalizedUrl);

    const page = await context.newPage();
    try {
      onProgress?.(`[${result.pages.length + 1}] ${current.url}`);

      // ── 네트워크 인터셉트 ──
      const apiCalls: PageInfo['apiCalls'] = [];
      page.on('response', (response) => {
        try {
          const req = response.request();
          const rt = req.resourceType();
          if ((rt === 'xhr' || rt === 'fetch') && !isStaticResource(req.url())) {
            apiCalls.push({
              method: req.method(),
              url: req.url(),
              responseStatus: response.status(),
              triggeredBy: null,
            });
          }
        } catch { /* ignore */ }
      });

      // ── 페이지 로드 (SPA 대응: domcontentloaded 후 추가 대기) ──
      const response = await page.goto(current.url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // 로그인 리다이렉트 감지: URL이 다른 도메인으로 바뀌었으면 로그인 필요
      const currentHost = new URL(page.url()).hostname;
      if (currentHost !== baseHost) {
        onProgress?.(`  ⚠ 리다이렉트 감지: ${page.url()} (인증 필요?)`);
        await page.close();
        continue;
      }

      // SPA 렌더링 대기
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(waitTime);

      const title = await page.title();
      onProgress?.(`[${result.pages.length + 1}] ${title || current.url}`);

      // ── DOM 스캔 ──
      const elements = await scanDOM(page);

      // ── 스크린샷 ──
      let screenshotPath: string | null = null;
      if (screenshot) {
        ssCounter++;
        const ssName = `${String(ssCounter).padStart(3, '0')}_page_${safePath(current.url)}.png`;
        screenshotPath = join(screenshotDir, ssName);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
        if (screenshotPath) onProgress?.(`  📷 ${ssName}`);
      }

      // ── 클릭 탐색 ──
      const clickResults = await probeClickables(page, screenshotDir, screenshot, ssCounter, waitTime, onProgress);
      ssCounter = clickResults.ssCounter;

      // 발견된 URL 큐에 추가
      for (const link of elements.links) {
        addToQueue(link.href, current.url, current.depth + 1, baseHost, visited, queue);
      }
      for (const discovered of clickResults.discoveredUrls) {
        addToQueue(discovered, current.url, current.depth + 1, baseHost, visited, queue);
      }

      // 클릭으로 발견된 버튼 merge
      for (const cr of clickResults.interactions) {
        const btn = elements.buttons.find(b => b.selector === cr.selector);
        if (btn) btn.navigatesTo = cr.navigatedTo;
      }

      const pageInfo: PageInfo = {
        url: current.url,
        title,
        screenshotPath,
        elements: {
          ...elements,
          buttons: [
            ...elements.buttons,
            ...clickResults.interactions
              .filter(i => i.type === 'modal' || i.type === 'popup')
              .map(i => ({ text: i.label, selector: i.selector, navigatesTo: i.navigatedTo })),
          ],
        },
        apiCalls,
        navigatesTo: [...new Set([...elements.links.map(l => l.href), ...clickResults.discoveredUrls])],
        authRequired: false,
      };

      if (clickResults.screenshots.length > 0) {
        (pageInfo as any).interactionScreenshots = clickResults.screenshots;
      }

      result.pages.push(pageInfo);
      onProgress?.(`[${result.pages.length}] ✓ ${title || current.url} (링크 ${elements.links.length}, 버튼 ${elements.buttons.length}, API ${apiCalls.length})`);
    } catch (err: any) {
      // 에러를 삼키지 않고 표시
      onProgress?.(`  ✗ ${current.url}: ${err.message?.slice(0, 80) || 'unknown error'}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return result;
}

function addToQueue(href: string, baseUrl: string, depth: number, baseHost: string, visited: Set<string>, queue: { url: string; depth: number }[]) {
  try {
    const u = new URL(href, baseUrl);
    if (u.hostname === baseHost && !visited.has(normalizeUrl(u.href))) {
      queue.push({ url: u.href, depth });
    }
  } catch { /* invalid URL */ }
}

// ─── 인증 (Keycloak / 일반 폼 / 쿠키 / Bearer) ───

async function handleAuth(context: BrowserContext, baseUrl: string, auth: AuthOptions, onProgress?: (msg: string) => void) {
  const host = new URL(baseUrl).hostname;

  if (auth.cookie) {
    const cookies = auth.cookie.split(';').map(c => {
      const [name, ...rest] = c.trim().split('=');
      return { name, value: rest.join('='), domain: host, path: '/' };
    });
    await context.addCookies(cookies);
    onProgress?.('쿠키 인증 설정 완료');
    return;
  }

  if (auth.bearer) {
    await context.setExtraHTTPHeaders({ Authorization: `Bearer ${auth.bearer}` });
    onProgress?.('Bearer 토큰 설정 완료');
    return;
  }

  // 폼 로그인 (Keycloak 리다이렉트 포함)
  if (auth.credentials) {
    const page = await context.newPage();

    // 로그인 URL이 있으면 직접 이동, 없으면 메인 URL 접속 (리다이렉트 대기)
    const loginTarget = auth.loginUrl
      ? (auth.loginUrl.startsWith('http') ? auth.loginUrl : new URL(auth.loginUrl, baseUrl).href)
      : baseUrl;

    onProgress?.(`로그인 페이지 이동: ${loginTarget}`);
    await page.goto(loginTarget, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    const loginPageUrl = page.url();
    onProgress?.(`로그인 페이지: ${loginPageUrl}`);

    // ID/PW 입력 — 다양한 셀렉터 시도
    const { email, password, username, id, pw, ...rest } = auth.credentials;
    const idValue = email || username || id || Object.values(auth.credentials)[0];
    const pwValue = password || pw || Object.values(auth.credentials)[1];

    if (idValue) {
      const idFilled = await tryFill(page, [
        'input[name="username"]', 'input[name="email"]', 'input[name="login"]',
        'input[name="userId"]', 'input[name="id"]',
        'input[type="email"]', 'input[type="text"]:not([name="password"])',
        '#username', '#email', '#login', '#userId',
      ], idValue);
      onProgress?.(idFilled ? `ID 입력 완료` : `⚠ ID 필드를 찾지 못함`);
    }

    if (pwValue) {
      const pwFilled = await tryFill(page, [
        'input[name="password"]', 'input[name="pw"]',
        'input[type="password"]',
        '#password', '#pw',
      ], pwValue);
      onProgress?.(pwFilled ? `PW 입력 완료` : `⚠ PW 필드를 찾지 못함`);
    }

    // 추가 필드 (Keycloak 커스텀 필드 등)
    for (const [field, value] of Object.entries(rest)) {
      await tryFill(page, [`[name="${field}"]`, `#${field}`], value);
    }

    // 제출
    const submitSelectors = auth.submitSelector
      ? [auth.submitSelector]
      : [
          'button[type="submit"]', 'input[type="submit"]',
          '#kc-login',  // Keycloak
          'button:has-text("로그인")', 'button:has-text("Login")',
          'button:has-text("Sign in")', 'button:has-text("Log in")',
          'button[name="login"]',
        ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          submitted = true;
          onProgress?.(`제출 버튼 클릭: ${sel}`);
          break;
        }
      } catch { /* next */ }
    }

    if (!submitted) {
      // Enter 키로 제출 시도
      await page.keyboard.press('Enter');
      onProgress?.('Enter 키로 제출');
    }

    // 로그인 완료 대기 — URL이 바뀌거나 페이지가 로드될 때까지
    await page.waitForURL((url) => url.toString() !== loginPageUrl, { timeout: 15000 }).catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    const afterUrl = page.url();
    const loginSuccess = afterUrl !== loginPageUrl;
    onProgress?.(loginSuccess
      ? `✓ 로그인 성공 → ${afterUrl}`
      : `⚠ 로그인 후 URL 변화 없음 (${afterUrl})`
    );

    await page.close();
  }
}

async function tryFill(page: Page, selectors: string[], value: string): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1000 })) {
        await el.fill(value);
        return true;
      }
    } catch { /* next */ }
  }
  return false;
}

// ─── DOM 스캔 ───

async function scanDOM(page: Page) {
  return page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]')).map((el) => {
      const a = el as HTMLAnchorElement;
      return {
        text: a.textContent?.trim().slice(0, 100) || '',
        href: a.href,
        selector: buildSelector(a),
      };
    });

    const buttons = Array.from(
      document.querySelectorAll('button, [role="button"], input[type="submit"], [onclick], [data-toggle], [data-bs-toggle]')
    ).map((el) => {
      const btn = el as HTMLElement;
      return {
        text: btn.textContent?.trim().slice(0, 100) || (btn as HTMLInputElement).value || '',
        selector: buildSelector(btn),
        navigatesTo: null as string | null,
      };
    });

    const forms = Array.from(document.querySelectorAll('form')).map((el) => {
      const form = el as HTMLFormElement;
      const fields = Array.from(form.querySelectorAll('input, select, textarea')).map((f) => {
        const field = f as HTMLInputElement;
        return { name: field.name || field.id || '', fieldType: field.type || field.tagName.toLowerCase(), required: field.required };
      });
      return { id: form.id || null, action: form.action || null, method: form.method?.toUpperCase() || 'GET', fields };
    });

    function buildSelector(el: Element): string {
      if (el.id) return `#${el.id}`;
      const testId = el.getAttribute('data-testid') || el.getAttribute('data-test');
      if (testId) return `[data-testid="${testId}"]`;
      const tag = el.tagName.toLowerCase();
      const cls = Array.from(el.classList).slice(0, 2).join('.');
      if (cls) return `${tag}.${cls}`;
      return `${tag}:nth-of-type(${getIndex(el)})`;
    }

    function getIndex(el: Element): number {
      let idx = 1; let sib = el.previousElementSibling;
      while (sib) { if (sib.tagName === el.tagName) idx++; sib = sib.previousElementSibling; }
      return idx;
    }

    return { links, buttons, forms };
  });
}

// ─── 클릭 탐색 ───

interface InteractionResult {
  selector: string;
  label: string;
  type: 'navigate' | 'modal' | 'popup' | 'dropdown' | 'none';
  navigatedTo: string | null;
  screenshotPath: string | null;
}

async function probeClickables(
  page: Page, screenshotDir: string, screenshot: boolean,
  ssCounter: number, waitTime: number, onProgress?: (msg: string) => void,
): Promise<{ interactions: InteractionResult[]; discoveredUrls: string[]; screenshots: string[]; ssCounter: number }> {
  const interactions: InteractionResult[] = [];
  const discoveredUrls: string[] = [];
  const screenshots: string[] = [];

  const clickTargets = await page.evaluate(() => {
    const targets: { selector: string; label: string }[] = [];
    const seen = new Set<Element>();

    // 명시적 클릭 요소
    document.querySelectorAll(
      'button, [role="button"], [data-toggle], [data-bs-toggle], ' +
      '[role="tab"], .tab, .nav-link, .dropdown-toggle, ' +
      '[aria-haspopup], [aria-expanded], [onclick], [ng-click], ' +
      '[v-on\\:click], [@click]'
    ).forEach(el => seen.add(el));

    // cursor:pointer 요소
    document.querySelectorAll('div, span, li, td, tr, img, svg, i, label, p, section, article').forEach(el => {
      if (seen.has(el)) return;
      const style = window.getComputedStyle(el);
      if (style.cursor === 'pointer' && el.tagName !== 'BUTTON' && el.tagName !== 'A') {
        seen.add(el);
      }
    });

    seen.forEach(el => {
      const htmlEl = el as HTMLElement;
      const rect = htmlEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.top >= window.innerHeight) return;

      let selector = '';
      if (htmlEl.id) selector = `#${htmlEl.id}`;
      else {
        const text = htmlEl.textContent?.trim().slice(0, 30) || '';
        const tag = htmlEl.tagName.toLowerCase();
        if (text) selector = `${tag}:has-text("${text.replace(/"/g, "'")}")`;
        else {
          const cls = Array.from(htmlEl.classList).slice(0, 2).join('.');
          selector = cls ? `${tag}.${cls}` : tag;
        }
      }

      targets.push({ selector, label: htmlEl.textContent?.trim().slice(0, 50) || '' });
    });

    return targets.slice(0, 30);
  });

  for (const target of clickTargets) {
    try {
      const beforeUrl = page.url();
      const beforeHTML = await page.evaluate(() => document.body.innerHTML.length);

      await page.click(target.selector, { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(Math.min(waitTime, 1000));

      const afterUrl = page.url();
      const afterHTML = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0);

      const hasModal = await page.evaluate(() =>
        !!document.querySelector(
          '[role="dialog"], .modal.show, .modal[open], dialog[open], ' +
          '.popup, .overlay, [aria-modal="true"], [class*="modal"][class*="open"]'
        )
      ).catch(() => false);

      let type: InteractionResult['type'] = 'none';
      let navigatedTo: string | null = null;

      if (afterUrl !== beforeUrl) {
        type = 'navigate'; navigatedTo = afterUrl;
        discoveredUrls.push(afterUrl);
      } else if (hasModal) {
        type = 'modal';
      } else if (Math.abs(afterHTML - beforeHTML) > 200) {
        type = 'dropdown';
      }

      if (screenshot && (type === 'modal' || type === 'dropdown')) {
        ssCounter++;
        const ssName = `${String(ssCounter).padStart(3, '0')}_click_${safePath(target.label || target.selector)}.png`;
        const ssPath = join(screenshotDir, ssName);
        await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
        screenshots.push(ssPath);
        interactions.push({ selector: target.selector, label: target.label, type, navigatedTo, screenshotPath: ssPath });
        onProgress?.(`  📷 ${type}: ${target.label || target.selector}`);
      } else {
        interactions.push({ selector: target.selector, label: target.label, type, navigatedTo, screenshotPath: null });
      }

      // 모달 닫기
      if (hasModal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
      // 네비게이션 복귀
      if (afterUrl !== beforeUrl) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    } catch { /* skip */ }
  }

  return { interactions, discoveredUrls, screenshots, ssCounter };
}

// ─── 유틸 ───

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = ''; u.search = '';
    let path = u.pathname;
    if (path.endsWith('/') && path.length > 1) path = path.slice(0, -1);
    u.pathname = path;
    return u.href;
  } catch { return url; }
}

function isStaticResource(url: string): boolean {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)(\?|$)/i.test(url);
}

function safePath(s: string): string {
  return s.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 50);
}
