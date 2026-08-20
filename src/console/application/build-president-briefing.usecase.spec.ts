import { Test } from '@nestjs/testing';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { PR_REVIEW_FINDING_REPOSITORY_PORT } from '../../pr-review-loop/domain/port/pr-review-finding.repository.port';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import { FindPreviewDayOutcomesUsecase } from '../../preview-gate/application/find-preview-day-outcomes.usecase';
import { ConsoleTodoKind } from '../domain/briefing.type';
import { BuildPresidentBriefingUsecase } from './build-president-briefing.usecase';

const openPreview = (expiresAt: Date): unknown => ({
  id: 'preview-1',
  slackUserId: 'U1',
  kind: 'EVENING_BLOG_PUBLISH',
  payload: {},
  status: 'PENDING',
  previewText: '',
  responseUrl: null,
  expiresAt,
  createdAt: new Date(),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
});

const postedCard = (
  repo: string,
  pullNumber: number,
  createdAt: Date,
): unknown => ({
  id: pullNumber,
  agentRunId: 1,
  repo,
  pullNumber,
  headSha: 'abc',
  category: 'CORRECTNESS',
  severity: 'MUST_FIX',
  filePath: 'a.ts',
  line: 1,
  body: '지적',
  fingerprint: `${repo}#${pullNumber}`,
  status: 'OPEN',
  postMode: 'INLINE',
  githubCommentId: '1',
  githubThreadNodeId: null,
  createdAt,
});

const succeededRun = (id: number, endedAt: string): unknown => ({
  id,
  output: {},
  inputSnapshot: {},
  endedAt: new Date(endedAt),
});

