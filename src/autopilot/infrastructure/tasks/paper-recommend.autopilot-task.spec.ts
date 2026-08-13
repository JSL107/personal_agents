import { GeneratePaperRecommendationUsecase } from '../../../agent/paper-recommend/application/generate-paper-recommendation.usecase';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { PaperRecommendAutopilotTask } from './paper-recommend.autopilot-task';

describe('PaperRecommendAutopilotTask', () => {
  it('스케줄 날짜의 19:30 KST 판단 시각과 autopilot trigger로 추천 usecase를 실행한다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'LONG_TERM',
            accountId: 11,
            ordersCreated: 2,
            agentRunId: 31,
          },
          {
            strategy: 'SWING',
            accountId: 12,
            ordersCreated: 1,
            agentRunId: 32,
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    await expect(
      task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-17' }),
    ).resolves.toEqual({
      skip: false,
      summaryText: '모의투자 추천 완료 — 계좌 2개, 주문 3건, 실패 0개',
    });
    expect(recommendation.execute).toHaveBeenCalledWith({
      decidedAt: new Date('2026-08-17T19:30:00+09:00'),
      triggerType: TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
    });
  });

  it('전략별 실패 건수를 완료 요약에 드러낸다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [],
        failed: [
          { strategy: 'LONG_TERM', message: '모델 호출 실패' },
          { strategy: 'SWING', message: '스크리너 실패' },
        ],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    await expect(
      task.run({ ownerSlackUserId: 'U1', firedAtKst: '2026-08-17' }),
    ).resolves.toEqual({
      skip: false,
      summaryText: '모의투자 추천 완료 — 계좌 0개, 주문 0건, 실패 2개',
      detailText:
        '추천 실패 상세\n- LONG_TERM: 모델 호출 실패\n- SWING: 스크리너 실패',
    });
  });
});
