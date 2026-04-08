// Playwright 내부 비동기 이벤트 방어
process.on('unhandledRejection', () => {});

import { chromium, type Page, type BrowserContext } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { waitForVisualStability } from './wait-stable.js';
import { detectContentArea } from './shell-detector.js';
import { deriveTitle } from './derive-title.js';
import { screenshotWithClickMarker, screenshotViewport, screenshotContent } from './annotate.js';
import { computeContentHash, StateManager, type VisualState, type Transition } from './visual-state.js';

export type { VisualState, Transition } from './visual-state.js';

export interface CrawlOptions {
  url: string; maxDepth?: number; maxPages?: number; screenshot?: boolean;
  outputDir?: string; auth?: AuthOptions; headless?: boolean; waitTime?: number;
  ignorePatterns?: string[]; onProgress?: (msg: string) => void;
}
export interface AuthOptions {
  cookie?: string; bearer?: string; loginUrl?: string;
  credentials?: Record<string, string>; submitSelector?: string;
}
export interface CrawlResult {
  targetUrl: string; states: VisualState[]; transitions: Transition[];
  timestamp: string; pages: any[]; // 하위 호환
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  const {
    url, maxDepth = 5, maxPages = 50, screenshot = true,
    outputDir = '.reverse-engine', headless = true, waitTime = 2000,
    ignorePatterns = ['/logout', '/signout', '/auth/logout'], onProgress,
  } = options;

  await mkdir(outputDir, { recursive: true });
  const ssDir = join(outputDir, 'screenshots');
  if (screenshot) await mkdir(ssDir, { recursive: true });

  const logLines: string[] = [];
  const logPath = join(outputDir, 'crawl.log');
  const log = (msg: string) => { logLines.push(`[${new Date().toISOString().slice(11, 23)}] ${msg}`); onProgress?.(msg); };
  const flushLog = () => writeFile(logPath, logLines.join('\n'), 'utf-8');

  log('⚠️  경고: 이 도구는 개발/테스트 환경 전용입니다. 크롤러가 버튼 클릭, 폼 제출을 자동 수행하므로 실제 데이터가 변경될 수 있습니다.');
  log('🔍 분석 시작: ' + url);

