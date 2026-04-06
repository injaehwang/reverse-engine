/**
 * 네비게이션 셸 감지
 * 콘텐츠 영역과 공통 네비게이션(GNB, 사이드바)을 분리한다
 */
import type { Page } from 'playwright';

export interface ShellInfo {
  contentSelector: string;
  contentBounds: { x: number; y: number; width: number; height: number } | null;
}

/** 콘텐츠 영역 자동 감지 */
export async function detectContentArea(page: Page): Promise<ShellInfo> {
  return page.evaluate(() => {
    // 1. 시맨틱 태그 우선
    const semantic = document.querySelector('main, [role="main"]');
    if (semantic) {
      const rect = semantic.getBoundingClientRect();
      if (rect.width > 200 && rect.height > 200) {
        return {
          contentSelector: semantic.id ? `#${semantic.id}` : (semantic.tagName === 'MAIN' ? 'main' : '[role="main"]'),
          contentBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        };
      }
    }

    // 2. 클래스 기반 탐색
    const candidates = document.querySelectorAll(
      '.content, .main-content, .page-content, #content, #main, ' +
      '.container-fluid > .row > [class*="col"]:last-child, ' +
      '[class*="content"][class*="main"], [class*="page"][class*="wrapper"]'
    );
    for (const el of Array.from(candidates)) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 300 && rect.height > 300) {
        let sel = '';
        if (el.id) sel = `#${el.id}`;
        else {
          const cls = Array.from(el.classList).find(c =>
            c.includes('content') || c.includes('main') || c.includes('page')
          );
          sel = cls ? `.${cls}` : '';
        }
        if (sel) return { contentSelector: sel, contentBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      }
    }

    // 3. 최대 면적 요소 (셸 제외)
    const shellTags = new Set(['NAV', 'HEADER', 'FOOTER', 'ASIDE']);
    const allDivs = document.querySelectorAll('div, section, article');
    let best: Element | null = null;
    let bestArea = 0;

    for (const el of Array.from(allDivs)) {
      if (shellTags.has(el.tagName)) continue;
      if (el.closest('nav, header, footer, aside, [role="navigation"]')) continue;
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      // 전체 화면보다 작고, 적당히 큰 영역
      if (area > bestArea && rect.width < window.innerWidth * 0.95 && rect.width > 200) {
        best = el;
        bestArea = area;
      }
    }

    if (best) {
      const rect = best.getBoundingClientRect();
      let sel = '';
      if (best.id) sel = `#${best.id}`;
      else {
        const cls = Array.from(best.classList).slice(0, 2).join('.');
        sel = cls ? `.${cls}` : `${best.tagName.toLowerCase()}`;
      }
      return { contentSelector: sel, contentBounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
    }

    // fallback: body 전체
    return { contentSelector: 'body', contentBounds: null };
  });
}
