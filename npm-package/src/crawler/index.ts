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

  // ── 로그 파일 ──
  await mkdir(outputDir, { recursive: true });
  const logPath = join(outputDir, 'crawl.log');
  const logLines: string[] = [];
  const log = (msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    logLines.push(`[${ts}] ${msg}`);
    onProgress?.(msg);
  };
  const flushLog = async () => {
    await writeFile(logPath, logLines.join('\n'), 'utf-8');
  };

  log(`크롤링 시작: ${url}`);
  log(`설정: maxDepth=${maxDepth}, maxPages=${maxPages}, headless=${headless}, waitTime=${waitTime}`);

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
    log('로그인 처리 중...');
    await handleAuth(context, url, options.auth, log, outputDir);
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
    const pageNum = result.pages.length + 1;
    log(`[${pageNum}] ── 시작: ${current.url} (depth=${current.depth})`);

    // 이 페이지의 수집 결과 (각 단계가 실패해도 부분 결과 보존)
    const apiCalls: PageInfo['apiCalls'] = [];
    let title = '';
    let screenshotPath: string | null = null;
    let elements = { links: [] as any[], buttons: [] as any[], forms: [] as any[] };
    let clickDiscovered: string[] = [];

    try {
      // ── Step 1: 네트워크 인터셉트 ──
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

      // ── Step 2: 페이지 로드 ──
      log(`[${pageNum}] 로드 중...`);
      await page.goto(current.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 리다이렉트 감지 (완전히 다른 도메인만 skip, 서브도메인은 허용)
      const currentHost = new URL(page.url()).hostname;
      const baseDomain = baseHost.split('.').slice(-2).join('.');
      const currentDomain = currentHost.split('.').slice(-2).join('.');
      if (currentDomain !== baseDomain && currentHost !== 'localhost' && !currentHost.match(/^(\d+\.){3}\d+$/)) {
        log(`[${pageNum}] ⚠ 다른 도메인으로 리다이렉트: ${page.url()} → skip`);
        log(`[${pageNum}]   base=${baseDomain}, current=${currentDomain}`);
        await page.close();
        continue;
      }

      // SPA 렌더링 대기
      await page.waitForLoadState('networkidle').catch(() => {
        log(`[${pageNum}] networkidle 타임아웃 (계속 진행)`);
      });
      await page.waitForTimeout(waitTime);

      title = await page.title().catch(() => '') || '';
      log(`[${pageNum}] 로드 완료: "${title}" (${page.url()})`);
    } catch (loadErr: any) {
      log(`[${pageNum}] ✗ 페이지 로드 실패: ${loadErr.message}`);
      await page.close();
      continue; // 로드 자체 실패하면 건너뜀
    }

    // ── Step 3: DOM 스캔 (실패해도 계속) ──
    try {
      elements = await scanDOM(page);
      log(`[${pageNum}] DOM: 링크 ${elements.links.length}, 버튼 ${elements.buttons.length}, 폼 ${elements.forms.length}`);
    } catch (domErr: any) {
      log(`[${pageNum}] ⚠ DOM 스캔 실패: ${domErr.message}`);
    }

    // ── Step 4: 스크린샷 (실패해도 계속) ──
    if (screenshot) {
      try {
        ssCounter++;
        const ssName = `${String(ssCounter).padStart(3, '0')}_page_${safePath(current.url)}.png`;
        screenshotPath = join(screenshotDir, ssName);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log(`[${pageNum}] 📷 ${ssName}`);
      } catch (ssErr: any) {
        log(`[${pageNum}] ⚠ 스크린샷 실패: ${ssErr.message}`);
        screenshotPath = null;
      }
    }

    // ── Step 5: 클릭 탐색 (실패해도 계속) ──
    try {
      const clickResults = await probeClickables(page, screenshotDir, screenshot, ssCounter, waitTime, log);
      ssCounter = clickResults.ssCounter;
      clickDiscovered = clickResults.discoveredUrls;
      log(`[${pageNum}] 클릭 탐색: ${clickResults.interactions.length}개 요소, 발견 URL ${clickResults.discoveredUrls.length}개`);
    } catch (clickErr: any) {
      log(`[${pageNum}] ⚠ 클릭 탐색 실패: ${clickErr.message}`);
    }

    // ── Step 5.5: 폼 자동 작성 + 제출 + 멀티 스텝 추적 ──
    let formScreenshots: string[] = [];
    try {
      const formResults = await probeForms(page, screenshotDir, screenshot, ssCounter, waitTime, log, baseHost, visited, queue, current.depth);
      ssCounter = formResults.ssCounter;
      formScreenshots = formResults.screenshots;
      for (const discovered of formResults.discoveredUrls) {
        addToQueue(discovered, current.url, current.depth + 1, baseHost, visited, queue);
      }
    } catch (formErr: any) {
      log(`[${pageNum}] ⚠ 폼 탐색 실패: ${formErr.message}`);
    }

    // ── Step 6: 결과 저장 (무조건) ──
    // 큐에 새 URL 추가
    for (const link of elements.links) {
      addToQueue(link.href, current.url, current.depth + 1, baseHost, visited, queue);
    }
    for (const discovered of clickDiscovered) {
      addToQueue(discovered, current.url, current.depth + 1, baseHost, visited, queue);
    }

    // 화면 흐름 기록
    const flows: { from: string; trigger: string; to: string }[] = [];
    for (const link of elements.links) {
      if (link.href && link.href !== current.url) {
        flows.push({ from: current.url, trigger: link.text || link.selector, to: link.href });
      }
    }
    for (const disc of clickDiscovered) {
      flows.push({ from: current.url, trigger: '(클릭)', to: disc });
    }

    const pageInfo: PageInfo = {
      url: current.url,
      title,
      screenshotPath,
      elements,
      apiCalls,
      navigatesTo: [...new Set([...elements.links.map(l => l.href), ...clickDiscovered])],
      authRequired: false,
    };
    (pageInfo as any).flows = flows;
    (pageInfo as any).formScreenshots = formScreenshots;

    result.pages.push(pageInfo);
    log(`[${pageNum}] ✓ 저장 완료 (링크 ${elements.links.length}, 버튼 ${elements.buttons.length}, API ${apiCalls.length}, 폼 ${elements.forms.length}, 큐 ${queue.length})`);

    await page.close();

    // 매 페이지마다 로그 flush
    await flushLog();
  }

  log(`크롤링 종료: 페이지 ${result.pages.length}, 큐 잔여 ${queue.length}, 방문 ${visited.size}`);
  await flushLog();

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

