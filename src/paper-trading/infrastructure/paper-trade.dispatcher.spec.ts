import { AgentType } from '../../model-router/domain/model-router.type';
import {
  GetPaperTradingStatusUsecase,
  PaperTradingStatusResult,
} from '../application/get-paper-trading-status.usecase';
import { PaperTradeDispatcher } from './paper-trade.dispatcher';

const STATUS: PaperTradingStatusResult = {
  account: { name: 'DEFAULT', seedAmount: '10000000', cashBalance: '3410000' },
  positions: [
    {
      tickerCode: '005930',
      tickerName: '삼성전자',
      quantity: '10',
      avgPrice: '71000',
    },
  ],
  snapshots: [
    { tradeDate: '2026-08-12', totalValue: '10120000', returnRate: '1.2' },
  ],
};

const buildDispatcher = (
  execute: jest.Mock = jest.fn().mockResolvedValue(STATUS),
): { dispatcher: PaperTradeDispatcher; execute: jest.Mock } => {
  const getStatus = { execute } as unknown as GetPaperTradingStatusUsecase;
  return { dispatcher: new PaperTradeDispatcher(getStatus), execute };
};

describe('PaperTradeDispatcher', () => {
  it('agentType 이 PAPER_TRADE 다 (router registry 매핑 키)', () => {
    const { dispatcher } = buildDispatcher();

    expect(dispatcher.agentType).toBe(AgentType.PAPER_TRADE);
  });

  it('DEFAULT 계좌 현황을 조회해 Slack 본문으로 반환한다', async () => {
    const { dispatcher, execute } = buildDispatcher();

    const outcome = await dispatcher.dispatch();

    expect(execute).toHaveBeenCalledWith({
      accountName: 'DEFAULT',
      snapshotLimit: 5,
    });
    expect(outcome.formattedText).toContain('*가상 계좌 현황 — DEFAULT*');
    expect(outcome.formattedText).toContain('수익률 *+1.2%*');
    expect(outcome.output).toBe(STATUS);
  });

  it('LLM 을 거치지 않는다 — modelUsed=deterministic, AgentRun 미기록(agentRunId=0)', async () => {
    const { dispatcher } = buildDispatcher();

    const outcome = await dispatcher.dispatch();

    expect(outcome.modelUsed).toBe('deterministic');
    // 0 은 "유효 run 없음" sentinel — router 의 setParentId 가드가 0 을 건너뛴다.
    expect(outcome.agentRunId).toBe(0);
    expect(outcome.followUp).toBeUndefined();
  });

  it('조회 usecase 가 실패하면 그대로 전파한다 (조용한 빈 응답 금지)', async () => {
    const { dispatcher } = buildDispatcher(
      jest
        .fn()
        .mockRejectedValue(
          new Error('가상 매매 계좌를 찾을 수 없습니다: DEFAULT'),
        ),
    );

    await expect(dispatcher.dispatch()).rejects.toThrow(
      '가상 매매 계좌를 찾을 수 없습니다',
    );
  });
});
