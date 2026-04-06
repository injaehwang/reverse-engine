/**
 * SPA 화면 제목 추출
 * document.title이 동일할 때 h1, 브레드크럼, 활성 메뉴 등에서 제목을 추출한다
 */
import type { Page } from 'playwright';

export async function deriveTitle(page: Page, contentSelector: string): Promise<string> {
  return page.evaluate((sel) => {
    const content = document.querySelector(sel) || document.body;

    // 1. 콘텐츠 영역의 h1
    const h1 = content.querySelector('h1');
    if (h1?.textContent?.trim()) return h1.textContent.trim().slice(0, 80);

    // 2. 브레드크럼 마지막 항목
    const breadcrumb = document.querySelector(
      'nav[aria-label*="breadcrumb"] li:last-child, ' +
      '.breadcrumb > :last-child, ' +
      '[class*="breadcrumb"] > :last-child'
    );
    if (breadcrumb?.textContent?.trim()) return breadcrumb.textContent.trim().slice(0, 80);

    // 3. 콘텐츠 컨테이너의 aria-label
    const ariaLabel = content.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.slice(0, 80);

    // 4. 활성 네비게이션 메뉴
    const activeMenu = document.querySelector(
      'nav .active, nav [aria-current="page"], ' +
      '.sidebar .active, .nav-link.active, ' +
      '[class*="menu"] [class*="active"], [class*="selected"]'
    );
    if (activeMenu?.textContent?.trim()) return activeMenu.textContent.trim().slice(0, 80);

    // 5. 콘텐츠 영역의 h2
    const h2 = content.querySelector('h2');
    if (h2?.textContent?.trim()) return h2.textContent.trim().slice(0, 80);

    // 6. document.title (최후 수단)
    if (document.title) return document.title.slice(0, 80);

    // 7. URL 경로에서 추출
    const path = location.pathname.split('/').filter(Boolean).pop() || '';
    return path.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '(제목 없음)';
  }, contentSelector);
}
