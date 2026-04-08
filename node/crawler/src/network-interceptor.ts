/**
 * 네트워크 요청 인터셉터 - API 호출 자동 캡처
 */

import type { Page, Response } from 'playwright';
import type { ApiCall } from './page-scanner.js';

export class NetworkInterceptor {
  private calls: ApiCall[] = [];
  private stopped = false;

  constructor(private page: Page) {}

  async start(): Promise<void> {
    this.stopped = false;

    this.page.on('response', async (response: Response) => {
      if (this.stopped) return;

      try {
        const request = response.request();
        const url = request.url();

        // API 호출만 필터링 (정적 리소스 제외)
        if (this.isApiCall(url, request.resourceType())) {
          let requestBody: unknown = null;
          let responseBody: unknown = null;

          try {
            requestBody = request.postData() ? JSON.parse(request.postData()!) : null;
          } catch {
            requestBody = request.postData();
          }

          try {
            responseBody = await response.json();
          } catch {
            // JSON이 아닌 응답은 무시
          }

          if (!this.stopped) {
            this.calls.push({
              method: request.method(),
              url,
              requestBody,
              responseStatus: response.status(),
              responseBody,
              triggeredBy: null,
            });
          }
        }
      } catch {
        // 페이지가 닫힌 후 도착한 응답 등 — 무시
      }
    });
  }

  stop(): void {
    this.stopped = true;
  }

  getCapturedCalls(): ApiCall[] {
    return [...this.calls];
  }

  private isApiCall(url: string, resourceType: string): boolean {
    // XHR/fetch 요청만
    if (resourceType !== 'xhr' && resourceType !== 'fetch') {
      return false;
    }

    // 정적 리소스 제외
    const staticExtensions = ['.js', '.css', '.png', '.jpg', '.svg', '.woff', '.ttf'];
    if (staticExtensions.some((ext) => url.endsWith(ext))) {
      return false;
    }

    return true;
  }
}