describe('BuildPresidentBriefingUsecase', () => {
  let usecase: BuildPresidentBriefingUsecase;
  let agentRunService: {
    findRecentlyFinishedRuns: jest.Mock;
    countSucceededSince: jest.Mock;
    countFailedSince: jest.Mock;
    findRecentSucceededRuns: jest.Mock;
  };
  let findAllOpenPreviews: { execute: jest.Mock };
  let findPreviewDayOutcomes: { execute: jest.Mock };
  let findingRepository: { findOpenPostedCards: jest.Mock };

  beforeEach(async () => {
    agentRunService = {
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
      countSucceededSince: jest.fn().mockResolvedValue([]),
      countFailedSince: jest.fn().mockResolvedValue(0),
      findRecentSucceededRuns: jest.fn().mockResolvedValue([]),
    };
    findAllOpenPreviews = { execute: jest.fn().mockResolvedValue([]) };
    findPreviewDayOutcomes = { execute: jest.fn().mockResolvedValue([]) };
    findingRepository = {
      findOpenPostedCards: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        BuildPresidentBriefingUsecase,
        { provide: AgentRunService, useValue: agentRunService },
        { provide: FindAllOpenPreviewsUsecase, useValue: findAllOpenPreviews },
        {
          provide: FindPreviewDayOutcomesUsecase,
          useValue: findPreviewDayOutcomes,
        },
        {
          provide: PR_REVIEW_FINDING_REPOSITORY_PORT,
          useValue: findingRepository,
        },
      ],
    }).compile();

    usecase = moduleRef.get(BuildPresidentBriefingUsecase);
  });

  it('밀린 것이 하나도 없으면 보드가 비어 있다', async () => {
    const briefing = await usecase.execute();

    expect(briefing.todos).toEqual([]);
  });

  it('승인은 건수와 무관하게 한 줄이고 가장 먼저 만료되는 시각을 적는다', async () => {
    findAllOpenPreviews.execute.mockResolvedValue([
      openPreview(new Date('2026-08-20T13:00:00Z')),
      openPreview(new Date('2026-08-20T10:04:00Z')),
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos).toHaveLength(1);
    expect(briefing.todos[0].kind).toBe(ConsoleTodoKind.APPROVAL);
    expect(briefing.todos[0].label).toBe('승인 2건');
    // 10:04 UTC = 19:04 KST. 더 늦게 만료되는 카드가 아니라 급한 쪽이 기준이다.
    expect(briefing.todos[0].detail).toBe('19:04 만료');
  });

  it('하루에 여러 번 도는 워커의 실패는 할 일이 아니다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'CODE_REVIEWER', status: 'FAILED', runId: 1 },
    ]);
    // 5분마다 도는 스윕 — 같은 날 여러 번 성공한다. 날짜 간격만 보면 "1일 주기" 라 걸러지지
    // 않는데, 실제로는 몇 분 뒤 다음 회차가 알아서 살린다.
    agentRunService.findRecentSucceededRuns.mockResolvedValue([
      succeededRun(1, '2026-08-19T01:00:00Z'),
      succeededRun(2, '2026-08-19T02:00:00Z'),
      succeededRun(3, '2026-08-19T03:00:00Z'),
      succeededRun(4, '2026-08-18T01:00:00Z'),
      succeededRun(5, '2026-08-18T02:00:00Z'),
      succeededRun(6, '2026-08-18T03:00:00Z'),
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos).toEqual([]);
  });

  it('주기를 알 수 없는 워커는 근거 없이 재촉하지 않는다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PAPER_TRADE', status: 'FAILED', runId: 1 },
    ]);
    // 성공한 날이 하루뿐이면 주기를 잴 수 없다.
    agentRunService.findRecentSucceededRuns.mockResolvedValue([
      succeededRun(1, '2026-08-19T01:00:00Z'),
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos).toEqual([]);
  });

  it('다음 실행이 내일인 워커가 실패하면 할 일로 올린다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'FAILED', runId: 1 },
    ]);
    agentRunService.findRecentSucceededRuns.mockResolvedValue([
      {
        id: 1,
        output: {},
        inputSnapshot: {},
        endedAt: new Date('2026-08-19T00:00:00Z'),
      },
      {
        id: 2,
        output: {},
        inputSnapshot: {},
        endedAt: new Date('2026-08-18T00:00:00Z'),
      },
      {
        id: 3,
        output: {},
        inputSnapshot: {},
        endedAt: new Date('2026-08-17T00:00:00Z'),
      },
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos).toHaveLength(1);
    expect(briefing.todos[0].kind).toBe(ConsoleTodoKind.FAILED_RUN);
    expect(briefing.todos[0].label).toBe('PM 재시도');
  });

  it('성공한 실행이 끝난 워커는 실패 목록에 오르지 않는다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'SUCCEEDED', runId: 2 },
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos).toEqual([]);
    expect(agentRunService.findRecentSucceededRuns).not.toHaveBeenCalled();
  });

  it('미회수 PR 이 한 건이면 번호를, 여러 건이면 묶어 적는다', async () => {
    findingRepository.findOpenPostedCards.mockResolvedValue([
      postedCard('o/r', 1005, new Date('2026-08-19T00:00:00Z')),
    ]);

    const single = await usecase.execute();
    expect(single.todos[0].label).toBe('PR #1005 리뷰 회수');

    findingRepository.findOpenPostedCards.mockResolvedValue([
      postedCard('o/r', 1005, new Date('2026-08-19T00:00:00Z')),
      postedCard('o/r', 994, new Date('2026-08-09T00:00:00Z')),
    ]);

    const many = await usecase.execute();
    expect(many.todos[0].label).toBe('PR 리뷰 회수 2건');
  });

  it('같은 PR 의 지적 여러 건은 한 건으로 묶어 센다', async () => {
    findingRepository.findOpenPostedCards.mockResolvedValue([
      postedCard('o/r', 109, new Date('2026-08-09T00:00:00Z')),
      postedCard('o/r', 109, new Date('2026-08-09T01:00:00Z')),
      postedCard('o/r', 109, new Date('2026-08-09T02:00:00Z')),
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos[0].label).toBe('PR #109 리뷰 회수');
    expect(briefing.dailyReport.pendingReviewPulls).toBe(1);
  });

  it('보드는 승인 → 실패 → 리뷰 순으로 최대 세 줄이다', async () => {
    findAllOpenPreviews.execute.mockResolvedValue([
      openPreview(new Date('2026-08-20T10:04:00Z')),
    ]);
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'FAILED', runId: 1 },
    ]);
    agentRunService.findRecentSucceededRuns.mockResolvedValue([
      {
        id: 1,
        output: {},
        inputSnapshot: {},
        endedAt: new Date('2026-08-19T00:00:00Z'),
      },
      {
        id: 2,
        output: {},
        inputSnapshot: {},
        endedAt: new Date('2026-08-18T00:00:00Z'),
      },
    ]);
    findingRepository.findOpenPostedCards.mockResolvedValue([
      postedCard('o/r', 1005, new Date('2026-08-19T00:00:00Z')),
    ]);

    const briefing = await usecase.execute();

    expect(briefing.todos.map((todo) => todo.kind)).toEqual([
      ConsoleTodoKind.APPROVAL,
      ConsoleTodoKind.FAILED_RUN,
      ConsoleTodoKind.PR_REVIEW,
    ]);
  });

  it('퇴근 정산은 오늘 성공·실패와 승인 처리 현황을 담는다', async () => {
    agentRunService.countSucceededSince.mockResolvedValue([
      { agentType: 'PM', succeeded: 5 },
      { agentType: 'INVEST', succeeded: 8 },
    ]);
    agentRunService.countFailedSince.mockResolvedValue(2);

    const briefing = await usecase.execute();

    expect(briefing.dailyReport.succeeded).toBe(13);
    expect(briefing.dailyReport.failed).toBe(2);
  });

  it('집계 하나가 비어도 나머지는 계산된다', async () => {
    findingRepository.findOpenPostedCards.mockResolvedValue([]);
    agentRunService.countSucceededSince.mockResolvedValue([]);

    const briefing = await usecase.execute();

    expect(briefing.dailyReport.succeeded).toBe(0);
    expect(briefing.streak.current).toBe(0);
    expect(briefing.serverTime).toEqual(expect.any(String));
  });
});
