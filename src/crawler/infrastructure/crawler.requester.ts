import { Injectable } from '@nestjs/common';
import puppeteer, { Browser, Page } from 'puppeteer';

import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  CrawlException,
  CrawlPermanentException,
} from '../domain/crawl.exception';
import { CrawlErrorCode } from '../domain/crawl-error-code.enum';
import { resolveHostPolicy } from '../domain/crawl-target.policy';
import { CrawledPage, CrawlTarget } from '../domain/crawler.type';
import {
  CRAWLER_REQUESTER_PORT,
  CrawlerRequesterPort,
} from '../domain/port/crawler-requester.port';
import {
  createCleanupError,
  createUnexpectedRequestError,
} from './crawl-error.util';

export { CRAWLER_REQUESTER_PORT };

@Injectable()
export class CrawlerRequester implements CrawlerRequesterPort {
  async request({ url }: CrawlTarget): Promise<CrawledPage> {
    let browser: Browser | undefined;
    let page: Page | undefined;
    let requestError: unknown;
    let cleanupError: CrawlException | undefined;
    let result: CrawledPage | undefined;

    try {
      // 샌드박스를 끄지 않는다. 이 브라우저가 여는 것은 바깥에서 받은 주소이고,
      // 렌더러 샌드박스는 그 콘텐츠와 호스트 사이의 마지막 경계다.
      //
      // `--block-new-web-contents`: 팝업·새 탭 생성을 브라우저가 아예 거부한다. 페이지 단위
      // 요청 인터셉트는 새 target 에 걸리지 않고, `targetcreated` 를 받아 닫는 것은 늦다 —
      // 이벤트를 받아 `target.page()` 를 기다리는 사이에 그 창의 첫 요청은 이미 나간다.
      // 크롤러는 준 주소 한 장만 읽으면 되므로 창이 늘어날 이유가 없다.
      browser = await puppeteer.launch({
        headless: true,
        args: ['--block-new-web-contents'],
      });

      page = await browser.newPage();
      const blocked = await guardOutboundRequests(browser, page);

      const response = await page
        .goto(url, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        })
        .catch((error: unknown) => {
          // 정책이 막아서 실패한 것이라면 영구 거부다. 그대로 두면 puppeteer 의
          // `net::ERR_BLOCKED_BY_CLIENT` 가 crawl-error.util 의 `net::ERR_` 패턴에 걸려
          // 일시 오류로 분류되고, BullMQ 가 막힌 대상을 3회 재시도한다.
          if (blocked.hit !== null) {
            throw new CrawlPermanentException({
              code: CrawlErrorCode.INVALID_URL,
              message: `내부 주소로 향하는 크롤링 대상은 허용하지 않습니다: ${blocked.hit}`,
              status: DomainStatus.BAD_REQUEST,
            });
          }
          throw error;
        });
      const html = await page.content();
      const finalUrl = page.url();
      const responseStatus = response ? response.status() : null;

      result = { requestedUrl: url, finalUrl, html, responseStatus };
    } catch (error: unknown) {
      requestError = error;
    } finally {
      cleanupError = await this.closeResources({ browser, page, url });
    }

    if (cleanupError && !requestError) {
      throw cleanupError;
    }

    if (requestError) {
      throw requestError;
    }

    if (result) {
      return result;
    }

    throw createUnexpectedRequestError({ url });
  }

  private async closeResources({
    browser,
    page,
    url,
  }: {
    browser?: Browser;
    page?: Page;
    url: string;
  }): Promise<CrawlException | undefined> {
    const pageCloseError = await this.closePage({ page, url });
    const browserCloseError = await this.closeBrowser({ browser, url });

    if (pageCloseError && browserCloseError) {
      return pageCloseError;
    }

    if (pageCloseError) {
      return pageCloseError;
    }

    return browserCloseError;
  }

  private async closePage({
    page,
    url,
  }: {
    page?: Page;
    url: string;
  }): Promise<CrawlException | undefined> {
    if (!page) {
      return undefined;
    }

    try {
      await page.close();
      return undefined;
    } catch (error: unknown) {
      return createCleanupError({ resource: 'page', url, cause: error });
    }
  }

  private async closeBrowser({
    browser,
    url,
  }: {
    browser?: Browser;
    url: string;
  }): Promise<CrawlException | undefined> {
    if (!browser) {
      return undefined;
    }

    try {
      await browser.close();
      return undefined;
    } catch (error: unknown) {
      return createCleanupError({ resource: 'browser', url, cause: error });
    }
  }
}