  // 대상 서버 접근 가능 여부 확인
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
  } catch {
    log('✗ 분석 대상이 유효하지 않습니다: ' + url);
    await flushLog();
    throw new Error(`분석 대상이 유효하지 않습니다. 서버가 실행 중인지 확인하세요: ${url}`);
  }

  const browser = await chromium.launch({ headless });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'ko-KR', ignoreHTTPSErrors: true });

  if (options.auth) { log('로그인 처리 중...'); await handleAuth(ctx, url, options.auth, log, outputDir); }

  const sm = new StateManager();
  const baseHost = new URL(url).hostname;
  let ssN = 0;

  // 첫 페이지 → 콘텐츠 영역 감지
  const initPage = await ctx.newPage();
  await initPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await waitForVisualStability(initPage);
  const shell = await detectContentArea(initPage);
  log('콘텐츠 영역: ' + shell.contentSelector);
  await initPage.close();

  // 탐색 큐 (DFS: pop으로 깊이 우선)
  const queue: { url: string; depth: number; parentId?: string }[] = [{ url, depth: 0 }];
  const visited = new Set<string>();
  const clickedItems = new Set<string>(); // 클릭 중복 방지: "url|text|x,y"

  while (queue.length > 0 && sm.stateCount < maxPages) {
    const task = queue.pop()! // DFS: 깊이 우선 탐색;
    const norm = normalizeUrl(task.url);
    if (visited.has(norm) || task.depth > maxDepth) continue;
    if (ignorePatterns.some(p => norm.includes(p))) continue;
    visited.add(norm);

    const page = await ctx.newPage();
    const apis: VisualState['apiCalls'] = [];
    captureNetwork(page, apis);

    try {
      const n = sm.stateCount + 1;
      log(`[${n}] 분석 중: ${task.url}`);
      await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // 도메인 체크
      if (!sameDomain(page.url(), baseHost)) { log(`[${n}] ⚠ 다른 도메인 → skip`); await page.close(); continue; }

      await waitForVisualStability(page);
      await page.waitForTimeout(waitTime);

      const hash = await computeContentHash(page, shell.contentSelector);
      if (sm.hasState(hash)) {
        if (task.parentId) sm.addTransition({ fromStateId: task.parentId, toStateId: sm.getState(hash)!.id, triggerType: 'link', triggerText: task.url, triggerPosition: null, annotatedScreenshotPath: null });
        log(`[${n}] 이미 분석한 화면`); await page.close(); continue;
      }

      const title = await deriveTitle(page, shell.contentSelector);
      log(`[${n}] 화면 파악: "${title}"`);

      const elements = await scanContent(page, shell.contentSelector);
      log(`[${n}] 요소: 링크 ${elements.links.length}, 버튼 ${elements.buttons.length}, 폼 ${elements.forms.length}`);

      // 스크린샷
      let ssPath: string | null = null, csPath: string | null = null;
      if (screenshot) {
        ssN++;
        const name = `${String(ssN).padStart(3, '0')}_${safePath(title)}`;
        ssPath = join(ssDir, name + '_full.png');
        csPath = join(ssDir, name + '_content.png');
        await screenshotViewport(page, ssPath);
        await screenshotContent(page, shell.contentSelector, csPath);
        log(`[${n}] 📷 ${name}`);
      }

      const state = sm.addState(hash, { url: task.url, title, contentHash: hash, screenshotPath: ssPath, contentScreenshotPath: csPath, annotatedScreenshots: [], elements, apiCalls: apis });
      if (task.parentId) sm.addTransition({ fromStateId: task.parentId, toStateId: state.id, triggerType: 'link', triggerText: `→ ${title}`, triggerPosition: null, annotatedScreenshotPath: null });

      // ── 1단계: 네비게이션 메뉴 클릭 탐색 (SPA 메뉴) ──
      const navItems = await scanNavClickables(page, shell.contentSelector);
      if (navItems.length > 0) {
        log(`[${n}] 네비게이션 메뉴 탐색 중... (${navItems.length}개)`);
        for (let i = 0; i < navItems.length; i++) {
          const item = navItems[i];
          const clickKey = `nav|${item.text}|${item.x},${item.y}`;
          if (clickedItems.has(clickKey)) continue;
          clickedItems.add(clickKey);

          try {
            const bUrl = page.url();
            const bHash = await computeContentHash(page, shell.contentSelector).catch(() => '');

            await page.mouse.click(item.x, item.y);
            await page.waitForTimeout(800);
            await waitForVisualStability(page, 2000);

            const aUrl = page.url();
            const aHash = await computeContentHash(page, shell.contentSelector).catch(() => '');
            const urlChanged = aUrl !== bUrl;
            const contentChanged = aHash !== bHash && aHash !== '';
            const isNew = !sm.hasState(aHash);

            if ((urlChanged || contentChanged) && isNew) {
              log(`  [nav ${i + 1}/${navItems.length}] "${item.text}" → 새 화면 발견`);
              queue.push({ url: aUrl, depth: task.depth + 1, parentId: state.id });
            }

            // 복원
            if (urlChanged) {
              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
              await waitForVisualStability(page, 2000);
            } else if (contentChanged) {
              await page.goto(task.url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
              await waitForVisualStability(page, 2000);
            }
          } catch { /* skip */ }
        }
      }

      // ── 2단계: 폼 자동 입력 + 제출 ──
      if (elements.forms.length > 0) {
        log(`[${n}] 폼 입력 중... (${elements.forms.length}개)`);
        for (let fi = 0; fi < elements.forms.length; fi++) {
          const form = elements.forms[fi];
          const formKey = `form|${task.url}|${form.id || fi}`;
          if (clickedItems.has(formKey)) continue;
          clickedItems.add(formKey);

          try {
            const bUrl = page.url();
            const bHash = await computeContentHash(page, shell.contentSelector).catch(() => '');

            // 폼 필드 자동 입력
            const formSel = form.id ? `#${form.id}` : `form:nth-of-type(${fi + 1})`;
            for (const field of form.fields || []) {
              if (!field.name) continue;
              const val = autoFillValue(field.fieldType, field.name);
              try {
                const input = page.locator(`${formSel} [name="${field.name}"]`).first();
                if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
                  if (field.fieldType === 'select') {
                    await input.selectOption({ index: 1 }).catch(() => {});
                  } else if (field.fieldType === 'checkbox' || field.fieldType === 'radio') {
                    await input.check().catch(() => {});
                  } else {
                    await input.fill(val);
                  }
                }
              } catch { /* skip field */ }
            }

            // 제출
            const submitBtn = page.locator(`${formSel} button[type="submit"], ${formSel} input[type="submit"], ${formSel} button:not([type])`).first();
            if (await submitBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
              await submitBtn.click();
            } else {
              // submit 버튼 없으면 form submit 이벤트
              await page.locator(formSel).first().evaluate((el: HTMLFormElement) => el.submit()).catch(() => {});
            }

            await page.waitForTimeout(1000);
            await waitForVisualStability(page, 3000);

            const aUrl = page.url();
            const aHash = await computeContentHash(page, shell.contentSelector).catch(() => '');
            const urlChanged = aUrl !== bUrl;
            const contentChanged = aHash !== bHash && aHash !== '';

            if (urlChanged || contentChanged) {
              const isNew = !sm.hasState(aHash);
              log(`  [폼 ${fi + 1}] "${form.id || '폼'}" 제출 → ${urlChanged ? '이동' : '변화'}${isNew ? ' (새 화면)' : ''}`);
              if (isNew && urlChanged) queue.push({ url: aUrl, depth: task.depth + 1, parentId: state.id });
            }

            // 복원
            if (urlChanged) {
              await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
              await waitForVisualStability(page, 2000);
            }
          } catch { /* skip form */ }
        }
      }

      // ── 3단계: 콘텐츠 영역 버튼 클릭 탐색 (새 화면 발견 시만) ──
      const newButtons = elements.buttons.filter((btn: any) => {
        const key = `btn|${task.url}|${btn.text}|${btn.x},${btn.y}`;
        return !clickedItems.has(key);
      });
      if (newButtons.length > 0) {
        log(`[${n}] 버튼 탐색 중... (${newButtons.length}개)`);
      }
      for (let i = 0; i < newButtons.length; i++) {
        const btn = newButtons[i];
        const clickKey = `btn|${task.url}|${btn.text}|${btn.x},${btn.y}`;
        clickedItems.add(clickKey);

        try {
          const bUrl = page.url();
          const bHash = await computeContentHash(page, shell.contentSelector).catch(() => '');

          let annoPath: string | null = null;
          if (screenshot) {
            ssN++;
            annoPath = join(ssDir, `${String(ssN).padStart(3, '0')}_click_${safePath(btn.text || 'btn' + i)}.png`);
            await screenshotWithClickMarker(page, btn.x, btn.y, btn.text.slice(0, 20), annoPath);
          }

          await page.mouse.click(btn.x, btn.y);
          await page.waitForTimeout(800);
          await waitForVisualStability(page, 2000);

          const aUrl = page.url();
          const aHash = await computeContentHash(page, shell.contentSelector).catch(() => '');
          const hasModal = await page.evaluate(() => !!document.querySelector('[role="dialog"], .modal.show, dialog[open], [aria-modal="true"], [class*="modal"], [class*="drawer"]')).catch(() => false);

          const urlChanged = aUrl !== bUrl;
          const contentChanged = aHash !== bHash && aHash !== '';
          const isNew = !sm.hasState(aHash);

          if (urlChanged || contentChanged || hasModal) {
            const what = hasModal ? '모달' : urlChanged ? '이동' : '변화';
            log(`  [${i + 1}/${newButtons.length}] "${btn.text}" → ${what}${isNew ? ' (새 화면)' : ''}`);

            if (isNew && (contentChanged || urlChanged)) {
              let resultPath: string | null = null;
              if (screenshot) { ssN++; resultPath = join(ssDir, `${String(ssN).padStart(3, '0')}_result_${safePath(btn.text || 'r')}.png`); await screenshotViewport(page, resultPath); }

              const newTitle = await deriveTitle(page, shell.contentSelector);
              const newEls = await scanContent(page, shell.contentSelector).catch(() => ({ links: [] as any[], buttons: [] as any[], forms: [] as any[] }));
              const ns = sm.addState(aHash, { url: aUrl, title: newTitle, contentHash: aHash, screenshotPath: resultPath, contentScreenshotPath: null, annotatedScreenshots: annoPath ? [annoPath] : [], elements: newEls, apiCalls: [] });
              sm.addTransition({ fromStateId: state.id, toStateId: ns.id, triggerType: 'click', triggerText: btn.text || btn.selector, triggerPosition: { x: btn.x, y: btn.y }, annotatedScreenshotPath: annoPath });
              if (urlChanged) queue.push({ url: aUrl, depth: task.depth + 1, parentId: ns.id });
              log(`  → "${newTitle}" (${ns.id})`);
            }

            // 복원
            if (hasModal) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
            if (urlChanged) { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); await waitForVisualStability(page, 2000); }
          }
        } catch { /* skip */ }
      }

      // ── 4단계: 전체 페이지 링크 수집 (a[href]) ──
      const allLinks = await scanAllLinks(page);
      for (const link of allLinks) {
        try { const u = new URL(link.href, task.url); if (u.hostname === baseHost && !visited.has(normalizeUrl(u.href))) queue.push({ url: u.href, depth: task.depth + 1, parentId: state.id }); } catch {}
      }

      log(`[${n}] ✓ "${title}" 완료 (대기 ${queue.length}건)`);
    } catch (e: any) { log('  ✗ ' + (e.message || '').slice(0, 100)); } finally { await page.close(); await flushLog(); }
  }

  log(`🏁 분석 완료! ${sm.stateCount}개 화면, ${sm.getAllTransitions().length}개 전환`);
  await flushLog(); await browser.close();

  const states = sm.getAllStates();
  const transitions = sm.getAllTransitions();

  // 하위 호환
  const pages = states.map(s => ({
    url: s.url, title: s.title, screenshotPath: s.screenshotPath,
    elements: { links: s.elements.links, buttons: s.elements.buttons.map(b => ({ text: b.text, selector: b.selector, navigatesTo: null })), forms: s.elements.forms },
    apiCalls: s.apiCalls, navigatesTo: s.elements.links.map(l => l.href), authRequired: false,
    flows: transitions.filter(t => t.fromStateId === s.id).map(t => ({
      from: s.url, trigger: `[${t.triggerType}] ${t.triggerText}`, to: states.find(st => st.id === t.toStateId)?.url || '?',
    })),
  }));

  return { targetUrl: url, states, transitions, timestamp: new Date().toISOString(), pages };
}

