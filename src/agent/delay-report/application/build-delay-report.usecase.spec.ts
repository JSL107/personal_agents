import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { BuildDelayReportUsecase } from './build-delay-report.usecase';

describe('BuildDelayReportUsecase', () => {
  it('조회 하나가 실패해도 다른 축으로 보고를 완성하고 남의 카드를 제외한다', async () => {
    const agentRunService = {
      findActiveRuns: jest
        .fn()
        .mockRejectedValue(new Error('active unavailable')),
      findFailedRunsSince: jest.fn().mockResolvedValue([]),
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
    } as unknown as AgentRunService;
    const findAllOpenPreviews = {
      execute: jest.fn().mockResolvedValue([
        {
          slackUserId: 'U1',
          status: 'PENDING',
          expiresAt: new Date('2026-09-05'),
          createdAt: new Date('2026-09-04T02:00:00Z'),
          previewText: '내 카드',
        },
        {
          slackUserId: 'U2',
          status: 'PENDING',
          expiresAt: new Date('2026-09-05'),
          createdAt: new Date('2026-09-04T01:00:00Z'),
          previewText: '남의 카드',
        },
      ]),
    } as unknown as FindAllOpenPreviewsUsecase;
    const configService = {
      get: jest.fn().mockReturnValue('configured'),
    } as unknown as ConfigService;
    const usecase = new BuildDelayReportUsecase(
      agentRunService,
      findAllOpenPreviews,
      configService,
    );

    const verdict = await usecase.execute({
      slackUserId: 'U1',
      now: new Date('2026-09-04T03:00:00Z'),
    });

    expect(verdict.primaryCause).toBe('APPROVAL_WAIT');
    expect(verdict.detail).toContain('내 카드');
    expect(verdict.detail).not.toContain('남의 카드');
  });

  it('조회 축 실패를 확인 불가 축으로 전달하고 warn으로 기록한다', async () => {
    const agentRunService = {
      findActiveRuns: jest.fn().mockRejectedValue(new Error('DB unavailable')),
      findFailedRunsSince: jest.fn().mockResolvedValue([]),
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
    } as unknown as AgentRunService;
    const findAllOpenPreviews = {
      execute: jest.fn().mockRejectedValue(new Error('preview DB unavailable')),
    } as unknown as FindAllOpenPreviewsUsecase;
    const configService = {
      get: jest.fn().mockReturnValue('configured'),
    } as unknown as ConfigService;
    const usecase = new BuildDelayReportUsecase(
      agentRunService,
      findAllOpenPreviews,
      configService,
    );
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const verdict = await usecase.execute({
      slackUserId: 'U1',
      now: new Date('2026-09-04T03:00:00Z'),
    });

    expect(verdict.primaryCause).toBe('NONE');
    expect(verdict.unavailableAxes).toEqual(['진행 중 작업', '승인 대기 카드']);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      'DELAY_REPORT 조회 실패 — 진행 중 작업: DB unavailable',
    );
    warn.mockRestore();
  });

  it('지연 보고 자신의 진행 중 run 은 지연 원인으로 세지 않는다', async () => {
    const now = new Date('2026-09-04T03:00:00Z');
    const agentRunService = {
      findActiveRuns: jest.fn().mockResolvedValue([
        {
          id: 9,
          agentType: 'DELAY_REPORT',
          status: 'IN_PROGRESS',
          parentId: null,
          startedAt: now,
          endedAt: null,
          triggerType: 'SLACK_MENTION_DELAY_REPORT',
          inputSnapshot: null,
        },
      ]),
      findFailedRunsSince: jest.fn().mockResolvedValue([]),
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
    } as unknown as AgentRunService;
    const usecase = new BuildDelayReportUsecase(
      agentRunService,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as FindAllOpenPreviewsUsecase,
      { get: jest.fn() } as unknown as ConfigService,
    );

    const verdict = await usecase.execute({ slackUserId: 'U1', now });

    expect(verdict.primaryCause).not.toBe('RUN_IN_PROGRESS');
  });

  // 지난 지연 보고 회차의 실패·성공도 원장에 있다 — 그것이 다음 보고의 원인이 되면 안 된다.
  // 대조군: 같은 입력에 다른 워커의 미해소 실패가 있으면 그것은 여전히 원인이다.
  it.each([
    ['지연 보고 자신의 지난 실패만 있으면', [], 'NONE'],
    [
      '다른 워커 실패가 함께 있으면',
      [
        {
          agentType: 'PM',
          reason: '타임아웃',
          endedAt: new Date('2026-09-04T02:40:00Z'),
        },
      ],
      'UNRESOLVED_FAILURE',
    ],
  ])('%s 원인은 %s 이다', async (_label, otherFailures, expected) => {
    const ownFailure = {
      agentType: 'DELAY_REPORT',
      reason: '조회 실패',
      endedAt: new Date('2026-09-04T02:50:00Z'),
    };
    const agentRunService = {
      findActiveRuns: jest.fn().mockResolvedValue([]),
      findFailedRunsSince: jest
        .fn()
        .mockResolvedValue([ownFailure, ...otherFailures]),
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([
        { agentType: 'DELAY_REPORT', status: 'FAILED', runId: 11 },
        ...otherFailures.map(() => ({
          agentType: 'PM',
          status: 'FAILED',
          runId: 12,
        })),
      ]),
    } as unknown as AgentRunService;
    const usecase = new BuildDelayReportUsecase(
      agentRunService,
      {
        execute: jest.fn().mockResolvedValue([]),
      } as unknown as FindAllOpenPreviewsUsecase,
      { get: jest.fn() } as unknown as ConfigService,
    );

    const verdict = await usecase.execute({
      slackUserId: 'U1',
      now: new Date('2026-09-04T03:00:00Z'),
    });

    expect(verdict.primaryCause).toBe(expected);
    expect(verdict.detail).not.toContain('DELAY_REPORT');
  });
});
