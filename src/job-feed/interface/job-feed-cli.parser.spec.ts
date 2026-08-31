import { parseJobFeedCliArguments } from './job-feed-cli.parser';

describe('parseJobFeedCliArguments', () => {
  it('--rescore-all 은 reprocess 의 채점 표식 초기화 스위치다', () => {
    expect(
      parseJobFeedCliArguments(['reprocess', '--rescore-all']),
    ).toMatchObject({ command: 'reprocess', rescoreAll: true });
  });

  it('--rescore-all 을 안 주면 표식을 지우지 않는다 — 기본은 종전 동작이다', () => {
    expect(parseJobFeedCliArguments(['reprocess']).rescoreAll).toBe(false);
  });

  it('기본 명령은 collect 다', () => {
    expect(parseJobFeedCliArguments([])).toEqual({
      command: 'collect',
      dryRun: false,
      explain: false,
      maxPages: 3,
      rescoreAll: false,
    });
  });

  it('명령과 플래그를 읽는다', () => {
    expect(
      parseJobFeedCliArguments(['collect', '--dry-run', '--explain']),
    ).toEqual({
      command: 'collect',
      dryRun: true,
      explain: true,
      maxPages: 3,
      rescoreAll: false,
    });
  });

  it('digest 와 reprocess 명령을 받는다', () => {
    expect(parseJobFeedCliArguments(['digest']).command).toBe('digest');
    expect(parseJobFeedCliArguments(['reprocess']).command).toBe('reprocess');
  });

  it('--max-pages 를 정수로 읽는다', () => {
    expect(
      parseJobFeedCliArguments(['collect', '--max-pages=5']).maxPages,
    ).toBe(5);
  });

  it('모르는 명령은 거부한다', () => {
    expect(() => parseJobFeedCliArguments(['deploy'])).toThrow();
  });
});
