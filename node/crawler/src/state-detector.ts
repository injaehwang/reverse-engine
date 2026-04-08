/**
 * SPA 상태 중복 감지
 *
 * 같은 URL에서 다른 UI 상태(모달, 탭, 아코디언 등)를 탐색할 때
 * 이미 방문한 "유사한" 상태를 감지하여 중복 탐색을 방지한다.
 *
 * 전략: DOM 구조의 해시를 계산하여 비교 (텍스트 콘텐츠 제외, 구조만)
 */

import type { Page } from 'playwright';

export class StateDetector {
  /** URL → 방문한 DOM 구조 해시 집합 */
  private visitedStates = new Map<string, Set<string>>();

  /** 유사도 임계값 (0~1). 이 값 이상이면 같은 상태로 판단 */
  private readonly similarityThreshold = 0.85;

  /**
   * 현재 페이지의 DOM 구조 해시를 계산하고, 이미 방문한 상태인지 확인
   * @returns true면 새로운 상태, false면 이미 방문한 유사 상태
   */
  async isNewState(page: Page): Promise<boolean> {
    const url = this.normalizeUrl(page.url());
    const structureHash = await this.getDomStructureHash(page);

    if (!this.visitedStates.has(url)) {
      this.visitedStates.set(url, new Set());
    }

    const visited = this.visitedStates.get(url)!;

    // 정확히 같은 해시가 있으면 중복
    if (visited.has(structureHash)) {
      return false;
    }

    visited.add(structureHash);
    return true;
  }

  /**
   * DOM의 구조적 해시를 계산
   * 텍스트 콘텐츠는 무시하고 태그 구조와 클래스명만 사용
   */
  private async getDomStructureHash(page: Page): Promise<string> {
    return page.evaluate(() => {
      function getStructure(el: Element, depth: number): string {
        if (depth > 6) return ''; // 깊이 제한

        const tag = el.tagName.toLowerCase();
        const classes = Array.from(el.classList).sort().join('.');
        const role = el.getAttribute('role') || '';
        const visible = (el as HTMLElement).offsetParent !== null;

        if (!visible) return ''; // 숨겨진 요소 무시

        const children = Array.from(el.children)
          .map((child) => getStructure(child, depth + 1))
          .filter(Boolean)
          .join(',');

        return `${tag}${classes ? '.' + classes : ''}${role ? '[' + role + ']' : ''}{${children}}`;
      }

      return getStructure(document.body, 0);
    });
  }

  /** URL 정규화: 해시/쿼리 파라미터 순서 통일 */
  private normalizeUrl(url: string): string {
    try {
      const u = new URL(url);
      u.hash = '';
      // 쿼리 파라미터 정렬
      const params = new URLSearchParams(u.search);
      const sorted = new URLSearchParams([...params.entries()].sort());
      u.search = sorted.toString();
      return u.href;
    } catch {
      return url;
    }
  }

  /** 통계 반환 */
  getStats(): { urlCount: number; totalStates: number } {
    let totalStates = 0;
    for (const states of this.visitedStates.values()) {
      totalStates += states.size;
    }
    return {
      urlCount: this.visitedStates.size,
      totalStates,
    };
  }
}
