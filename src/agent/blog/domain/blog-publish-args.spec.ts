import { BlogException } from './blog.exception';
import { parseBlogPublishArgs } from './blog-publish-args';

describe('parseBlogPublishArgs', () => {
  it('날짜 인자가 없으면 입력 전체를 제목 검색어로 쓴다', () => {
    expect(parseBlogPublishArgs('  nginx 리버스 프록시  ')).toEqual({
      titleQuery: 'nginx 리버스 프록시',
    });
  });

  it('날짜 인자를 떼어 내고 남은 말을 제목 검색어로 쓴다', () => {
    expect(parseBlogPublishArgs('nginx --date=2026-09-07')).toEqual({
      titleQuery: 'nginx',
      publishedAt: '2026-09-07T00:00:00.000Z',
    });
  });

  it('날짜만 주면 제목 검색어는 비운다 — 큐 순번대로 골라 그날 자리에 넣는다', () => {
    expect(parseBlogPublishArgs('--date=2026-09-04')).toEqual({
      titleQuery: '',
      publishedAt: '2026-09-04T00:00:00.000Z',
    });
  });

  it('pageId 로 초안을 콕 집는다 — 비슷한 제목이 그 날짜로 새어 나가지 않게', () => {
    expect(
      parseBlogPublishArgs(
        '--page=3ce69cbb-a394-81f1-a36b-c3ec7f8fa2fb --date=2026-09-04',
      ),
    ).toEqual({
      titleQuery: '',
      pageId: '3ce69cbb-a394-81f1-a36b-c3ec7f8fa2fb',
      publishedAt: '2026-09-04T00:00:00.000Z',
    });
  });

  it('UTC 자정으로 읽어 KST 로도 같은 날짜가 되게 한다', () => {
    const parsed = parseBlogPublishArgs('--date=2026-09-07');
    const kstDate = new Date(
      new Date(parsed.publishedAt as string).getTime() + 9 * 60 * 60 * 1_000,
    );

    expect(kstDate.toISOString().slice(0, 10)).toBe('2026-09-07');
  });

  it('달력에 없는 날짜를 거부한다 — Date 가 조용히 다음 달로 굴린다', () => {
    expect(() => parseBlogPublishArgs('--date=2026-02-30')).toThrow(
      '달력에 없는 날짜입니다',
    );
  });

  it('날짜 오류를 도메인 예외로 던진다 — 평범한 Error 는 Slack 에서 사유가 지워진다', () => {
    expect(() => parseBlogPublishArgs('--date=2026-02-30')).toThrow(
      BlogException,
    );
  });

  it('형식이 어긋난 날짜를 거부한다', () => {
    expect(() => parseBlogPublishArgs('--date=2026/09/07')).toThrow(
      'YYYY-MM-DD',
    );
  });

  it('한국 시간으로 자정을 막 넘긴 새벽에도 그날 자리를 채울 수 있다', () => {
    // KST 2026-09-08 00:30 = UTC 2026-09-07 15:30. UTC 끼리 견주면 '오늘'이 미래로 잡힌다.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T15:30:00.000Z'));

    expect(parseBlogPublishArgs('--date=2026-09-08')).toEqual({
      titleQuery: '',
      publishedAt: '2026-09-08T00:00:00.000Z',
    });

    jest.useRealTimers();
  });

  it('앞날로는 발행하지 못하게 막는다', () => {
    // 시계를 고정한다. 실행 시각의 UTC 로 '내일'을 만들면 KST 기준인 구현과 어긋나,
    // 한국 시간 00:00~08:59 에는 그 '내일'이 KST 오늘과 같은 날이 되어 통과해 버린다.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-08T06:00:00.000Z'));

    expect(() => parseBlogPublishArgs('--date=2026-09-09')).toThrow(
      '앞날로는 발행할 수 없습니다',
    );

    jest.useRealTimers();
  });

  it('한국 시간 새벽에도 내일은 여전히 막는다', () => {
    // KST 2026-09-08 00:30. 위 경계 테스트의 반대편 — 새벽이라고 앞날이 열리면 안 된다.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-07T15:30:00.000Z'));

    expect(() => parseBlogPublishArgs('--date=2026-09-09')).toThrow(
      '앞날로는 발행할 수 없습니다',
    );

    jest.useRealTimers();
  });
});
