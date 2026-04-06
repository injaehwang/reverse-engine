/**
 * 인증 핸들러 - 로그인 흐름 자동 처리
 */

import type { Page, BrowserContext } from 'playwright';

export interface AuthConfig {
  type: 'form' | 'cookie' | 'bearer' | 'custom';
  loginUrl?: string;
  credentials?: Record<string, string>;
  submitSelector?: string;
  cookie?: string;
  bearerToken?: string;
}

export class AuthHandler {
  constructor(
    private context: BrowserContext,
    private config: AuthConfig,
  ) {}

  async authenticate(): Promise<void> {
    switch (this.config.type) {
      case 'form':
        await this.formAuth();
        break;
      case 'cookie':
        await this.cookieAuth();
        break;
      case 'bearer':
        await this.bearerAuth();
        break;
    }
  }

  private async formAuth(): Promise<void> {
    if (!this.config.loginUrl || !this.config.credentials) {
      throw new Error('form 인증에는 loginUrl과 credentials가 필요합니다');
    }

    const page = await this.context.newPage();
    await page.goto(this.config.loginUrl);

    // 자격증명 필드 자동 입력
    for (const [field, value] of Object.entries(this.config.credentials)) {
      await page.fill(`[name="${field}"], #${field}`, value);
    }

    // 제출
    const submitSelector = this.config.submitSelector || 'button[type="submit"]';
    await page.click(submitSelector);
    await page.waitForNavigation({ waitUntil: 'networkidle' });

    await page.close();
  }

  private async cookieAuth(): Promise<void> {
    if (!this.config.cookie) {
      throw new Error('cookie 인증에는 cookie 값이 필요합니다');
    }

    const cookies = this.config.cookie.split(';').map((c) => {
      const [name, value] = c.trim().split('=');
      return { name, value, domain: 'localhost', path: '/' };
    });

    await this.context.addCookies(cookies);
  }

  private async bearerAuth(): Promise<void> {
    if (!this.config.bearerToken) {
      throw new Error('bearer 인증에는 bearerToken이 필요합니다');
    }

    // 모든 요청에 Authorization 헤더 추가
    await this.context.setExtraHTTPHeaders({
      Authorization: `Bearer ${this.config.bearerToken}`,
    });
  }
}
