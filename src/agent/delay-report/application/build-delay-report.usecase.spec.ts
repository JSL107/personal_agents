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
});