// ─── 네비게이션 영역 클릭 가능 요소 수집 (SPA 메뉴 대응) ───
async function scanNavClickables(page: Page, contentSelector: string): Promise<{ text: string; x: number; y: number }[]> {
  return page.evaluate((contentSel) => {
    const contentEl = document.querySelector(contentSel);
    const items: { text: string; x: number; y: number }[] = [];
    const seen = new Set<string>();

    // nav, aside, header, sidebar 영역 + role="navigation" 내부 요소
    const navAreas = document.querySelectorAll(
      'nav, aside, header, [role="navigation"], [class*="sidebar"], [class*="menu"], [class*="nav"]'
    );

    for (const area of Array.from(navAreas)) {
      // 콘텐츠 영역 내부이면 스킵
      if (contentEl && contentEl.contains(area)) continue;

      // 클릭 가능한 요소 수집: a, li, div, span 중 cursor:pointer이거나 role 있는 것
      const candidates = area.querySelectorAll(
        'a, li, [role="link"], [role="menuitem"], [role="tab"], [role="button"]'
      );
      for (const el of Array.from(candidates)) {
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;
        if (rect.top < 0 || rect.top >= window.innerHeight) continue;

        const text = htmlEl.textContent?.trim().slice(0, 60) || '';
        if (!text || seen.has(text)) continue;
        seen.add(text);

        items.push({
          text,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        });
      }

      // cursor:pointer인 div, span, li도 수집 (React/Vue SPA 메뉴)
      const allEls = area.querySelectorAll('div, span, li, label');
      for (const el of Array.from(allEls)) {
        const htmlEl = el as HTMLElement;
        if (window.getComputedStyle(htmlEl).cursor !== 'pointer') continue;
        // 이미 위에서 잡은 요소의 자식이면 스킵
        if (htmlEl.querySelector('a, [role="link"], [role="menuitem"]')) continue;

        const rect = htmlEl.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) continue;
        if (rect.top < 0 || rect.top >= window.innerHeight) continue;

        const text = htmlEl.textContent?.trim().slice(0, 60) || '';
        if (!text || seen.has(text)) continue;
        seen.add(text);

        items.push({
          text,
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        });
      }
    }

    return items;
  }, contentSelector);
}

