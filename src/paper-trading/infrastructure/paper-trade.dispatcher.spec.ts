import { AgentType } from '../../model-router/domain/model-router.type';
import {
  GetPaperTradingStatusUsecase,
  PaperTradingStatusResult,
} from '../application/get-paper-trading-status.usecase';
import { PaperTradeDispatcher } from './paper-trade.dispatcher';

// PAPER_RECOMMEND 가 전략명으로 계좌를 연다 (LONG_TERM / SWING) — 조회는 이름을 몰라야 한다.
const LONG_TERM: PaperTradingStatusResult = {
  account: {
    name: 'LONG_TERM',
    seedAmount: '10000000',
    cashBalance: '3410000',
  },
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

const SWING: PaperTradingStatusResult = {
  account: { name: 'SWING', seedAmount: '10000000', cashBalance: '9000000' },
  positions: [],
  snapshots: [
    { tradeDate: '2026-08-12', totalValue: '9900000', returnRate: '-1' },
  ],
};

const buildDispatcher = (
  executeAll: jest.Mock = jest.fn().mockResolvedValue([LONG_TERM, SWING]),
): { dispatcher: PaperTradeDispatcher; executeAll: jest.Mock } => {
  const getStatus = {
    executeAll,
    execute: jest.fn(),
  } as unknown as GetPaperTradingStatusUsecase;
  return { dispatcher: new PaperTradeDispatcher(getStatus), executeAll };
};

describe('PaperTradeDispatcher', () => {
  it('agentType 이 PAPER_TRADE 다 (router registry 매핑 키)', () => {
    const { dispatcher } = buildDispatcher();

    expect(dispatcher.agentType).toBe(AgentType.PAPER_TRADE);
  });

  it('계좌 이름을 지정하지 않고 열려 있는 전 계좌를 조회한다', async () => {
    const { dispatcher, executeAll } = buildDispatcher();

    const outcome = await dispatcher.dispatch();

    // 이름으로 조회하면 전략 계좌가 늘 때 조용히 빠진다 — executeAll 이어야 한다.
    expect(executeAll).toHaveBeenCalledWith({ snapshotLimit: 5 });
    expect(JSON.stringify(executeAll.mock.calls)).not.toContain('DEFAULT');
    expect(outcome.formattedText).toContain('*가상 계좌 현황 — LONG_TERM*');
    expect(outcome.formattedText).toContain('*가상 계좌 현황 — SWING*');
    expect(outcome.output).toEqual([LONG_TERM, SWING]);
  });

  it('전략별 수익률이 각각 보인다 (합산으로 뭉개지 않음)', async () => {
    const { dispatcher } = buildDispatcher();

    const outcome = await dispatcher.dispatch();

    expect(outcome.formattedText).toContain('수익률 *+1.2%*');
    expect(outcome.formattedText).toContain('수익률 *-1%*');
  });

  it('계좌가 하나도 없어도 실패하지 않고 계좌 부재를 알린다', async () => {
    const { dispatcher } = buildDispatcher(jest.fn().mockResolvedValue([]));

    const outcome = await dispatcher.dispatch();

    expect(outcome.formattedText).toContain('가상 매매 계좌가 아직 없어요');
    expect(outcome.agentRunId).toBe(0);
  });

  it('LLM 을 거치지 않는다 — modelUsed=deterministic, AgentRun 미기록(agentRunId=0)', async () => {
    const { dispatcher } = buildDispatcher();

    const outcome = await dispatcher.dispatch();

    expect(outcome.modelUsed).toBe('deterministic');
    // 0 은 "유효 run 없음" sentinel — router 의 setParentId 가드가 0 을 건너뛴다.
    expect(outcome.agentRunId).toBe(0);
    expect(outcome.followUp).toBeUndefined();
  });

  it('조회가 실패하면 그대로 전파한다 (조용한 빈 응답 금지)', async () => {
    const { dispatcher } = buildDispatcher(
      jest.fn().mockRejectedValue(new Error('DB 연결 실패')),
    );

    await expect(dispatcher.dispatch()).rejects.toThrow('DB 연결 실패');
  });
});
