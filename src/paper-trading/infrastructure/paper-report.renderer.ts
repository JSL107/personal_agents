import { Injectable } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer';

import {
  RenderReportInput,
  ReportRendererPort,
} from '../domain/port/report-renderer.port';

// 외부 리소스를 쓰지 않는 HTML 만 들어오므로(우리 코드가 만든다) 네트워크를 기다릴 이유가 없다.
const CONTENT_TIMEOUT_MS = 15_000;
// 논리 폭은 슬랙 카드 폭에 맞추고 물리 픽셀만 2배로 올린다. 슬랙이 축소해 보여줘도
// 선과 글자가 흐려지지 않는다.
const DEVICE_SCALE_FACTOR = 2;
// 초기 뷰포트 높이가 scrollHeight 계산에 섞이지 않게 최소값에서 시작한다.
const INITIAL_VIEWPORT_HEIGHT = 1;

@Injectable()
export class PaperReportRenderer implements ReportRendererPort {
  async render({ html, widthPx }: RenderReportInput): Promise<Buffer> {
    let browser: Browser | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      // 나가는 요청을 전부 끊는다. 이 HTML 에는 외부 자원이 없으므로 차단해도 그림이
      // 달라지지 않고, 종목명 같은 외부 문자열이 섞여 들어와도 그것으로 요청이 나가지 않는다.
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const url = request.url();
        if (url.startsWith('data:') || url === 'about:blank') {
          void request.continue();
          return;
        }
        void request.abort();
      });
      await page.setViewport({
        width: widthPx,
        height: INITIAL_VIEWPORT_HEIGHT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: CONTENT_TIMEOUT_MS,
      });
      // `fullPage` 는 뷰포트 높이를 하한으로 삼는다. 콘텐츠가 그보다 짧으면 아래에 빈
      // 여백이 붙으므로, 캡처 전에 뷰포트를 실제 콘텐츠 높이로 맞춘다.
      const contentHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      await page.setViewport({
        width: widthPx,
        height: Math.max(INITIAL_VIEWPORT_HEIGHT, contentHeight),
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });
      return Buffer.from(
        await page.screenshot({ type: 'png', fullPage: true }),
      );
    } finally {
      // 브라우저를 닫지 않으면 cron 회차마다 Chromium 프로세스가 남는다.
      await browser?.close();
    }
  }
}
