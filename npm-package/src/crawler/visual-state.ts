/**
 * Visual State 감지
 * URL이 아니라 콘텐츠 영역의 시각적 상태로 화면을 구분한다
 */
import type { Page } from 'playwright';
import { createHash } from 'crypto';

export interface VisualState {
  id: string;
  url: string;
  title: string;
  contentHash: string;
  screenshotPath: string | null;
  contentScreenshotPath: string | null;
  annotatedScreenshots: string[];
  elements: {
    links: { text: string; href: string; selector: string }[];
    buttons: { text: string; selector: string; x: number; y: number }[];
    forms: { id: string | null; action: string | null; method: string; fields: any[] }[];
  };
  apiCalls: { method: string; url: string; responseStatus: number; triggeredBy: string | null }[];
}

export interface Transition {
  fromStateId: string;
  toStateId: string;
  triggerType: 'click' | 'link' | 'form-submit' | 'navigation';
  triggerText: string;
  triggerPosition: { x: number; y: number } | null;
  annotatedScreenshotPath: string | null;
}

/** 콘텐츠 영역의 DOM 해시 계산 */
export async function computeContentHash(page: Page, contentSelector: string): Promise<string> {
  const fingerprint = await page.evaluate((sel) => {
    const content = document.querySelector(sel) || document.body;

    // DOM 구조 (태그 + 클래스, 텍스트 제외)
    function structureOf(el: Element, depth: number): string {
      if (depth > 6) return '';
      const tag = el.tagName;
      const role = el.getAttribute('role') || '';
      const childStructure = Array.from(el.children)
        .map(c => structureOf(c, depth + 1))
        .join('');
      return `<${tag}${role ? ':' + role : ''}>${childStructure}`;
    }

    // 보이는 텍스트 (동적 데이터 제거)
    function visibleText(el: Element): string {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const texts: string[] = [];
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        if (text && text.length > 2 && text.length < 100) {
          // 숫자만, 날짜, 시간 등 동적 값 제거
          if (!/^\d+$/.test(text) && !/^\d{4}[-/]/.test(text) && !/^\d{1,2}:\d{2}/.test(text)) {
            texts.push(text);
          }
        }
      }
      return texts.sort().slice(0, 30).join('|');
    }

    const structure = structureOf(content, 0);
    const text = visibleText(content);
    return structure + '||' + text;
  }, contentSelector);

  return createHash('sha256').update(fingerprint).digest('hex').slice(0, 16);
}

/** 상태 관리자 */
export class StateManager {
  private states = new Map<string, VisualState>();
  private transitions: Transition[] = [];
  private counter = 0;

  hasState(hash: string): boolean {
    return this.states.has(hash);
  }

  getState(hash: string): VisualState | undefined {
    return this.states.get(hash);
  }

  addState(hash: string, state: Omit<VisualState, 'id'>): VisualState {
    this.counter++;
    const id = `vs_${String(this.counter).padStart(3, '0')}`;
    const full: VisualState = { ...state, id };
    this.states.set(hash, full);
    return full;
  }

  addTransition(t: Transition): void {
    // 중복 방지
    const exists = this.transitions.some(
      e => e.fromStateId === t.fromStateId && e.toStateId === t.toStateId && e.triggerText === t.triggerText
    );
    if (!exists) this.transitions.push(t);
  }

  getAllStates(): VisualState[] {
    return [...this.states.values()];
  }

  getAllTransitions(): Transition[] {
    return [...this.transitions];
  }

  get stateCount(): number { return this.states.size; }
}
