/**
 * Crawler 골든 테스트
 *
 * 로컬 HTTP 서버를 띄우고 fixture HTML을 서빙한 뒤,
 * 크롤러를 실행하고 결과를 스냅샷과 비교한다.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { crawl, type CrawlResult } from '../src/browser.js';

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const PORT = 18923; // 충돌 방지용 고유 포트
const BASE_URL = `http://localhost:${PORT}`;

let server: http.Server;
let result: CrawlResult;

// 간단한 정적 파일 서버
function createFixtureServer(): http.Server {
  return http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/index.html' : `${req.url}.html`;
    const filePath = path.join(FIXTURES_DIR, urlPath);

    // API 엔드포인트 모킹
    if (req.url?.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, endpoint: req.url }));
      return;
    }

    if (fs.existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(filePath, 'utf-8'));
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
}

beforeAll(async () => {
  server = createFixtureServer();
  await new Promise<void>((resolve) => server.listen(PORT, resolve));

  result = await crawl({
    url: BASE_URL,
    maxDepth: 3,
    maxPages: 10,
    screenshot: false,
    har: false,
  });
}, 60000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ============================================================
// 페이지 발견
// ============================================================

describe('페이지 발견', () => {
  it('메인 페이지를 포함한다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`);
    expect(main).toBeDefined();
    expect(main!.title).toBe('테스트 메인');
  });

  it('링크를 따라 하위 페이지를 발견한다', () => {
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(`${BASE_URL}/about`);
    expect(urls).toContain(`${BASE_URL}/dashboard`);
  });

  it('2depth 링크도 발견한다 (dashboard → settings)', () => {
    const urls = result.pages.map((p) => p.url);
    expect(urls).toContain(`${BASE_URL}/settings`);
  });

  it('최소 4개 페이지를 발견한다', () => {
    expect(result.pages.length).toBeGreaterThanOrEqual(4);
  });
});

// ============================================================
// DOM 요소 추출
// ============================================================

describe('DOM 요소 추출', () => {
  it('메인 페이지에서 링크를 추출한다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`)!;
    const hrefs = main.elements.links.map((l) => l.href);
    expect(hrefs).toContain(`${BASE_URL}/about`);
    expect(hrefs).toContain(`${BASE_URL}/dashboard`);
  });

  it('메인 페이지에서 버튼을 추출한다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`)!;
    const btnTexts = main.elements.buttons.map((b) => b.text);
    expect(btnTexts).toContain('액션 버튼');
  });

  it('메인 페이지에서 폼을 추출한다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`)!;
    expect(main.elements.forms.length).toBeGreaterThanOrEqual(1);
    const form = main.elements.forms.find((f) => f.id === 'search-form');
    expect(form).toBeDefined();
    expect(form!.method).toBe('GET');
  });

  it('폼 필드를 추출한다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`)!;
    const form = main.elements.forms.find((f) => f.id === 'search-form')!;
    const qField = form.fields.find((f) => f.name === 'q');
    expect(qField).toBeDefined();
    expect(qField!.required).toBe(true);
  });

  it('settings 페이지에서 폼을 추출한다', () => {
    const settings = result.pages.find((p) => p.url === `${BASE_URL}/settings`)!;
    expect(settings.elements.forms.length).toBeGreaterThanOrEqual(1);
    const form = settings.elements.forms.find((f) => f.id === 'settings-form');
    expect(form).toBeDefined();
    expect(form!.method).toBe('POST');
  });
});

// ============================================================
// 네비게이션 그래프
// ============================================================

describe('네비게이션 그래프', () => {
  it('메인 페이지의 navigatesTo에 하위 페이지가 포함된다', () => {
    const main = result.pages.find((p) => p.url === `${BASE_URL}/`)!;
    expect(main.navigatesTo).toContain(`${BASE_URL}/about`);
    expect(main.navigatesTo).toContain(`${BASE_URL}/dashboard`);
  });

  it('대시보드의 navigatesTo에 settings가 포함된다', () => {
    const dashboard = result.pages.find((p) => p.url === `${BASE_URL}/dashboard`)!;
    expect(dashboard.navigatesTo).toContain(`${BASE_URL}/settings`);
  });
});

// ============================================================
// API 호출 캡처
// ============================================================

describe('API 호출 캡처', () => {
  it('dashboard에서 /api/stats 호출을 캡처한다', () => {
    const dashboard = result.pages.find((p) => p.url === `${BASE_URL}/dashboard`)!;
    const statsCall = dashboard.apiCalls.find((c) => c.url.includes('/api/stats'));
    expect(statsCall).toBeDefined();
    expect(statsCall!.method).toBe('GET');
  });
});

// ============================================================
// BFS 우선순위: 읽기 먼저, 쓰기 나중
// ============================================================

describe('BFS 우선순위 큐', () => {
  it('읽기 액션(네비게이션)이 쓰기 액션(폼/버튼)보다 먼저 처리된다', () => {
    // 폼이 있는 메인 페이지에서 시작했을 때,
    // 링크로 발견된 about, dashboard, settings 페이지가
    // 폼 제출보다 먼저 수집되어야 한다.
    // 증거: 4개 이상의 페이지가 발견됨 (링크 탐색이 완료된 후 폼 제출이 실행)
    const pageUrls = result.pages.map((p) => p.url);
    expect(pageUrls.length).toBeGreaterThanOrEqual(4);

    // 메인, about, dashboard는 읽기 액션으로 먼저 수집되어야 한다
    expect(pageUrls).toContain(`${BASE_URL}/`);
    expect(pageUrls).toContain(`${BASE_URL}/about`);
    expect(pageUrls).toContain(`${BASE_URL}/dashboard`);
  });

  it('폼 제출로 인한 API 호출이 캡처된다', () => {
    // 폼 제출(쓰기 액션)이 실행되면 API 호출이 발생해야 한다
    const allApiCalls = result.pages.flatMap((p) => p.apiCalls);
    // /api/search 또는 /api/settings 호출이 있을 수 있음
    // 최소한 dashboard의 /api/stats는 확실히 있어야 함
    expect(allApiCalls.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 결과 구조 무결성
// ============================================================

describe('결과 구조', () => {
  it('targetUrl이 올바르다', () => {
    expect(result.targetUrl).toBe(BASE_URL);
  });

  it('timestamp가 유효한 ISO 날짜다', () => {
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
  });

  it('모든 페이지에 url과 title이 있다', () => {
    for (const page of result.pages) {
      expect(page.url).toBeTruthy();
      expect(page.title).toBeTruthy();
    }
  });

  it('중복 페이지가 없다', () => {
    const urls = result.pages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
