/**
 * 클릭 위치 표시
 * 스크린샷에 빨간 원과 라벨을 오버레이한다 (DOM 주입 방식, sharp 불필요)
 */
import type { Page } from 'playwright';

/** 클릭 전에 위치를 표시하고 스크린샷을 찍는다 */
export async function screenshotWithClickMarker(
  page: Page,
  x: number,
  y: number,
  label: string,
  outputPath: string,
): Promise<void> {
  // DOM에 오버레이 삽입
  await page.evaluate(({ x, y, label }) => {
    const overlay = document.createElement('div');
    overlay.id = '__re_click_marker';
    overlay.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; z-index:999999; pointer-events:none;';

    // 빨간 원
    const circle = document.createElement('div');
    circle.style.cssText = `
      position:absolute; left:${x - 18}px; top:${y - 18}px;
      width:36px; height:36px; border-radius:50%;
      border: 3px solid #ff0000; background: rgba(255,0,0,0.15);
    `;
    overlay.appendChild(circle);

    // 중심점
    const dot = document.createElement('div');
    dot.style.cssText = `
      position:absolute; left:${x - 4}px; top:${y - 4}px;
      width:8px; height:8px; border-radius:50%; background:#ff0000;
    `;
    overlay.appendChild(dot);

    // 라벨
    if (label) {
      const lbl = document.createElement('div');
      lbl.style.cssText = `
        position:absolute; left:${x + 24}px; top:${y - 10}px;
        background:#ff0000; color:#fff; padding:2px 8px;
        border-radius:3px; font-size:12px; font-weight:bold;
        white-space:nowrap; font-family:sans-serif;
      `;
      lbl.textContent = label;
      overlay.appendChild(lbl);
    }

    document.body.appendChild(overlay);
  }, { x, y, label });

  // 스크린샷 촬영
  await page.screenshot({ path: outputPath, fullPage: false });

  // 오버레이 제거
  await page.evaluate(() => {
    document.getElementById('__re_click_marker')?.remove();
  });
}

/** 현재 화면에 마커 없이 스크린샷만 촬영 (뷰포트) */
export async function screenshotViewport(page: Page, outputPath: string): Promise<void> {
  await page.screenshot({ path: outputPath, fullPage: false });
}

/** 콘텐츠 영역만 스크린샷 */
export async function screenshotContent(page: Page, contentSelector: string, outputPath: string): Promise<void> {
  const el = page.locator(contentSelector).first();
  const visible = await el.isVisible().catch(() => false);
  if (visible) {
    await el.screenshot({ path: outputPath });
  } else {
    await page.screenshot({ path: outputPath, fullPage: false });
  }
}