// ─── 전체 페이지 링크 수집 (네비게이션/메뉴 포함) ───
async function scanAllLinks(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('a[href]'))
      .map(a => ({
        text: (a as HTMLAnchorElement).textContent?.trim().slice(0, 80) || '',
        href: (a as HTMLAnchorElement).href,
      }))
      .filter(l => l.href && !l.href.startsWith('javascript:') && !l.href.startsWith('#'));
  });
}

// ─── 콘텐츠 영역 요소 스캔 ───
async function scanContent(page: Page, contentSelector: string) {
  return page.evaluate((sel) => {
    const c = document.querySelector(sel) || document.body;
    const links = Array.from(c.querySelectorAll('a[href]')).map(a => ({
      text: (a as HTMLAnchorElement).textContent?.trim().slice(0, 80) || '',
      href: (a as HTMLAnchorElement).href,
      selector: bSel(a),
    }));
    const seen = new Set<Element>();
    c.querySelectorAll('button, [role="button"], input[type="submit"], [onclick]').forEach(e => seen.add(e));
    c.querySelectorAll('div, span, li, td, img, svg, label, i').forEach(e => { if (!seen.has(e) && window.getComputedStyle(e).cursor === 'pointer') seen.add(e); });
    // 반복 요소 그룹핑
    const grouped = new Map<string, Element[]>();
    seen.forEach(el => { const r = (el as HTMLElement).getBoundingClientRect(); if (r.width < 10 || r.height < 10 || r.top >= window.innerHeight) return; const k = `${el.tagName}_${Math.round(r.width / 10)}_${Math.round(r.height / 10)}`; if (!grouped.has(k)) grouped.set(k, []); grouped.get(k)!.push(el); });
    const buttons: { text: string; selector: string; x: number; y: number }[] = [];
    grouped.forEach(g => { (g.length >= 3 ? g.slice(0, 2) : g).forEach(el => { const r = (el as HTMLElement).getBoundingClientRect(); buttons.push({ text: (el as HTMLElement).textContent?.trim().slice(0, 80) || '', selector: bSel(el), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); }); });
    const forms = Array.from(c.querySelectorAll('form')).map(f => ({ id: (f as HTMLFormElement).id || null, action: (f as HTMLFormElement).action || null, method: (f as HTMLFormElement).method?.toUpperCase() || 'GET', fields: Array.from(f.querySelectorAll('input, select, textarea')).map(i => ({ name: (i as HTMLInputElement).name || (i as HTMLInputElement).id || '', fieldType: (i as HTMLInputElement).type || i.tagName.toLowerCase(), required: (i as HTMLInputElement).required })) }));
    function bSel(el: Element): string { if (el.id) return '#' + el.id; const t = el.getAttribute('data-testid'); if (t) return `[data-testid="${t}"]`; const tag = el.tagName.toLowerCase(); const cls = Array.from(el.classList).slice(0, 2).join('.'); return cls ? `${tag}.${cls}` : tag; }
    return { links, buttons, forms };
  }, contentSelector);
}

// ─── 네트워크 ───
function captureNetwork(page: Page, apis: VisualState['apiCalls']) {
  let stopped = false;
  page.on('response', r => {
    if (stopped) return;
    try {
      const q = r.request(); const t = q.resourceType();
      if ((t === 'xhr' || t === 'fetch') && !/\.(js|css|png|jpg|svg|woff|ico|map)(\?|$)/i.test(q.url())) {
        apis.push({ method: q.method(), url: q.url(), responseStatus: r.status(), triggeredBy: null });
      }
    } catch { /* 페이지 닫힌 후 도착한 응답 무시 */ }
  });
  page.on('close', () => { stopped = true; });
}

// ─── 인증 ───
async function handleAuth(ctx: BrowserContext, baseUrl: string, auth: AuthOptions, log: (m: string) => void, outputDir: string) {
  const host = new URL(baseUrl).hostname;
  const ssDir = join(outputDir, 'screenshots'); await mkdir(ssDir, { recursive: true });

  if (auth.cookie) { const cookies = auth.cookie.split(';').map(c => { const [n, ...r] = c.trim().split('='); return { name: n, value: r.join('='), domain: host, path: '/' }; }); await ctx.addCookies(cookies); log('쿠키 인증 완료'); return; }
  if (auth.bearer) { await ctx.setExtraHTTPHeaders({ Authorization: 'Bearer ' + auth.bearer }); log('Bearer 토큰 완료'); return; }

  if (auth.credentials) {
    const p = await ctx.newPage();
    await p.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForVisualStability(p);
    let cur = p.url(); log('현재: ' + cur);

    if (auth.loginUrl) {
      const lt = auth.loginUrl.startsWith('http') ? auth.loginUrl : new URL(auth.loginUrl, baseUrl).href;
      if (!cur.includes(lt.replace(/https?:\/\/[^/]+/, ''))) { await p.goto(lt, { waitUntil: 'domcontentloaded', timeout: 30000 }); await waitForVisualStability(p); cur = p.url(); }
    }

    await p.screenshot({ path: join(ssDir, '000_login_page.png'), fullPage: true }).catch(() => {});
    await p.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => log('⚠ PW 필드 대기 타임아웃'));

    const { email, password, username, id, pw } = auth.credentials;
    const idVal = email || username || id || Object.values(auth.credentials)[0];
    const pwVal = password || pw || Object.values(auth.credentials)[1];

    if (idVal) { const ok = await tryFill(p, ['#username', '#email', 'input[name="username"]', 'input[name="email"]', 'input[type="text"]'], idVal); log(ok ? '✓ ID: ' + idVal : '⚠ ID 못 찾음'); }
    if (pwVal) { const ok = await tryFill(p, ['#password', 'input[name="password"]', 'input[type="password"]'], pwVal); log(ok ? '✓ PW 입력' : '⚠ PW 못 찾음'); }

    const loginUrl = p.url();
    for (const s of (auth.submitSelector ? [auth.submitSelector] : ['#kc-login', 'button[type="submit"]', 'input[type="submit"]'])) {
      try { const b = p.locator(s).first(); if (await b.isVisible({ timeout: 2000 })) { await b.click(); log('제출: ' + s); break; } } catch {} }

    await p.waitForURL(u => u.toString() !== loginUrl, { timeout: 30000 }).catch(() => log('⚠ URL 변화 없음'));
    await waitForVisualStability(p).catch(() => {});
    await p.waitForTimeout(3000).catch(() => {});

    try {
      const currentHost = new URL(p.url()).hostname;
      const baseHost = new URL(baseUrl).hostname;
      if (currentHost !== baseHost) {
        await p.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForVisualStability(p).catch(() => {});
      }
    } catch { /* URL 파싱 실패 (about:blank 등) — 무시 */ }

    await p.screenshot({ path: join(ssDir, '000_after_login.png'), fullPage: true }).catch(() => {});
    log('✓ 로그인 완료 → ' + p.url());
    await p.close().catch(() => {});
  }
}

