import { Injectable } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';

import {
  RenderDiagramInput,
  RenderedDiagram,
  StudyDiagramRendererPort,
} from '../domain/port/study-diagram-renderer.port';
import {
  DiagramMeasurements,
  findDiagramViolations,
} from '../domain/study-diagram.checker';

// 외부 리소스를 쓰지 않는 문서만 들어오므로(파서가 거른다) 네트워크를 기다릴 이유가 없다.
const CONTENT_TIMEOUT_MS = 15_000;
// 논리 폭은 노션 본문 폭과 같게 두고, 물리 픽셀만 2배로 올린다.
// 이렇게 해야 노션에서 축소가 일어나지 않으면서 확대 시 선명하다.
const DEVICE_SCALE_FACTOR = 2;
const INITIAL_VIEWPORT_HEIGHT = 800;

@Injectable()
export class StudyDiagramRenderer implements StudyDiagramRendererPort {
  async render({ html, limits }: RenderDiagramInput): Promise<RenderedDiagram> {
    let browser: Browser | undefined;
    let page: Page | undefined;

    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      page = await browser.newPage();
      await page.setViewport({
        width: limits.widthPx,
        height: INITIAL_VIEWPORT_HEIGHT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: CONTENT_TIMEOUT_MS,
      });

      const measurements = await measureDocument(page);
      const screenshot = await page.screenshot({ fullPage: true, type: 'png' });

      return {
        png: Buffer.from(screenshot),
        violations: findDiagramViolations(measurements, limits),
      };
    } finally {
      await closeQuietly(page, browser);
    }
  }
}

const measureDocument = async (page: Page): Promise<DiagramMeasurements> =>
  page.evaluate(() => {
    // 글자를 실제로 들고 있는 리프 요소만 잰다. 부모 컨테이너까지 세면
    // 같은 글자를 여러 번 세게 되고, 컨테이너 높이가 글자 크기로 둔갑한다.
    const leaves = Array.from(
      document.querySelectorAll<HTMLElement>('*'),
    ).filter((element) => {
      if (element.children.length > 0) {
        return false;
      }
      return (element.textContent ?? '').trim().length > 0;
    });

    const texts = leaves.map((element) => {
      const rect = element.getBoundingClientRect();
      const content = (element.textContent ?? '').trim().slice(0, 20);
      return {
        label: `${element.tagName.toLowerCase()} "${content}"`,
        // CSS font-size 가 아니라 실제 렌더 높이를 쓴다.
        // SVG viewBox 스케일이 걸리면 두 값이 어긋나고, 눈에 보이는 것은 이쪽이다.
        renderedFontPx: rect.height,
      };
    });

    // 오른쪽 끝이 가장 먼 요소로 실제 내용 폭을 잡는다.
    // scrollWidth 는 넘친 요소를 반영하지 못하는 경우가 있다.
    const rightMost = Array.from(
      document.querySelectorAll<HTMLElement>('*'),
    ).reduce(
      (maxRight, element) =>
        Math.max(maxRight, element.getBoundingClientRect().right),
      0,
    );

    return {
      texts,
      contentWidth: Math.max(rightMost, document.documentElement.scrollWidth),
      contentHeight: document.documentElement.scrollHeight,
    };
  });

// 정리 실패가 본 작업의 성공을 무효화하지 않게 한다 — crawler.requester.ts 와 같은 방침.
const closeQuietly = async (
  page: Page | undefined,
  browser: Browser | undefined,
): Promise<void> => {
  try {
    if (page) {
      await page.close();
    }
  } catch {
    // 페이지 정리 실패는 무시한다. 브라우저를 닫으면 함께 정리된다.
  }
  try {
    if (browser) {
      await browser.close();
    }
  } catch {
    // 브라우저 정리 실패도 무시한다. 프로세스 종료 시 회수된다.
  }
};
