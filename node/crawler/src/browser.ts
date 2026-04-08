/**
 * Playwright 브라우저 관리 및 BFS 크롤링 엔진
 *
 * 우선순위 큐: 읽기 액션(GET, 네비게이션) → 쓰기 액션(POST, DELETE, 폼 제출)
 */

import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { PageScanner, type PageInfo } from './page-scanner.js';
import { NetworkInterceptor } from './network-interceptor.js';
import { StateDetector } from './state-detector.js';
import { AuthHandler, type AuthConfig } from './auth-handler.js';

export interface CrawlOptions {
  url: string;
  maxDepth: number;
  maxPages: number;
  screenshot: boolean;
  har: boolean;
  authCookie?: string;
  auth?: AuthConfig;
}

export interface CrawlResult {
  targetUrl: string;
  pages: PageInfo[];
  timestamp: string;
}

/** 큐 아이템: 탐색 대상 */
interface QueueItem {
  url: string;
  depth: number;
  /** 읽기(GET, 네비게이션) vs 쓰기(POST, DELETE, 폼 제출, 버튼 클릭) */
  actionType: 'read' | 'write';
  /** 쓰기 액션의 경우: 실행할 동작 정보 */
  action?: {
    type: 'form-submit' | 'button-click';
    /** 폼/버튼의 CSS selector */
    selector: string;
    /** 폼 method (POST, DELETE 등) */
    method?: string;
    /** 폼 필드 자동 입력값 */
    formData?: Record<string, string>;
    /** 출발 페이지 URL */
    sourceUrl: string;
  };
}

/** 우선순위 큐: 읽기 먼저 소진, 쓰기는 나중에 */
class PriorityQueue {
  private readQueue: QueueItem[] = [];
  private writeQueue: QueueItem[] = [];

  push(item: QueueItem): void {
    if (item.actionType === 'read') {
      this.readQueue.push(item);
    } else {
      this.writeQueue.push(item);
    }
  }

  shift(): QueueItem | undefined {
    // 읽기 큐를 먼저 소진
    return this.readQueue.shift() ?? this.writeQueue.shift();
  }

  get length(): number {
    return this.readQueue.length + this.writeQueue.length;
  }

  get readCount(): number {
    return this.readQueue.length;
  }

  get writeCount(): number {
    return this.writeQueue.length;
  }
}

/** 폼 필드에 자동 입력할 기본값 생성 */
function generateFormValue(fieldType: string, fieldName: string): string {
  switch (fieldType) {
    case 'email':
      return 'test@example.com';
    case 'password':
      return 'TestPass123!';
    case 'tel':
      return '010-1234-5678';
    case 'number':
      return '42';
    case 'url':
      return 'https://example.com';
    case 'date':
      return '2026-01-01';
    case 'datetime-local':
      return '2026-01-01T12:00';
    default:
      // 이름 기반 추론
      if (fieldName.includes('name')) return '테스트 사용자';
      if (fieldName.includes('search') || fieldName.includes('query')) return 'test';
      return 'test-input';
  }
}

