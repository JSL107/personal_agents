import { summarizeRepoRead } from './repo-read-report';

const WINDOW_START = new Date('2026-11-14T00:00:00Z');
const PREVIOUS_WINDOW_START = new Date('2026-10-31T00:00:00Z');
const CURRENT = new Date('2026-11-20T00:00:00Z');
const PREVIOUS = new Date('2026-11-05T00:00:00Z');
const REPO = 'JSL107/personal_agents';
const OTHER = 'schoolbell-e/sbe-api-v5';

const run = (
  overrides: Partial<Parameters<typeof summarizeRepoRead>[0]['runs'][0]>,
): Parameters<typeof summarizeRepoRead>[0]['runs'][0] => ({
  repo: REPO,
  startedAt: CURRENT,
  durationMs: 60_000,
  status: 'SUCCEEDED',
  ...overrides,
});

const cards = (
  count: number,
  status: string,
  decidedAt: Date | null,
  repo = REPO,
  postMode = 'INLINE',
): Parameters<typeof summarizeRepoRead>[0]['cards'] =>
  Array.from({ length: count }, () => ({
    repo,
    status,
    postMode,
    decidedAt,
    createdAt: decidedAt ?? CURRENT,
  }));

describe('summarizeRepoRead', () => {
  const report = summarizeRepoRead({
    windowStart: WINDOW_START,
    previousWindowStart: PREVIOUS_WINDOW_START,
    runs: [
      run({ repoRead: 'USED', durationMs: 60_000 }),
      run({ repoRead: 'USED', durationMs: 120_000 }),
      run({ repoRead: 'USED', durationMs: 200_000 }),
      run({
        repoRead: 'FELL_BACK',
        repoReadFallbackReason: 'TIMEOUT',
        durationMs: 700_000,
      }),
      // 직전 구간 실행은 현재 구간 사본 지표에 넣지 않는다.
      run({ repoRead: 'USED', durationMs: 999_000, startedAt: PREVIOUS }),
      run({ repo: OTHER, durationMs: 50_000 }),
    ],
    cards: [
      ...cards(15, 'ACKED', CURRENT),
      ...cards(3, 'FIXED', CURRENT, REPO, 'FILE'),
      ...cards(2, 'REJECTED', CURRENT, REPO, 'ISSUE_COMMENT'),
      ...cards(19, 'ACKED', PREVIOUS),
      ...cards(4, 'OPEN', null),
      ...cards(30, 'REJECTED', CURRENT, OTHER),
    ],
  });
  const self = report.find((row) => row.repo === REPO);
  const other = report.find((row) => row.repo === OTHER);

  it('레포마다 한 행을 낸다', () => {
    expect(report.map((row) => row.repo).sort()).toEqual([REPO, OTHER].sort());
  });

  it('현재 구간의 사본 상태와 후퇴 사유를 센다', () => {
    expect(self?.repoReadCounts).toEqual({ USED: 3, FELL_BACK: 1 });
    expect(self?.fallbackReasonCounts).toEqual({ TIMEOUT: 1 });
  });

  it('USED 소요 중앙값과 꼬리를 낸다', () => {
    expect(self?.usedMedianMs).toBe(120_000);
    expect(self?.maxDurationMs).toBe(700_000);
    expect(self?.over600sCount).toBe(1);
  });

  it('결론 난 카드로 구간별 채택률을 내고 표본이 모자라면 비율을 비운다', () => {
    expect(self?.adoption.current).toEqual({
      adopted: 18,
      rejected: 2,
      ratePercent: 90,
    });
    expect(self?.adoption.previous).toEqual({
      adopted: 19,
      rejected: 0,
      ratePercent: null,
    });
  });

  it('구간별로 만든 카드의 게시 방식을 3분류로 센다', () => {
    // 아직 결론이 안 난 OPEN 카드 4장도 현재 구간에 만들어졌으면 센다.
    expect(self?.postModeCounts.current).toEqual({
      INLINE: 19,
      FILE: 3,
      ISSUE_COMMENT: 2,
    });
    // 켜기 전과 비교하려고 직전 구간도 낸다.
    expect(self?.postModeCounts.previous).toEqual({ INLINE: 19 });
  });

  it('다른 레포 행이 섞이지 않는다', () => {
    expect(other?.repoReadCounts).toEqual({});
    expect(other?.usedMedianMs).toBeNull();
    expect(other?.adoption.current.rejected).toBe(30);
  });
});