async function handleAuth(context: BrowserContext, baseUrl: string, auth: AuthOptions, onProgress: (msg: string) => void, outputDir: string) {
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
    const screenshotDir = join(outputDir, 'screenshots');
    await mkdir(screenshotDir, { recursive: true });

    // Step 1: 메인 URL 접속 → Keycloak 등으로 리다이렉트 대기
    onProgress(`메인 URL 접속: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // 리다이렉트 체인 완료 대기
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000);
      const state = await page.evaluate(() => document.readyState).catch(() => '');
      if (state === 'complete') break;
    }
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);

    let currentUrl = page.url();
    onProgress(`리다이렉트 결과: ${currentUrl}`);

    // 로그인 URL이 별도로 지정된 경우
    if (auth.loginUrl) {
      const loginTarget = auth.loginUrl.startsWith('http')
        ? auth.loginUrl
        : new URL(auth.loginUrl, baseUrl).href;

      // 아직 로그인 페이지가 아니면 직접 이동
      if (!currentUrl.includes(loginTarget.replace(/https?:\/\/[^/]+/, ''))) {
        onProgress(`로그인 페이지로 이동: ${loginTarget}`);
        await page.goto(loginTarget, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(2000);
        currentUrl = page.url();
        onProgress(`현재 URL: ${currentUrl}`);
      }
    }

    // 로그인 페이지 스크린샷
    await page.screenshot({
      path: join(screenshotDir, '000_login_page.png'),
      fullPage: true,
    }).catch(() => {});
    onProgress(`📷 로그인 페이지 스크린샷 저장`);

    const loginPageUrl = currentUrl;

    // Step 2: 로그인 폼 필드 대기 (최대 10초)
    onProgress('로그인 폼 대기 중...');
    const hasPasswordField = await page.locator('input[type="password"]')
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (!hasPasswordField) {
      onProgress('⚠ 비밀번호 필드를 찾지 못함');
      // 현재 페이지의 모든 input 목록 출력
      const inputs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('input')).map(el => ({
          name: el.name, id: el.id, type: el.type, placeholder: el.placeholder,
          visible: el.offsetWidth > 0 && el.offsetHeight > 0,
        }))
      ).catch(() => []);
      onProgress(`  페이지 input 필드: ${JSON.stringify(inputs)}`);
    }

    // Step 3: ID/PW 입력
    const { email, password, username, id, pw, ...rest } = auth.credentials;
    const idValue = email || username || id || Object.values(auth.credentials)[0];
    const pwValue = password || pw || Object.values(auth.credentials)[1];

    if (idValue) {
      const idFilled = await tryFill(page, [
        '#username',  // Keycloak 기본
        '#email',
        '#login',
        'input[name="username"]',
        'input[name="email"]',
        'input[name="login"]',
        'input[name="userId"]',
        'input[name="id"]',
        'input[type="email"]',
        'input[type="text"]',  // 마지막 수단: 첫 번째 text input
      ], idValue);
      onProgress(idFilled ? `✓ ID 입력 완료: ${idValue}` : `⚠ ID 필드를 찾지 못함`);
    }

    if (pwValue) {
      const pwFilled = await tryFill(page, [
        '#password',  // Keycloak 기본
        'input[name="password"]',
        'input[name="pw"]',
        'input[type="password"]',
      ], pwValue);
      onProgress(pwFilled ? `✓ PW 입력 완료` : `⚠ PW 필드를 찾지 못함`);
    }

    for (const [field, value] of Object.entries(rest)) {
      await tryFill(page, [`[name="${field}"]`, `#${field}`], value);
    }

    // 입력 후 스크린샷
    await page.screenshot({
      path: join(screenshotDir, '000_login_filled.png'),
      fullPage: true,
    }).catch(() => {});

    // Step 4: 제출
    const submitSelectors = auth.submitSelector
      ? [auth.submitSelector]
      : [
          '#kc-login',  // Keycloak
          '#kc-form-login input[type="submit"]',
          'button[type="submit"]',
          'input[type="submit"]',
          'button[name="login"]',
        ];

    let submitted = false;
    for (const sel of submitSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 2000 })) {
          onProgress(`제출 버튼 발견: ${sel}`);
          await btn.click();
          submitted = true;
          onProgress(`✓ 제출 클릭: ${sel}`);
          break;
        }
      } catch { /* next */ }
    }

    if (!submitted) {
      // password 필드에서 Enter
      try {
        await page.locator('input[type="password"]').press('Enter');
        submitted = true;
        onProgress('Enter 키로 제출 (password 필드)');
      } catch {
        await page.keyboard.press('Enter');
        onProgress('Enter 키로 제출 (전역)');
      }
    }

    // Step 5: 로그인 완료 대기
    onProgress('로그인 처리 대기 (최대 30초)...');

    await page.waitForURL(
      (url) => url.toString() !== loginPageUrl,
      { timeout: 30000 },
    ).catch(() => {
      onProgress('⚠ 30초 후에도 URL 변화 없음');
    });

    // 리다이렉트 체인 완료 대기
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);

    const afterUrl = page.url();
    onProgress(`로그인 후 URL: ${afterUrl}`);

    // 로그인 후 스크린샷
    await page.screenshot({
      path: join(screenshotDir, '000_after_login.png'),
      fullPage: true,
    }).catch(() => {});

    // 쿠키 확인
    const cookies = await context.cookies();
    onProgress(`세션 쿠키: ${cookies.length}개`);
    for (const c of cookies.slice(0, 10)) {
      onProgress(`  쿠키: ${c.name}=${c.value.slice(0, 20)}... (${c.domain})`);
    }

    // Step 6: 메인 URL로 이동하여 인증 확인
    const baseHostName = new URL(baseUrl).hostname;
    const afterHost = new URL(afterUrl).hostname;

    if (afterHost !== baseHostName) {
      onProgress(`메인 URL로 복귀: ${baseUrl}`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(3000);
    }

    const finalUrl = page.url();
    const finalHost = new URL(finalUrl).hostname;

    if (finalHost === baseHostName || finalHost === 'localhost') {
      onProgress(`✓ 로그인 성공! → ${finalUrl}`);
      await page.screenshot({
        path: join(screenshotDir, '000_main_after_login.png'),
        fullPage: true,
      }).catch(() => {});
    } else {
      onProgress(`✗ 로그인 실패 — 여전히 다른 도메인: ${finalUrl}`);
    }

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
  ssCounter: number, waitTime: number, log: (msg: string) => void,
): Promise<{ interactions: InteractionResult[]; discoveredUrls: string[]; screenshots: string[]; ssCounter: number }> {
  const interactions: InteractionResult[] = [];
  const discoveredUrls: string[] = [];
  const screenshots: string[] = [];

  // ── 모든 보이는 요소의 좌표와 정보를 수집 ──
  // React/Vue는 onclick 속성이 없으므로, 화면에 보이는 모든 요소를
  // 좌표 기반으로 클릭하고 반응을 관찰한다
  const clickTargets = await page.evaluate(() => {
    const targets: { x: number; y: number; w: number; h: number; tag: string; text: string; idx: number }[] = [];
    const skipTags = new Set(['HTML', 'BODY', 'HEAD', 'SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'BR', 'HR']);

    // TreeWalker로 모든 요소 순회
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let idx = 0;
    let node: Node | null = walker.currentNode;

    while (node) {
      const el = node as HTMLElement;
      if (!skipTags.has(el.tagName)) {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);

        // 보이는 요소 + 클릭 가능성이 있는 것
        const isVisible = rect.width > 10 && rect.height > 10 &&
          rect.top >= 0 && rect.top < window.innerHeight &&
          style.display !== 'none' && style.visibility !== 'hidden' &&
          parseFloat(style.opacity) > 0;

        const isClickable =
          el.tagName === 'BUTTON' || el.tagName === 'A' ||
          el.tagName === 'INPUT' || el.tagName === 'SELECT' ||
          el.getAttribute('role') === 'button' ||
          el.getAttribute('role') === 'tab' ||
          el.getAttribute('role') === 'menuitem' ||
          el.getAttribute('role') === 'link' ||
          el.getAttribute('tabindex') !== null ||
          el.hasAttribute('onclick') ||
          el.hasAttribute('data-toggle') ||
          el.hasAttribute('data-bs-toggle') ||
          style.cursor === 'pointer';

        if (isVisible && isClickable) {
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const text = el.textContent?.trim().slice(0, 50) || '';

          // 겹치는 요소 제거: 같은 좌표에 여러 요소가 있으면 가장 안쪽 것만
          const duplicate = targets.find(t =>
            Math.abs(t.x - cx) < 5 && Math.abs(t.y - cy) < 5
          );
          if (!duplicate) {
            targets.push({
              x: Math.round(cx),
              y: Math.round(cy),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              tag: el.tagName.toLowerCase(),
              text,
              idx: idx++,
            });
          }
        }
      }
      node = walker.nextNode();
    }

    return targets.slice(0, 50); // 최대 50개
  });

  log(`  클릭 대상: ${clickTargets.length}개 요소`);

  for (let i = 0; i < clickTargets.length; i++) {
    const target = clickTargets[i];
    const label = target.text || `${target.tag}(${target.x},${target.y})`;

    try {
      const beforeUrl = page.url();
      const beforeHTML = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0);

      // 좌표 기반 클릭 (셀렉터 문법 오류 없음)
      await page.mouse.click(target.x, target.y);
      await page.waitForTimeout(800);

      const afterUrl = page.url();
      const afterHTML = await page.evaluate(() => document.body.innerHTML.length).catch(() => 0);

      // 모달/다이얼로그 감지
      const hasModal = await page.evaluate(() =>
        !!document.querySelector(
          '[role="dialog"], .modal.show, .modal[open], dialog[open], ' +
          '[aria-modal="true"], [class*="modal"], [class*="dialog"], ' +
          '[class*="popup"], [class*="overlay"][class*="open"], ' +
          '[class*="drawer"]'
        )
      ).catch(() => false);

      // 새 요소 출현 감지 (토스트, 드롭다운 등)
      const domDelta = Math.abs(afterHTML - beforeHTML);

      let type: InteractionResult['type'] = 'none';
      let navigatedTo: string | null = null;

      if (afterUrl !== beforeUrl) {
        type = 'navigate';
        navigatedTo = afterUrl;
        discoveredUrls.push(afterUrl);
        log(`  [${i + 1}/${clickTargets.length}] 🔗 ${label} → ${afterUrl}`);
      } else if (hasModal) {
        type = 'modal';
        log(`  [${i + 1}/${clickTargets.length}] 📋 모달: ${label}`);
      } else if (domDelta > 100) {
        type = 'dropdown';
        log(`  [${i + 1}/${clickTargets.length}] 📂 변화: ${label} (DOM ±${domDelta})`);
      }

      // 반응이 있으면 스크린샷
      if (screenshot && type !== 'none') {
        ssCounter++;
        const ssName = `${String(ssCounter).padStart(3, '0')}_${type}_${safePath(label)}.png`;
        const ssPath = join(screenshotDir, ssName);
        await page.screenshot({ path: ssPath, fullPage: type === 'navigate' }).catch(() => {});
        screenshots.push(ssPath);
        interactions.push({ selector: `coords(${target.x},${target.y})`, label, type, navigatedTo, screenshotPath: ssPath });
      } else if (type !== 'none') {
        interactions.push({ selector: `coords(${target.x},${target.y})`, label, type, navigatedTo, screenshotPath: null });
      }

      // 복원
      if (hasModal) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        // ESC로 안 닫히면 외부 클릭
        const stillModal = await page.evaluate(() =>
          !!document.querySelector('[role="dialog"], .modal.show, [aria-modal="true"]')
        ).catch(() => false);
        if (stillModal) {
          await page.mouse.click(10, 10); // 화면 구석 클릭
          await page.waitForTimeout(500);
        }
      }
      if (afterUrl !== beforeUrl) {
        await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
    } catch { /* skip */ }
  }

  return { interactions, discoveredUrls, screenshots, ssCounter };
}

