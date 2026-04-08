/**
 * 인증 핸들러 - 로그인 흐름 자동 처리
 *
 * 지원: form, cookie, bearer, oauth2 (provider-agnostic)
 */

import type { Page, BrowserContext } from 'playwright';

export interface AuthConfig {
  type: 'form' | 'cookie' | 'bearer' | 'oauth2';
  loginUrl?: string;
  credentials?: Record<string, string>;
  submitSelector?: string;
  cookie?: string;
  bearerToken?: string;
  /** OAuth2 설정 */
  oauth2?: OAuth2Config;
}

export interface OAuth2Config {
  /** 로그인 시작 URL (앱의 /login 또는 /auth 등) */
  loginUrl: string;
  /** IdP 로그인 폼 credentials. key: CSS selector 또는 필드명, value: 입력값 */
  credentials: Record<string, string>;
  /** IdP 로그인 submit 버튼 selector (기본: button[type="submit"]) */
  submitSelector?: string;
  /** 인증 완료 후 도착해야 하는 URL 패턴 (기본: 시작 URL의 origin) */
  callbackUrlPattern?: string;
  /** 인증 완료 대기 타임아웃 ms (기본: 30000) */
  timeout?: number;
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
      case 'oauth2':
        await this.oauth2Auth();
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

    // SPA는 navigation 없이 토큰만 설정할 수 있으므로 타임아웃 허용
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 })
      .catch(() => {
        // navigation이 없으면 networkidle 대기로 폴백
        return page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      });

    await page.close();
  }

  private async cookieAuth(): Promise<void> {
    if (!this.config.cookie) {
      throw new Error('cookie 인증에는 cookie 값이 필요합니다');
    }

    // 도메인을 loginUrl 또는 cookie 자체에서 추론
    const domain = this.config.loginUrl
      ? new URL(this.config.loginUrl).hostname
      : 'localhost';

    const cookies = this.config.cookie.split(';').map((c) => {
      const eqIdx = c.trim().indexOf('=');
      const name = c.trim().slice(0, eqIdx);
      const value = c.trim().slice(eqIdx + 1); // '=' 이후 전체 (JWT 등 '=' 포함 가능)
      return { name, value, domain, path: '/' };
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

  /**
   * OAuth2 범용 인증 핸들러
   *
   * Provider-agnostic 전략:
   * 1. 앱의 로그인 URL로 이동 → IdP로 리다이렉트됨
   * 2. IdP 로그인 페이지에서 credential 필드를 자동 감지하여 입력
   * 3. submit 후 콜백 URL로 돌아올 때까지 대기
   *
   * Google, Azure AD, Auth0, Okta, Keycloak 등 모든 redirect 기반 OAuth2 지원
   */
  private async oauth2Auth(): Promise<void> {
    const oauth = this.config.oauth2;
    if (!oauth) {
      throw new Error('oauth2 인증에는 oauth2 설정이 필요합니다');
    }

    const page = await this.context.newPage();
    const timeout = oauth.timeout ?? 30000;

    // 1. 앱의 로그인 URL로 이동 → IdP로 자동 리다이렉트
    await page.goto(oauth.loginUrl, { waitUntil: 'networkidle', timeout });

    // 2. IdP 로그인 페이지에서 credential 입력
    // credentials의 key가 CSS selector이면 직접 사용, 아니면 name/id로 탐색
    for (const [field, value] of Object.entries(oauth.credentials)) {
      const filled = await this.fillField(page, field, value);
      if (!filled) {
        console.warn(`OAuth2: 필드 "${field}"를 찾을 수 없습니다 (URL: ${page.url()})`);
      }
    }

    // 3. 제출
    const submitSelector = oauth.submitSelector || 'button[type="submit"], input[type="submit"]';
    await page.click(submitSelector);

    // 4. 콜백 URL로 돌아올 때까지 대기
    const callbackPattern = oauth.callbackUrlPattern
      ?? new URL(oauth.loginUrl).origin;

    await page.waitForURL(
      (url) => url.href.startsWith(callbackPattern),
      { timeout, waitUntil: 'networkidle' },
    ).catch(async () => {
      // 일부 IdP는 동의 화면(consent screen)이 추가로 나옴
      // 동의 버튼이 있으면 클릭
      const consentBtn = page.locator(
        'button:has-text("동의"), button:has-text("Allow"), button:has-text("Accept"), button:has-text("Consent"), button:has-text("허용")',
      ).first();

      if (await consentBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await consentBtn.click();
        await page.waitForURL(
          (url) => url.href.startsWith(callbackPattern),
          { timeout: 10000, waitUntil: 'networkidle' },
        );
      }
    });

    // 5. 멀티스텝 로그인 지원 (Google 스타일: 이메일 → 다음 → 비밀번호 → 다음)
    // 이미 콜백에 도달했으면 스킵, 아직 IdP에 있으면 추가 필드 입력 시도
    if (!page.url().startsWith(callbackPattern)) {
      await this.handleMultiStepLogin(page, oauth, callbackPattern, timeout);
    }

    await page.close();
  }

  /**
   * 멀티스텝 로그인 처리 (Google, Microsoft 등)
   * 이메일 입력 → 다음 → 비밀번호 입력 → 다음 패턴
   */
  private async handleMultiStepLogin(
    page: Page,
    oauth: OAuth2Config,
    callbackPattern: string,
    timeout: number,
  ): Promise<void> {
    // 남은 credential을 다시 시도 (이전 단계에서 못 입력한 것)
    for (const [field, value] of Object.entries(oauth.credentials)) {
      const filled = await this.fillField(page, field, value);
      if (filled) {
        // 입력 후 다음/submit 버튼 클릭
        const nextBtn = page.locator(
          'button:has-text("다음"), button:has-text("Next"), button[type="submit"], input[type="submit"]',
        ).first();

        if (await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
          await nextBtn.click();
          await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        }
      }
    }

    // 최종 콜백 대기
    await page.waitForURL(
      (url) => url.href.startsWith(callbackPattern),
      { timeout, waitUntil: 'networkidle' },
    ).catch(() => {
      console.warn(`OAuth2: 콜백 URL 도달 실패. 현재 URL: ${page.url()}`);
    });
  }

  /**
   * 필드에 값 입력 시도. selector 또는 name/id/type으로 탐색.
   * @returns 입력 성공 여부
   */
  private async fillField(page: Page, field: string, value: string): Promise<boolean> {
    // 1차: field가 CSS selector인 경우 직접 시도
    try {
      const direct = page.locator(field).first();
      if (await direct.isVisible({ timeout: 2000 }).catch(() => false)) {
        await direct.fill(value);
        return true;
      }
    } catch {
      // selector가 아닌 경우 무시
    }

    // 2차: name, id, type, placeholder로 탐색
    const selectors = [
      `[name="${field}"]`,
      `#${field}`,
      `input[type="${field}"]`,
      `[placeholder*="${field}" i]`,
      `[aria-label*="${field}" i]`,
    ];

    for (const selector of selectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
          await el.fill(value);
          return true;
        }
      } catch {
        continue;
      }
    }

    return false;
  }
}
