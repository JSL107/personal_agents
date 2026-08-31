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
// 초기 로드 시 뷰포트 높이가 scrollHeight 계산에 영향을 미치지 않도록 최소값으로 설정.
// 측정 후 실제 콘텐츠 높이로 다시 조정한다.
const INITIAL_VIEWPORT_HEIGHT = 1;

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
      // LLM 이 만든 문서는 신뢰 대상이 아니다. 파서가 src/href 속성을 걸러내지만
      // 인라인 script 의 fetch·CSS url() 까지는 못 막고, setContent 는 스크립트를 실행한다.
      // 나가는 요청을 전부 끊어 SSRF 가 성립하지 않게 한다 — 스크립트가 돌아도 무해해진다.
      // setJavaScriptEnabled(false) 는 쓰지 않는다 — page.evaluate 까지 막혀
      // 글자 크기·가려짐 측정(이 기능의 판정 전부)이 불가능해진다.
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        // setContent 는 CDP Page.setDocumentContent 로 문서를 주입할 뿐 별도 네트워크
        // 요청을 만들지 않는다(about:blank 그대로). 그래도 브라우저가 자체적으로 붙이는
        // 요청(예: about:blank 자체)까지 통과시켜 setContent 가 막히지 않게 한다.
        const url = request.url();
        if (url.startsWith('data:') || url === 'about:blank') {
          void request.continue();
          return;
        }
        void request.abort();
      });
      await page.setViewport({
        width: limits.widthPx,
        height: INITIAL_VIEWPORT_HEIGHT,
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
      });
      await page.setContent(html, {
        waitUntil: 'load',
        timeout: CONTENT_TIMEOUT_MS,
      });

      // 가려짐 판정(elementFromPoint)은 뷰포트 밖의 점에는 null 을 돌려준다. 초기 1px
      // 뷰포트인 채로 재면 콘텐츠 대부분이 화면 밖이라 가려짐을 하나도 못 잡는다.
      // scrollHeight 만 먼저 얕게 재서 뷰포트를 실제 콘텐츠 높이로 맞춘 뒤에야
      // 본 측정(가려짐 포함)을 정확히 할 수 있다.
      const roughContentHeight = await page.evaluate(
        () => document.documentElement.scrollHeight,
      );
      // fullPage 는 뷰포트 높이를 하한으로 삼는다. 콘텐츠가 그보다 짧으면 아래에 빈 여백이
      // 붙으므로, 캡처 전에 뷰포트를 실제 콘텐츠 높이로 맞춘다.
      await page.setViewport({
        width: limits.widthPx,
        height: Math.max(1, Math.ceil(roughContentHeight)),
        deviceScaleFactor: DEVICE_SCALE_FACTOR,
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
      if ((element.textContent ?? '').trim().length === 0) {
        return false;
      }
      // head 의 title·style 처럼 화면에 그려지지 않는 요소는 글자로 세지 않는다.
      // 렌더 사각형이 0 이면 사람 눈에 보이지 않는다 — 태그 이름을 나열해 막는 것보다
      // 넓게 걸러진다(script·template·hidden 등도 함께 빠진다).
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    const texts = leaves.map((element) => {
      const rect = element.getBoundingClientRect();
      const content = (element.textContent ?? '').trim().slice(0, 20);

      // 글자 자리에서 실제로 보이는 것이 이 요소인지 묻는다. 겹침의 원인(도형·다른 글자·
      // z-index)을 따지지 않고 결과만 본다 — 사람 눈이 보는 것과 같은 판정이다.
      // 한 점만 보면 글자 사이 공백에 찍혀 오판하므로 가로로 세 점을 뽑아 다수결로 정한다.
      const probes = [0.25, 0.5, 0.75].map((ratio) => ({
        x: rect.left + rect.width * ratio,
        y: rect.top + rect.height / 2,
      }));
      let coveredCount = 0;
      for (const probe of probes) {
        const top = document.elementFromPoint(probe.x, probe.y);
        if (top === null) {
          continue;
        }
        // 자기 자신이거나 자기 자손이면 가려진 것이 아니다.
        if (top === element || element.contains(top)) {
          continue;
        }
        coveredCount += 1;
      }

      return {
        label: `${element.tagName.toLowerCase()} "${content}"`,
        // CSS font-size 가 아니라 실제 렌더 높이를 쓴다.
        // SVG viewBox 스케일이 걸리면 두 값이 어긋나고, 눈에 보이는 것은 이쪽이다.
        renderedFontPx: rect.height,
        covered: coveredCount >= 2,
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
