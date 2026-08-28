import { parseJobFeedCliArguments } from './job-feed-cli.parser';

describe('parseJobFeedCliArguments', () => {
  it('기본 명령은 collect 다', () => {
    expect(parseJobFeedCliArguments([])).toEqual({
      command: 'collect',
      dryRun: false,
      explain: false,
      maxPages: 3,
    });
  });

  it('명령과 플래그를 읽는다', () => {
    expect(
      parseJobFeedCliArguments(['collect', '--dry-run', '--explain']),
    ).toEqual({ command: 'collect', dryRun: true, explain: true, maxPages: 3 });
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
