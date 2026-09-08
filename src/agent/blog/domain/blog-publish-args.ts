/**
 * `/blog-publish` 인자 파싱 — 초안 제목 일부와 발행 날짜를 함께 받는다.
 *
 * 날짜를 여는 이유. 게이트 오탐이나 실패로 그날 회차가 나가지 못하면 그 초안은 며칠 뒤 큐
 * 차례가 돌아와 **그때 날짜로** 발행된다(`astro-post.ts` 의 `publishedAt`). 글은 살아남지만
 * 달력의 그 칸은 영영 빈다 — 실측으로 2026-08-18 부터 3주 동안 6일이 그렇게 비었고, 그중
 * 8-26·8-29·8-30 에 막혔던 초안은 9-01·9-02 에 멀쩡히 발행됐다. 결번을 메우려면 날짜를
 * 지목할 수 있어야 한다.
 *
 * 저녁 cron 은 이 인자를 쓰지 않는다. "밀린 초안이 과거 날짜로 나가면 최신순 목록 아래에
 * 묻힌다"는 원래 판단은 자동 경로에서 그대로 유효하고, 사람이 콕 집는 발행에서만 연다.
 */
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { BlogException } from './blog.exception';
import { BlogErrorCode } from './blog-error-code.enum';

const DATE_FLAG_PATTERN = /--date=(\S+)/;
// 초안을 pageId 로 콕 집는다. 제목으로 찾으면 비슷한 제목의 다른 초안이 그 날짜로 나갈 수
// 있는데, 막힌 회차의 pageId 는 원장(`agent_run.input_snapshot`)에 그대로 남아 있어 확실하다.
const PAGE_FLAG_PATTERN = /--page=(\S+)/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;

export interface BlogPublishArgs {
  titleQuery: string;
  publishedAt?: string;
  pageId?: string;
}

// 평범한 Error 로 던지면 Slack 헬퍼(`toUserFacingErrorMessage`)가 DomainException 이 아닌 것을
// "내부 오류가 발생했습니다" 로 뭉개서, 사용자는 날짜 어디가 틀렸는지 볼 수 없다.
const invalidDate = (message: string): BlogException =>
  new BlogException({
    message,
    code: BlogErrorCode.INVALID_PUBLISH_DATE,
    status: DomainStatus.BAD_REQUEST,
  });

const toKstDate = (at: Date): string =>
  new Date(at.getTime() + KST_OFFSET_MILLISECONDS).toISOString().slice(0, 10);

/**
 * `YYYY-MM-DD` 를 그날 KST 기준 타임스탬프로 바꾼다.
 *
 * UTC 자정으로 읽으면 KST 로는 같은 날 09:00 이라 날짜가 밀리지 않는다. 형식만 보고 넘기면
 * 안 되는 이유는 `new Date('2026-02-30')` 이 예외 대신 3월 2일을 돌려주기 때문이다 — 없는
 * 날짜가 조용히 다른 날로 발행된다. 그래서 다시 문자열로 되돌려 입력과 대조한다.
 */
const toPublishedAt = (value: string): string => {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw invalidDate(`발행 날짜는 YYYY-MM-DD 형식이어야 합니다: '${value}'`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidDate(`발행 날짜를 해석하지 못했습니다: '${value}'`);
  }
  if (parsed.toISOString().slice(0, 10) !== value) {
    throw invalidDate(`달력에 없는 날짜입니다: '${value}'`);
  }
  // 앞날 비교는 KST 로 한다. UTC 자정끼리 견주면 한국 시간 자정부터 오전 9시까지는 '오늘'도
  // 미래로 잡혀, 그 시간대에 그날 자리를 채우려는 발행이 이유 없이 거부된다.
  if (value > toKstDate(new Date())) {
    throw invalidDate(`앞날로는 발행할 수 없습니다: '${value}'`);
  }
  return parsed.toISOString();
};

export const parseBlogPublishArgs = (raw: string): BlogPublishArgs => {
  const text = raw.trim();
  const date = DATE_FLAG_PATTERN.exec(text);
  const page = PAGE_FLAG_PATTERN.exec(text);
  const titleQuery = text
    .replace(DATE_FLAG_PATTERN, '')
    .replace(PAGE_FLAG_PATTERN, '')
    .trim();

  return {
    titleQuery,
    ...(date ? { publishedAt: toPublishedAt(date[1]) } : {}),
    ...(page ? { pageId: page[1] } : {}),
  };
};