// ─── 폼 자동 작성 + 제출 + 멀티스텝 추적 ───

async function probeForms(
  page: Page, screenshotDir: string, screenshot: boolean,
  ssCounter: number, waitTime: number, log: (msg: string) => void,
  baseHost: string, visited: Set<string>,
  queue: { url: string; depth: number }[], currentDepth: number,
): Promise<{ discoveredUrls: string[]; screenshots: string[]; ssCounter: number }> {
  const discoveredUrls: string[] = [];
  const screenshots: string[] = [];

  // 페이지의 모든 폼 정보 수집
  const formInfos = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('form')).map((form, fi) => {
      const fields = Array.from(form.querySelectorAll('input, select, textarea')).map(el => {
        const input = el as HTMLInputElement;
        const rect = input.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          type: input.type || '',
          name: input.name || input.id || '',
          placeholder: input.placeholder || '',
          required: input.required,
          visible: rect.width > 0 && rect.height > 0,
          options: el.tagName === 'SELECT'
            ? Array.from((el as HTMLSelectElement).options).map(o => ({ value: o.value, text: o.text }))
            : [],
        };
      }).filter(f => f.visible);

      return { index: fi, fieldCount: fields.length, fields };
    }).filter(f => f.fieldCount > 0);
  }).catch(() => []);

  if (formInfos.length === 0) return { discoveredUrls, screenshots, ssCounter };

  log(`  폼 발견: ${formInfos.length}개`);

  for (const formInfo of formInfos) {
    log(`  폼 #${formInfo.index}: ${formInfo.fieldCount}개 필드`);

    try {
      // 각 필드 자동 채우기
      for (const field of formInfo.fields) {
        try {
          const selector = field.name
            ? `form:nth-of-type(${formInfo.index + 1}) [name="${field.name}"], #${field.name}`
            : `form:nth-of-type(${formInfo.index + 1}) ${field.tag}[type="${field.type}"]`;

          if (field.tag === 'select' && field.options.length > 0) {
            // select: 첫 번째 비어있지 않은 옵션 선택
            const option = field.options.find(o => o.value && o.value !== '') || field.options[1];
            if (option) {
              await page.selectOption(selector, option.value).catch(() => {});
              log(`    select "${field.name}": "${option.text}"`);
            }
          } else if (field.tag === 'textarea') {
            await page.fill(selector, '테스트 입력 내용입니다.').catch(() => {});
          } else if (field.type === 'checkbox' || field.type === 'radio') {
            await page.check(selector).catch(() => {});
          } else if (field.type === 'file') {
            // 파일 업로드는 건너뜀
          } else if (field.type === 'date') {
            await page.fill(selector, '2025-01-15').catch(() => {});
          } else if (field.type === 'number') {
            await page.fill(selector, '1').catch(() => {});
          } else if (field.type === 'tel') {
            await page.fill(selector, '010-1234-5678').catch(() => {});
          } else if (field.type === 'email') {
            await page.fill(selector, 'test@example.com').catch(() => {});
          } else if (field.type !== 'hidden' && field.type !== 'submit') {
            const dummy = generateDummyData(field.name, field.placeholder);
            await page.fill(selector, dummy).catch(() => {});
            log(`    input "${field.name}": "${dummy}"`);
          }
        } catch { /* skip field */ }
      }

      // 폼 작성 후 스크린샷
      if (screenshot) {
        ssCounter++;
        const ssName = `${String(ssCounter).padStart(3, '0')}_form_filled.png`;
        const ssPath = join(screenshotDir, ssName);
        await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
        screenshots.push(ssPath);
        log(`  📷 폼 작성 완료: ${ssName}`);
      }

      // 제출 버튼 클릭
      const beforeUrl = page.url();
      const submitClicked = await clickFormSubmit(page, formInfo.index);
      if (submitClicked) {
        log(`  폼 제출 클릭`);
        await page.waitForTimeout(waitTime);

        const afterUrl = page.url();

        // 제출 후 스크린샷
        if (screenshot) {
          ssCounter++;
          const ssName = `${String(ssCounter).padStart(3, '0')}_form_submitted.png`;
          const ssPath = join(screenshotDir, ssName);
          await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
          screenshots.push(ssPath);
          log(`  📷 폼 제출 결과: ${ssName}`);
        }

        // URL 변화 → 새 페이지 발견
        if (afterUrl !== beforeUrl) {
          discoveredUrls.push(afterUrl);
          log(`  → 이동: ${afterUrl}`);

          // 멀티 스텝 추적: 다음 화면에도 폼이 있으면 계속
          const nextSteps = await trackMultiStep(page, screenshotDir, screenshot, ssCounter, waitTime, log);
          ssCounter = nextSteps.ssCounter;
          screenshots.push(...nextSteps.screenshots);
          discoveredUrls.push(...nextSteps.discoveredUrls);

          // 원래 페이지로 복귀
          await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
          await page.waitForTimeout(1000);
        } else {
          // 같은 페이지에서 변화 (밸리데이션 에러, 성공 메시지, 다음 단계 등)
          const hasNewContent = await page.evaluate(() => {
            return !!document.querySelector(
              '.success, .error, .alert, .toast, .notification, ' +
              '[class*="step"], [class*="wizard"], [class*="result"]'
            );
          }).catch(() => false);

          if (hasNewContent && screenshot) {
            ssCounter++;
            const ssName = `${String(ssCounter).padStart(3, '0')}_form_result.png`;
            const ssPath = join(screenshotDir, ssName);
            await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
            screenshots.push(ssPath);
            log(`  📷 폼 결과: ${ssName}`);
          }
        }
      }
    } catch (e: any) {
      log(`  ⚠ 폼 처리 에러: ${e.message}`);
    }
  }

  return { discoveredUrls, screenshots, ssCounter };
}

