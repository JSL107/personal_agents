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
            ordersCreated: 1,
            agentRunId: 31,
            dataAsOf: '2026-08-17',
            orders: [
              {
                side: 'BUY',
                code: '021240',
                name: '코웨이',
                quantity: 20,
                estimatedAmount: 1_950_000,
                reason: '장기 성장',
              },
            ],
            skipped: [],
            account: {
              cashBalance: 4_050_000,
              totalValue: 10_120_000,
              positionCount: 3,
            },
          },
          {
            strategy: 'SWING',
            accountId: 12,
            ordersCreated: 0,
            agentRunId: 32,
            dataAsOf: '2026-08-17',
            orders: [],
            skipped: [],
            account: {
              cashBalance: 9_000,
              totalValue: 9_870_000,
              positionCount: 6,
            },
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
      summaryText:
        '*모의투자 추천* — 장기 1건 · 스윙 0건\n' +
        '*장기* 매수 1 · 매도 0 | 현금 405만 · 보유 3종목 · 평가 1,012만\n' +
        ' • 매수 코웨이(021240) 20주 ≈ 195만\n' +
        '*스윙* 주문 없음 | 현금 9,000원 · 보유 6종목 · 평가 987만\n' +
        ' • 매수·매도 추천 없음',
      detailText:
        '*장기 상세*\n' +
        '계좌: 현금 405만 · 보유 3종목 · 평가 1,012만\n' +
        ' • 매수 코웨이(021240) 20주 ≈ 195만\n' +
        '   판단: 장기 성장\n\n' +
        '*스윙 상세*\n' +
        '계좌: 현금 9,000원 · 보유 6종목 · 평가 987만\n' +
        ' • 매수·매도 추천 없음',
    });
    expect(recommendation.execute).toHaveBeenCalledWith({
      decidedAt: new Date('2026-08-17T19:30:00+09:00'),
      triggerType: TriggerType.AUTOPILOT_PAPER_RECOMMEND_CRON,
    });
  });

  it('전략별 실패와 상세 메시지를 드러낸다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [],
        failed: [
          { strategy: 'LONG_TERM', message: '모델 호출 실패' },
          { strategy: 'SWING', message: '스크리너 실패\nDB timeout' },
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
      summaryText:
        '*모의투자 추천* — 장기 실패 · 스윙 실패\n' +
        '*장기* 실패 — 모델 호출 실패\n' +
        '*스윙* 실패 — 스크리너 실패',
      detailText:
        '*장기 실패 상세*\n모델 호출 실패\n\n' +
        '*스윙 실패 상세*\n스크리너 실패\nDB timeout',
    });
  });

  it('매수 2건을 종목명·코드·수량과 함께 요약한다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'LONG_TERM',
            accountId: 11,
            ordersCreated: 2,
            agentRunId: 31,
            dataAsOf: '2026-08-17',
            orders: [
              {
                side: 'BUY',
                code: '021240',
                name: '코웨이',
                quantity: 20,
                estimatedAmount: 1_950_000,
                reason: '현금흐름 우수',
              },
              {
                side: 'BUY',
                code: '003230',
                name: '삼양식품',
                quantity: 3,
                estimatedAmount: 1_800_000,
                reason: '수출 성장',
              },
            ],
            skipped: [],
            account: {
              cashBalance: 4_050_000,
              totalValue: 10_120_000,
              positionCount: 3,
            },
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(result.summaryText).toContain(' • 매수 코웨이(021240) 20주 ≈ 195만');
    expect(result.summaryText).toContain(
      ' • 매수 삼양식품(003230) 3주 ≈ 180만',
    );
    expect(result.detailText).toContain('판단: 현금흐름 우수');
    expect(result.detailText).toContain('판단: 수출 성장');
  });

  it('주문 0건이면 제외 사유를 한글 라벨로 집계한다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'SWING',
            accountId: 12,
            ordersCreated: 0,
            agentRunId: 32,
            dataAsOf: '2026-08-17',
            orders: [],
            skipped: [
              {
                side: 'BUY',
                code: '000001',
                name: '첫째',
                reason: 'INSUFFICIENT_CASH',
              },
              {
                side: 'BUY',
                code: '000002',
                name: '둘째',
                reason: 'INSUFFICIENT_CASH',
              },
              {
                side: 'BUY',
                code: '000003',
                name: '셋째',
                reason: 'ALREADY_HELD',
              },
            ],
            account: {
              cashBalance: 250_000,
              totalValue: 9_870_000,
              positionCount: 6,
            },
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(result.summaryText).toContain(
      ' • 제외 3건 — 현금 부족 2, 보유 중·중복 1',
    );
    expect(result.detailText).toContain(
      ' • 제외 매수 첫째(000001) — 현금 부족',
    );
  });

  it('주문과 제외가 모두 0건이면 추천 없음으로 구분한다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'LONG_TERM',
            accountId: 11,
            ordersCreated: 0,
            agentRunId: 31,
            dataAsOf: '2026-08-17',
            orders: [],
            skipped: [],
            account: {
              cashBalance: 10_000_000,
              totalValue: 10_000_000,
              positionCount: 0,
            },
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(result.summaryText).toContain(' • 매수·매도 추천 없음');
    expect(result.detailText).toContain(' • 매수·매도 추천 없음');
  });
  it('시세 데이터가 없어 주문을 만들지 못한 회차를 추천 없음과 구분한다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'LONG_TERM',
            accountId: 11,
            ordersCreated: 0,
            agentRunId: 31,
            dataAsOf: null,
            orders: [],
            skipped: [],
            account: {
              cashBalance: 4_050_000,
              totalValue: 10_120_000,
              positionCount: 3,
            },
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(result.summaryText).toContain(
      ' • 시세 데이터 없음 — 주문 생성 안 됨',
    );
    expect(result.summaryText).not.toContain('매수·매도 추천 없음');
  });
  it('평가 스냅샷이 있으면 계좌 수익률을 함께 보여준다', async () => {
    const recommendation = {
      execute: jest.fn().mockResolvedValue({
        completed: [
          {
            strategy: 'SWING',
            accountId: 12,
            ordersCreated: 0,
            agentRunId: 32,
            dataAsOf: '2026-08-17',
            orders: [],
            skipped: [],
            account: {
              cashBalance: 254_202,
              totalValue: 10_208_337,
              positionCount: 6,
              returnRate: 2.0834,
            },
          },
        ],
        failed: [],
      }),
    };
    const task = new PaperRecommendAutopilotTask(
      recommendation as unknown as GeneratePaperRecommendationUsecase,
    );

    const result = await task.run({
      ownerSlackUserId: 'U1',
      firedAtKst: '2026-08-17',
    });

    expect(result.summaryText).toContain(
      '현금 25만 · 보유 6종목 · 평가 1,021만(+2.08%)',
    );
  });
});
