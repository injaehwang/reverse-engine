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

  // 탐색 큐
  const queue: { url: string; depth: number; parentId?: string }[] = [{ url, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && sm.stateCount < maxPages) {
    const task = queue.shift()!;
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

      // 클릭 탐색
      log(`[${n}] 동작 확인 중... (${elements.buttons.length}개)`);
      for (let i = 0; i < elements.buttons.length; i++) {
        const btn = elements.buttons[i];
        try {
          const bUrl = page.url();
          const bHash = await computeContentHash(page, shell.contentSelector).catch(() => '');

          // 클릭 위치 표시 스크린샷
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
            log(`  [${i + 1}/${elements.buttons.length}] "${btn.text}" → ${what}${isNew ? ' (새 화면)' : ''}`);

            let resultPath: string | null = null;
            if (screenshot) { ssN++; resultPath = join(ssDir, `${String(ssN).padStart(3, '0')}_result_${safePath(btn.text || 'r')}.png`); await screenshotViewport(page, resultPath); }

            if (isNew && (contentChanged || urlChanged)) {
              const newTitle = await deriveTitle(page, shell.contentSelector);
              const newEls = await scanContent(page, shell.contentSelector).catch(() => ({ links: [] as any[], buttons: [] as any[], forms: [] as any[] }));
              const ns = sm.addState(aHash, { url: aUrl, title: newTitle, contentHash: aHash, screenshotPath: resultPath, contentScreenshotPath: null, annotatedScreenshots: annoPath ? [annoPath] : [], elements: newEls, apiCalls: [] });
              sm.addTransition({ fromStateId: state.id, toStateId: ns.id, triggerType: 'click', triggerText: btn.text || btn.selector, triggerPosition: { x: btn.x, y: btn.y }, annotatedScreenshotPath: annoPath });
              if (urlChanged) queue.push({ url: aUrl, depth: task.depth + 1, parentId: ns.id });
              log(`  → "${newTitle}" (${ns.id})`);
            } else if (sm.hasState(aHash)) {
              sm.addTransition({ fromStateId: state.id, toStateId: sm.getState(aHash)!.id, triggerType: 'click', triggerText: btn.text || btn.selector, triggerPosition: { x: btn.x, y: btn.y }, annotatedScreenshotPath: annoPath });
            }

            // 복원
            if (hasModal) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
            if (urlChanged) { await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {}); await waitForVisualStability(page, 2000); }
          }
        } catch { /* skip */ }
      }

      // 링크 큐잉
      for (const link of elements.links) {
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
    await waitForVisualStability(p); await p.waitForTimeout(3000);

    if (new URL(p.url()).hostname !== new URL(baseUrl).hostname) { await p.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); await waitForVisualStability(p); }
    await p.screenshot({ path: join(ssDir, '000_after_login.png'), fullPage: true }).catch(() => {});
    log('✓ 로그인 완료 → ' + p.url());
    await p.close();
  }
}

async function tryFill(p: Page, sels: string[], val: string): Promise<boolean> {
  for (const s of sels) { try { const e = p.locator(s).first(); if (await e.isVisible({ timeout: 1000 })) { await e.fill(val); return true; } } catch {} } return false;
}

// ─── 유틸 ───
function normalizeUrl(u: string): string { try { const o = new URL(u); o.hash = ''; o.search = ''; let p = o.pathname; if (p.endsWith('/') && p.length > 1) p = p.slice(0, -1); o.pathname = p; return o.href; } catch { return u; } }
function safePath(s: string): string { return s.replace(/[^a-zA-Z0-9가-힣_-]/g, '_').slice(0, 40); }
function sameDomain(url: string, baseHost: string): boolean { try { const h = new URL(url).hostname; return h === baseHost || h === 'localhost' || h.split('.').slice(-2).join('.') === baseHost.split('.').slice(-2).join('.'); } catch { return false; } }
function isStaticResource(u: string): boolean { return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|ico|map)(\?|$)/i.test(u); }
