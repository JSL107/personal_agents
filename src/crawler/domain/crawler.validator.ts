import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  CrawlPermanentException,
  CrawlTransientException,
} from './crawl.exception';
import { CrawlErrorCode } from './crawl-error-code.enum';
import { resolveHostPolicy } from './crawl-target.policy';

const parseHttpUrl = ({ url }: { url: string }): URL => {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch (error: unknown) {
    throw new CrawlPermanentException({
      code: CrawlErrorCode.INVALID_URL,
      message: `유효하지 않은 크롤링 URL입니다: ${url}`,
      status: DomainStatus.BAD_REQUEST,
      cause: error,
    });
  }

  const isHttp = parsedUrl.protocol === 'http:';
  const isHttps = parsedUrl.protocol === 'https:';
  if (!isHttp && !isHttps) {
    throw new CrawlPermanentException({
      code: CrawlErrorCode.INVALID_URL,
      message: `지원하지 않는 URL 프로토콜입니다: ${url}`,
      status: DomainStatus.BAD_REQUEST,
    });
  }
  return parsedUrl;
};

// 프로토콜 + 대상 주소 검증. 대상이 내부망으로 풀리면 거부한다(SSRF 차단).
// 요청 접수 시점과 리다이렉트 도착 시점 **양쪽** 에서 부른다 — 앞만 막으면 바깥 주소로
// 시작해 내부로 리다이렉트하는 경로가 그대로 통과한다.
export const validateCrawlUrl = async ({
  url,
}: {
  url: string;
}): Promise<void> => {
  const parsedUrl = parseHttpUrl({ url });

  const policy = await resolveHostPolicy(parsedUrl.hostname);
  if (policy.kind === 'BLOCKED') {
    throw new CrawlPermanentException({
      code: CrawlErrorCode.INVALID_URL,
      // 어느 주소로 풀렸는지는 로그에만 남기고 메시지에는 호스트까지만 적는다.
      message: `내부 주소로 향하는 크롤링 대상은 허용하지 않습니다: ${parsedUrl.hostname}`,
      status: DomainStatus.BAD_REQUEST,
    });
  }
  if (policy.kind === 'UNRESOLVED') {
    // 이름을 못 푼 것은 일시적일 수 있다(DNS 흔들림) — 재시도 대상으로 둔다.
    throw new CrawlTransientException({
      message: `크롤링 대상 주소를 해석하지 못했습니다: ${parsedUrl.hostname}`,
    });
  }
};

export const validateCrawlResponse = ({
  responseStatus,
  url,
}: {
  responseStatus: number | null;
  url: string;
}): void => {
  if (responseStatus === null) {
    throw new CrawlTransientException({
      message: `크롤링 응답을 받지 못했습니다: ${url}`,
    });
  }

  if (responseStatus === 429 || responseStatus >= 500) {
    throw new CrawlTransientException({
      message: `일시적인 크롤링 대상 오류가 발생했습니다. (${responseStatus}) ${url}`,
    });
  }

  if (responseStatus >= 400) {
    const code =
      responseStatus === 404
        ? CrawlErrorCode.TARGET_NOT_FOUND
        : CrawlErrorCode.FAILED;

    throw new CrawlPermanentException({
      code,
      message: `복구 불가능한 크롤링 대상 오류가 발생했습니다. (${responseStatus}) ${url}`,
      status:
        responseStatus === 404
          ? DomainStatus.NOT_FOUND
          : DomainStatus.BAD_GATEWAY,
    });
  }
};
