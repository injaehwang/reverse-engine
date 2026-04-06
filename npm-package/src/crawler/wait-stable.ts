/**
 * SPA 렌더링 안정화 대기
 * networkidle만으로는 부족 — DOM 변화가 멈출 때까지 기다린다
 */
import type { Page } from 'playwright';

export async function waitForVisualStability(page: Page, timeout = 5000): Promise<void> {
  // 1. 기본 네트워크 대기
  await page.waitForLoadState('networkidle').catch(() => {});

  // 2. 로딩 인디케이터 사라질 때까지
  await page.waitForFunction(() => {
    const loaders = document.querySelectorAll(
      '.spinner, .loading, [aria-busy="true"], .skeleton, ' +
      '[class*="loading"], [class*="spinner"], [class*="skeleton"]'
    );
    return loaders.length === 0;
  }, { timeout: timeout / 2 }).catch(() => {});

  // 3. DOM 변화가 멈출 때까지 (500ms 동안 변화 없으면 안정)
  await page.evaluate((stabilizeMs) => {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      const observer = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => { observer.disconnect(); resolve(); }, stabilizeMs);
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      timer = setTimeout(() => { observer.disconnect(); resolve(); }, stabilizeMs);
    });
  }, 500).catch(() => {});
}
