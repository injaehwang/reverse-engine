/**
 * DOM 요소 스캔 - 페이지 내 모든 인터랙티브 요소 추출
 */

import type { Page } from 'playwright';

export interface LinkElement {
  text: string;
  href: string;
  selector: string;
}

export interface ButtonElement {
  text: string;
  selector: string;
  eventHandler: string | null;
  navigatesTo: string | null;
}

export interface FormElement {
  id: string | null;
  action: string | null;
  method: string;
  fields: FormField[];
}

export interface FormField {
  name: string;
  fieldType: string;
  required: boolean;
  placeholder: string | null;
}

export interface ApiCall {
  method: string;
  url: string;
  requestBody: unknown | null;
  responseStatus: number;
  responseBody: unknown | null;
  triggeredBy: string | null;
}

export interface PageElements {
  links: LinkElement[];
  buttons: ButtonElement[];
  forms: FormElement[];
}

export interface PageInfo {
  url: string;
  title: string;
  screenshotPath: string | null;
  elements: PageElements;
  apiCalls: ApiCall[];
  navigatesTo: string[];
  authRequired: boolean;
}

export class PageScanner {
  constructor(private page: Page) {}

  async scan(url: string): Promise<PageInfo> {
    const title = await this.page.title();
    const links = await this.scanLinks();
    const buttons = await this.scanButtons();
    const forms = await this.scanForms();

    const navigatesTo = [
      ...links.map((l) => l.href),
    ].filter((v, i, a) => a.indexOf(v) === i); // 중복 제거

    return {
      url,
      title,
      screenshotPath: null,
      elements: { links, buttons, forms },
      apiCalls: [],
      navigatesTo,
      authRequired: false, // TODO: 로그인 리다이렉트 감지
    };
  }

  private async scanLinks(): Promise<LinkElement[]> {
    return this.page.evaluate(() => {
      const links: LinkElement[] = [];
      document.querySelectorAll('a[href]').forEach((el, i) => {
        const a = el as HTMLAnchorElement;
        links.push({
          text: a.textContent?.trim() || '',
          href: a.href,
          selector: a.id ? `#${a.id}` : `a:nth-of-type(${i + 1})`,
        });
      });
      return links;
    });
  }

  private async scanButtons(): Promise<ButtonElement[]> {
    return this.page.evaluate(() => {
      const buttons: ButtonElement[] = [];
      document
        .querySelectorAll('button, [role="button"], input[type="submit"]')
        .forEach((el, i) => {
          const btn = el as HTMLElement;
          buttons.push({
            text: btn.textContent?.trim() || (btn as HTMLInputElement).value || '',
            selector: btn.id ? `#${btn.id}` : `button:nth-of-type(${i + 1})`,
            eventHandler: null, // Playwright에서는 직접 접근 불가 → 코드 분석에서 보완
            navigatesTo: null,
          });
        });
      return buttons;
    });
  }

  private async scanForms(): Promise<FormElement[]> {
    return this.page.evaluate(() => {
      const forms: FormElement[] = [];
      document.querySelectorAll('form').forEach((el) => {
        const form = el as HTMLFormElement;
        const fields: FormField[] = [];

        form.querySelectorAll('input, select, textarea').forEach((fieldEl) => {
          const field = fieldEl as HTMLInputElement;
          fields.push({
            name: field.name || field.id || '',
            fieldType: field.type || field.tagName.toLowerCase(),
            required: field.required,
            placeholder: field.placeholder || null,
          });
        });

        forms.push({
          id: form.id || null,
          action: form.action || null,
          method: form.method?.toUpperCase() || 'GET',
          fields,
        });
      });
      return forms;
    });
  }
}