async function tryFill(p: Page, sels: string[], val: string): Promise<boolean> {
  for (const s of sels) { try { const e = p.locator(s).first(); if (await e.isVisible({ timeout: 1000 })) { await e.fill(val); return true; } } catch {} } return false;
}

// ─── 폼 자동 입력값 생성 ───
function autoFillValue(fieldType: string, fieldName: string): string {
  const name = fieldName.toLowerCase();
  // 이름 기반 추론 (우선)
  if (name.includes('email') || name.includes('mail')) return 'test@example.com';
  if (name.includes('password') || name.includes('pw') || name.includes('passwd')) return 'TestPass123!';
  if (name.includes('phone') || name.includes('tel') || name.includes('mobile')) return '010-1234-5678';
  if (name.includes('name') || name.includes('이름')) return '테스트 사용자';
  if (name.includes('title') || name.includes('제목')) return '테스트 항목';
  if (name.includes('content') || name.includes('내용') || name.includes('desc') || name.includes('설명')) return '자동 생성된 테스트 데이터입니다.';
  if (name.includes('address') || name.includes('주소')) return '서울시 강남구 테스트로 123';
  if (name.includes('search') || name.includes('query') || name.includes('keyword') || name.includes('검색')) return 'test';
  if (name.includes('url') || name.includes('link') || name.includes('홈페이지')) return 'https://example.com';
  if (name.includes('amount') || name.includes('price') || name.includes('금액')) return '10000';
  if (name.includes('count') || name.includes('qty') || name.includes('수량')) return '1';
  // 타입 기반
  switch (fieldType) {
    case 'email': return 'test@example.com';
    case 'password': return 'TestPass123!';
    case 'tel': return '010-1234-5678';
    case 'number': return '42';
    case 'url': return 'https://example.com';
    case 'date': return '2026-01-15';
    case 'datetime-local': return '2026-01-15T10:00';
    case 'time': return '10:00';
    case 'color': return '#3498db';
    case 'range': return '50';
    case 'textarea': return '자동 생성된 테스트 데이터입니다.\n여러 줄 입력 테스트.';
    default: return '테스트 입력';
  }
}

// ─── 유틸 ───
function normalizeUrl(u: string): string { try { const o = new URL(u); o.hash = ''; o.search = ''; let p = o.pathname; if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1); o.pathname = p; return o.href; } catch { return u; } }
function safePath(s: string): string { return s.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40); }
function sameDomain(url: string, baseHost: string): boolean { try { const h = new URL(url).hostname; return h === baseHost || h === 'localhost' || h.split('.').slice(-2).join('.') === baseHost.split('.').slice(-2).join('.'); } catch { return false; } }
function isStaticResource(u: string): boolean { return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)(\?|$)/i.test(u); }
