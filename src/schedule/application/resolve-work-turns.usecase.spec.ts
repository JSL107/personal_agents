import { AuthorPullRequestSignals } from '../../github/domain/author-pr-signals.type';
import { GithubClientPort } from '../../github/domain/port/github-client.port';
import { ScheduleRepositoryPort } from '../domain/port/schedule.repository.port';
import { ScheduleSource } from '../domain/schedule.type';
import { buildScheduleItemRecord } from '../domain/schedule-item.fixture';
import { ResolveWorkTurnsUsecase } from './resolve-work-turns.usecase';

const url = (number: number): string => `https://github.com/a/b/pull/${number}`;
const signal = (
  number: number,
  overrides: Partial<AuthorPullRequestSignals> = {},
): AuthorPullRequestSignals => ({
  ref: { repo: 'a/b', number },
  open: true,
  draft: false,
  mergeableState: 'clean',
  isApproved: false,
  pendingReviewers: [],
  changesRequestedBy: [],
  observed: true,
  ...overrides,
});
const now = new Date('2026-11-04T03:00:00Z');

describe('ResolveWorkTurnsUsecase', () => {
  const repository = { findOpenLinkedPullRequestUrls: jest.fn() };
  const github = {
    fetchAuthorPullRequestSignals: jest.fn(),
    fetchReviewWaits: jest.fn(),
  };
  const usecase = new ResolveWorkTurnsUsecase(
    repository as unknown as ScheduleRepositoryPort,
    github as unknown as GithubClientPort,
  );
  beforeEach(() => {
    jest.resetAllMocks();
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(new Map());
    github.fetchAuthorPullRequestSignals.mockResolvedValue([]);
    github.fetchReviewWaits.mockResolvedValue([]);
  });
  it('연결 PR 이 없는 업무는 UNKNOWN observed=true', async () => {
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'UNKNOWN',
      reason: null,
      observed: true,
      wait: null,
    });
  });
  it('연결 PR 중 하나라도 MY_TURN 이면 MY_TURN', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { pendingReviewers: ['a'] }),
      signal(2, { draft: true }),
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'MY_TURN',
      reason: '드래프트',
      observed: true,
      wait: null,
    });
  });
  it('연결 PR 하나가 미관측이어도 관측된 MY_TURN 이 우선한다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { observed: false }),
      signal(2, { draft: true }),
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'MY_TURN',
      reason: '드래프트',
      observed: true,
      wait: null,
    });
  });
  it('닫힌 연결 PR은 빼고 열린 PR만 판정한다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { draft: true, open: false }),
      signal(2, { pendingReviewers: ['alice'] }),
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)?.turn).toBe('WAITING_OTHERS');
  });
  it('연결 PR이 모두 닫혔으면 관측된 UNKNOWN이다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { open: false }),
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'UNKNOWN',
      reason: null,
      observed: true,
      wait: null,
    });
  });
  it('연결 PR 이 모두 WAITING 이면 WAITING', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { pendingReviewers: ['a'] }),
      signal(2, { pendingReviewers: ['b'] }),
    ]);
    github.fetchReviewWaits.mockResolvedValue([
      {
        ref: { repo: 'a/b', number: 1 },
        waits: [{ reviewer: 'a', requestedAt: '2026-11-01T00:00:00Z' }],
        complete: true,
      },
      { ref: { repo: 'a/b', number: 2 }, waits: [], complete: true },
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'WAITING_OTHERS',
      reason: '리뷰 대기',
      observed: true,
      wait: { label: '리뷰 요청 후 4일째 답 없음', days: 4 },
    });
  });
  it('모든 신호 조회가 실패하면 예외 없이 미관측 UNKNOWN', async () => {
    github.fetchAuthorPullRequestSignals.mockRejectedValue(
      new Error('failure'),
    );
    const result = await usecase.execute({
      items: [
        buildScheduleItemRecord({
          source: ScheduleSource.GITHUB_PR,
          sourceKey: url(1),
        }),
      ],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'UNKNOWN',
      reason: null,
      observed: false,
      wait: null,
    });
  });
  it('WAITING 인 PR 에만 현재 pendingReviewers 를 전달한다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { pendingReviewers: ['alice'] }),
      signal(2, { draft: true }),
    ]);
    await usecase.execute({ items: [buildScheduleItemRecord()], now });
    expect(github.fetchReviewWaits).toHaveBeenCalledWith([
      { ref: { repo: 'a/b', number: 1 }, pendingReviewers: ['alice'] },
    ]);
  });
  it('PR 업무는 연결 목록 대신 자신의 sourceKey 를 사용한다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { draft: true }),
    ]);
    const result = await usecase.execute({
      items: [
        buildScheduleItemRecord({
          source: ScheduleSource.GITHUB_PR,
          sourceKey: url(1),
        }),
      ],
      now,
    });
    expect(github.fetchAuthorPullRequestSignals).toHaveBeenCalledWith([
      { repo: 'a/b', number: 1 },
    ]);
    expect(result.get(1)?.turn).toBe('MY_TURN');
  });
  it('관측된 UNKNOWN 과 WAITING 이 섞이면 UNKNOWN 이다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockResolvedValue(
      new Map([[1, [url(1), url(2)]]]),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1),
      signal(2, { pendingReviewers: ['a'] }),
    ]);
    const result = await usecase.execute({
      items: [buildScheduleItemRecord()],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'UNKNOWN',
      reason: null,
      observed: true,
      wait: null,
    });
  });
  it('대기 이력 조회 예외여도 남 기다림은 유지하고 기간만 뺀다', async () => {
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { pendingReviewers: ['a'] }),
    ]);
    github.fetchReviewWaits.mockRejectedValue(new Error('failure'));
    const result = await usecase.execute({
      items: [
        buildScheduleItemRecord({
          source: ScheduleSource.GITHUB_PR,
          sourceKey: url(1),
        }),
      ],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'WAITING_OTHERS',
      reason: '리뷰 대기',
      observed: true,
      wait: { label: '리뷰 대기', days: null },
    });
  });
  it('연결 조회 실패는 자체 PR 판정을 막지 않는다', async () => {
    repository.findOpenLinkedPullRequestUrls.mockRejectedValue(
      new Error('database'),
    );
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { draft: true }),
    ]);
    const result = await usecase.execute({
      items: [
        buildScheduleItemRecord({
          id: 1,
          source: ScheduleSource.GITHUB_PR,
          sourceKey: url(1),
        }),
        buildScheduleItemRecord({ id: 2 }),
      ],
      now,
    });
    expect(result.get(1)?.turn).toBe('MY_TURN');
    expect(result.get(2)).toEqual({
      turn: 'UNKNOWN',
      reason: null,
      observed: false,
      wait: null,
    });
  });
  // 차례는 신호만으로 정해진다. 기다린 기간(타임라인)을 못 읽어도 남 기다림은 그대로이고 기간만 뺀다(spec §5).
  it('리뷰 이력을 못 읽으면 남 기다림은 유지하고 기간만 뺀다', async () => {
    github.fetchAuthorPullRequestSignals.mockResolvedValue([
      signal(1, { pendingReviewers: ['a'] }),
    ]);
    github.fetchReviewWaits.mockResolvedValue([
      { ref: { repo: 'a/b', number: 1 }, waits: [], complete: false },
    ]);
    const result = await usecase.execute({
      items: [
        buildScheduleItemRecord({
          source: ScheduleSource.GITHUB_PR,
          sourceKey: url(1),
        }),
      ],
      now,
    });
    expect(result.get(1)).toEqual({
      turn: 'WAITING_OTHERS',
      reason: '리뷰 대기',
      observed: true,
      wait: { label: '리뷰 대기', days: null },
    });
  });
});