/** 폼 제출 버튼 클릭 */
async function clickFormSubmit(page: Page, formIndex: number): Promise<boolean> {
  const submitSelectors = [
    `form:nth-of-type(${formIndex + 1}) button[type="submit"]`,
    `form:nth-of-type(${formIndex + 1}) input[type="submit"]`,
    `form:nth-of-type(${formIndex + 1}) button:last-of-type`,
  ];

  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        return true;
      }
    } catch { /* next */ }
  }

  // 폼 내 마지막 버튼 좌표 클릭
  const btnCoords = await page.evaluate((fi) => {
    const form = document.querySelectorAll('form')[fi];
    if (!form) return null;
    const btns = form.querySelectorAll('button, input[type="submit"], [role="button"]');
    const last = btns[btns.length - 1] as HTMLElement;
    if (!last) return null;
    const rect = last.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, formIndex).catch(() => null);

  if (btnCoords) {
    await page.mouse.click(btnCoords.x, btnCoords.y);
    return true;
  }

  return false;
}

/** 멀티 스텝 폼 추적 (최대 5단계) */
async function trackMultiStep(
  page: Page, screenshotDir: string, screenshot: boolean,
  ssCounter: number, waitTime: number, log: (msg: string) => void,
  maxSteps: number = 5,
): Promise<{ discoveredUrls: string[]; screenshots: string[]; ssCounter: number }> {
  const discoveredUrls: string[] = [];
  const screenshots: string[] = [];

  for (let step = 0; step < maxSteps; step++) {
    // 다음 화면에 폼이 있는지 확인
    const hasForm = await page.evaluate(() =>
      document.querySelectorAll('form input, form select, form textarea').length > 0
    ).catch(() => false);

    if (!hasForm) break;

    log(`  멀티스텝 ${step + 2}단계 감지`);

    // 새 폼 자동 채우기 (재귀하지 않고 간단히)
    await page.evaluate(() => {
      document.querySelectorAll('form input:not([type="hidden"]):not([type="submit"])').forEach(el => {
        const input = el as HTMLInputElement;
        if (input.type === 'checkbox' || input.type === 'radio') {
          input.checked = true;
        } else if (input.value === '') {
          input.value = 'test';
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      document.querySelectorAll('form select').forEach(el => {
        const select = el as HTMLSelectElement;
        if (select.options.length > 1) {
          select.selectedIndex = 1;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    }).catch(() => {});

    if (screenshot) {
      ssCounter++;
      const ssName = `${String(ssCounter).padStart(3, '0')}_step${step + 2}_filled.png`;
      const ssPath = join(screenshotDir, ssName);
      await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
      screenshots.push(ssPath);
    }

    // 제출/다음 버튼 클릭
    const beforeUrl = page.url();
    const nextClicked = await page.evaluate(() => {
      const btns = document.querySelectorAll('button[type="submit"], button:last-of-type, [class*="next"], [class*="continue"]');
      const btn = btns[btns.length - 1] as HTMLElement;
      if (btn) { btn.click(); return true; }
      return false;
    }).catch(() => false);

    if (!nextClicked) break;

    await page.waitForTimeout(waitTime);
    const afterUrl = page.url();

    if (screenshot) {
      ssCounter++;
      const ssName = `${String(ssCounter).padStart(3, '0')}_step${step + 2}_result.png`;
      const ssPath = join(screenshotDir, ssName);
      await page.screenshot({ path: ssPath, fullPage: true }).catch(() => {});
      screenshots.push(ssPath);
    }

    if (afterUrl !== beforeUrl) {
      discoveredUrls.push(afterUrl);
      log(`  멀티스텝 → ${afterUrl}`);
    }
  }

  return { discoveredUrls, screenshots, ssCounter };
}

/** 필드 이름/placeholder 기반 더미 데이터 생성 */
function generateDummyData(name: string, placeholder: string): string {
  const key = (name + ' ' + placeholder).toLowerCase();
  if (key.includes('email') || key.includes('이메일')) return 'test@example.com';
  if (key.includes('phone') || key.includes('전화') || key.includes('연락처') || key.includes('tel')) return '010-1234-5678';
  if (key.includes('name') || key.includes('이름') || key.includes('성명')) return '테스트';
  if (key.includes('addr') || key.includes('주소')) return '서울시 강남구 테스트로 123';
  if (key.includes('zip') || key.includes('우편')) return '06123';
  if (key.includes('date') || key.includes('날짜')) return '2025-01-15';
  if (key.includes('amount') || key.includes('금액') || key.includes('price')) return '10000';
  if (key.includes('qty') || key.includes('수량')) return '1';
  if (key.includes('title') || key.includes('제목')) return '테스트 제목';
  if (key.includes('content') || key.includes('내용') || key.includes('desc') || key.includes('memo')) return '테스트 내용입니다.';
  if (key.includes('company') || key.includes('회사')) return '테스트 회사';
  if (key.includes('url') || key.includes('link')) return 'https://example.com';
  if (key.includes('search') || key.includes('검색')) return '테스트';
  return '테스트 데이터';
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
