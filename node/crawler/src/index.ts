/**
 * ReversEngine Crawler - Playwright 기반 웹 서비스 자동 크롤러
 *
 * Rust CLI에서 subprocess로 호출되며 stdin/stdout JSON으로 통신
 */

import { crawl } from './browser.js';
import { PageScanner } from './page-scanner.js';
import { NetworkInterceptor } from './network-interceptor.js';

interface IpcRequest {
  command: string;
  payload: {
    url: string;
    maxDepth: number;
    maxPages: number;
    screenshot: boolean;
    har: boolean;
    authCookie?: string;
  };
}

interface IpcResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

async function main() {
  // stdin에서 JSON 입력 읽기
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');

  let response: IpcResponse;

  try {
    const request: IpcRequest = JSON.parse(input);
    const result = await crawl(request.payload);
    response = { success: true, data: result };
  } catch (error) {
    response = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // stdout으로 JSON 결과 출력
  process.stdout.write(JSON.stringify(response));
}

main().catch(console.error);

export { PageScanner } from './page-scanner.js';
export { NetworkInterceptor } from './network-interceptor.js';
export { StateDetector } from './state-detector.js';