// 브라우저가 내보내는 요청을 **나가기 전에** 막는다.
//
// 접수 시점 검증만으로는 부족하다 — 바깥 주소로 시작해 내부로 튕기는 리다이렉트는 요청이
// 이미 나간 뒤에야 드러나고, 그때는 내부 엔드포인트가 이미 한 번 호출된 뒤다. 네비게이션만
// 봐도 안 된다: 페이지가 심는 `<img src="http://192.168.0.1/...">` 한 줄이면 응답을 읽지
// 못해도 내부 GET 은 그대로 일어난다. 그래서 하위 리소스까지 전부 검사한다.
//
// 호스트별 판정은 캐시한다 — 한 페이지가 같은 호스트로 수십 개를 요청하는데 매번 DNS 를
// 해석하면 크롤 시간이 늘어난다. 캐시는 이 페이지 한 번의 수명만 산다.
//
// 반환값의 `hit` 은 "정책이 실제로 막았다" 는 표시다. 호출부가 이걸 보고 실패를 영구 거부로
// 분류한다(재시도 금지).
interface BlockRecord {
  hit: string | null;
}

const guardOutboundRequests = async (
  browser: Browser,
  page: Page,
): Promise<BlockRecord> => {
  const record: BlockRecord = { hit: null };
  const verdicts = new Map<string, boolean>();

  const isAllowed = async (hostname: string): Promise<boolean> => {
    const cached = verdicts.get(hostname);
    if (cached !== undefined) {
      return cached;
    }
    const policy = await resolveHostPolicy(hostname);
    const allowed = policy.kind === 'ALLOWED';
    verdicts.set(hostname, allowed);
    return allowed;
  };

  // 팝업은 페이지 스크립트가 실행되기 전에 `window.open` 을 막아 원천 차단한다.
  //
  // 새 창은 이 인터셉트가 걸리지 않는 별도 target 이라 그대로 두면 내부 주소로 첫 요청을
  // 보낼 수 있다. `targetcreated` 를 받아 닫는 것으로는 늦다 — 이벤트를 받아 `target.page()`
  // 를 기다리는 사이에 그 창의 첫 요청은 이미 나간다(실측: 내부 서버가 2회 호출됐다).
  // launch 의 `--block-new-web-contents` 도 headless 에서는 이 경로를 막지 못했다.
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(window, 'open', {
      value: () => null,
      writable: false,
      configurable: false,
    });
  });

  // 위 두 겹을 지나 어떤 경위로든 창이 생겼다면 닫는다. 첫 요청을 막지는 못하는 안전망이다.
  browser.on('targetcreated', (target) => {
    void (async () => {
      const opened = await target.page().catch(() => null);
      if (opened && opened !== page) {
        await opened.close().catch(() => undefined);
      }
    })();
  });

  await page.setRequestInterception(true);
  page.on('request', (request) => {
    void (async () => {
      try {
        const { hostname, protocol } = new URL(request.url());
        // data:/blob:/about: 는 네트워크로 나가지 않는다 — 호스트가 없어 판정 대상이 아니다.
        if (protocol !== 'http:' && protocol !== 'https:') {
          await request.continue();
          return;
        }
        if (await isAllowed(hostname)) {
          await request.continue();
          return;
        }
        record.hit = hostname;
        await request.abort('blockedbyclient');
      } catch {
        // 판정 자체가 실패하면 보내지 않는다 — 막는 쪽이 기본값이다.
        await request.abort('blockedbyclient').catch(() => undefined);
      }
    })();
  });

  return record;
};