export async function crawl(options: CrawlOptions): Promise<CrawlResult> {
  console.error(
    '\n⚠️  경고: 이 도구는 반드시 개발/테스트 환경에서만 사용하세요.\n' +
    '   크롤러가 버튼 클릭, 폼 제출 등을 자동으로 수행하므로\n' +
    '   실제 데이터의 삭제, 추가, 수정이 발생할 수 있습니다.\n' +
    '   운영 환경에서 실행하지 마세요.\n',
  );

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'ko-KR',
  });

  // 인증 처리
  if (options.auth) {
    // 구조화된 인증 설정 (OAuth2, form, bearer 등)
    const authHandler = new AuthHandler(context, options.auth);
    await authHandler.authenticate();
  } else if (options.authCookie) {
    // 간단한 쿠키 인증 (레거시)
    const eqIdx = options.authCookie.indexOf('=');
    const name = options.authCookie.slice(0, eqIdx);
    const value = options.authCookie.slice(eqIdx + 1);
    const url = new URL(options.url);
    await context.addCookies([{
      name,
      value,
      domain: url.hostname,
      path: '/',
    }]);
  }

  // 스크린샷 디렉토리 생성
  if (options.screenshot) {
    await mkdir('output/screenshots', { recursive: true });
  }

  const result: CrawlResult = {
    targetUrl: options.url,
    pages: [],
    timestamp: new Date().toISOString(),
  };

  // 우선순위 BFS 탐색
  const visited = new Set<string>();
  const visitedActions = new Set<string>(); // 중복 액션 방지
  const stateDetector = new StateDetector();
  const queue = new PriorityQueue();

  queue.push({ url: options.url, depth: 0, actionType: 'read' });

  while (queue.length > 0 && result.pages.length < options.maxPages) {
    const current = queue.shift()!;

    // 읽기 액션: URL 중복 체크
    if (current.actionType === 'read') {
      if (visited.has(current.url) || current.depth > options.maxDepth) {
        continue;
      }
      visited.add(current.url);
    }

    // 쓰기 액션: 액션 중복 체크
    if (current.action) {
      const actionKey = `${current.action.type}:${current.action.selector}@${current.action.sourceUrl}`;
      if (visitedActions.has(actionKey)) continue;
      visitedActions.add(actionKey);
    }

    try {
      const page = await context.newPage();
      const interceptor = new NetworkInterceptor(page);
      await interceptor.start();

      if (current.action) {
        // 쓰기 액션: 출발 페이지로 이동 → 액션 실행
        await page.goto(current.action.sourceUrl, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });

        await executeAction(page, current.action);
        // 액션 후 페이지 안정화 대기
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      } else {
        // 읽기 액션: 직접 이동
        await page.goto(current.url, {
          waitUntil: 'networkidle',
          timeout: 30000,
        });
      }

      // SPA 상태 중복 감지
      if (!await stateDetector.isNewState(page)) {
        await page.close();
        continue;
      }

      // 페이지 스캔
      const scanner = new PageScanner(page);
      const currentUrl = page.url();
      const pageInfo = await scanner.scan(currentUrl);

      // API 호출 수집
      pageInfo.apiCalls = interceptor.getCapturedCalls();

      // 스크린샷
      if (options.screenshot) {
        const screenshotPath = `output/screenshots/${encodeURIComponent(currentUrl)}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        pageInfo.screenshotPath = screenshotPath;
      }

      // 유효하지 않은 페이지 필터링 (about:blank, 빈 title 등)
      const isValidPage = pageInfo.url && !pageInfo.url.startsWith('about:') && pageInfo.title;

      // 이미 같은 URL의 페이지가 수집되었으면 스킵 (액션 후 같은 페이지에 머무는 경우)
      if (isValidPage && !result.pages.some((p) => p.url === pageInfo.url)) {
        result.pages.push(pageInfo);
      } else if (current.action) {
        // 액션 실행 후 같은 페이지에 머문 경우: API 호출만 기존 페이지에 병합
        const existing = result.pages.find((p) => p.url === pageInfo.url);
        if (existing) {
          for (const call of pageInfo.apiCalls) {
            if (!existing.apiCalls.some((c) => c.method === call.method && c.url === call.url)) {
              existing.apiCalls.push(call);
            }
          }
        }
      }

      // 새 링크를 읽기 큐에 추가
      const baseUrl = new URL(options.url);
      for (const link of pageInfo.elements.links) {
        try {
          const linkUrl = new URL(link.href, currentUrl);
          if (linkUrl.hostname === baseUrl.hostname && !visited.has(linkUrl.href)) {
            queue.push({
              url: linkUrl.href,
              depth: current.depth + 1,
              actionType: 'read',
            });
          }
        } catch {
          // 잘못된 URL은 무시
        }
      }

      // 폼 제출을 쓰기 큐에 추가
      for (const form of pageInfo.elements.forms) {
        if (form.id || form.action) {
          const formData: Record<string, string> = {};
          for (const field of form.fields) {
            if (field.name) {
              formData[field.name] = generateFormValue(field.fieldType, field.name);
            }
          }

          const selector = form.id ? `#${form.id}` : `form[action="${form.action}"]`;
          queue.push({
            url: currentUrl,
            depth: current.depth + 1,
            actionType: 'write',
            action: {
              type: 'form-submit',
              selector,
              method: form.method,
              formData,
              sourceUrl: currentUrl,
            },
          });
        }
      }

      // 버튼 클릭을 쓰기 큐에 추가 (submit 버튼 제외 — 폼에서 처리)
      for (const button of pageInfo.elements.buttons) {
        if (button.selector && button.text) {
          queue.push({
            url: currentUrl,
            depth: current.depth + 1,
            actionType: 'write',
            action: {
              type: 'button-click',
              selector: button.selector,
              sourceUrl: currentUrl,
            },
          });
        }
      }

      interceptor.stop();
      await page.close();
    } catch (error) {
      console.error(`크롤링 실패: ${current.url} - ${error}`);
    }
  }

  await browser.close();
  return result;
}

/** 쓰기 액션 실행 */
async function executeAction(
  page: Page,
  action: NonNullable<QueueItem['action']>,
): Promise<void> {
  try {
    if (action.type === 'form-submit') {
      // 폼 필드 자동 입력
      if (action.formData) {
        for (const [name, value] of Object.entries(action.formData)) {
          const input = page.locator(`[name="${name}"]`).first();
          if (await input.isVisible({ timeout: 2000 }).catch(() => false)) {
            await input.fill(value);
          }
        }
      }

      // 폼 제출
      const form = page.locator(action.selector).first();
      const submitBtn = form.locator('button[type="submit"], input[type="submit"]').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
      } else {
        // submit 버튼이 없으면 폼 자체에 submit 이벤트
        await form.evaluate((el: HTMLFormElement) => el.submit());
      }
    } else if (action.type === 'button-click') {
      const btn = page.locator(action.selector).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
      }
    }
  } catch (error) {
    console.error(`액션 실행 실패: ${action.type} ${action.selector} - ${error}`);
  }
}
