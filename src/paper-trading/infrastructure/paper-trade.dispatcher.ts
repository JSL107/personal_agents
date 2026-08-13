import { Injectable } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import { GetPaperTradingStatusUsecase } from '../application/get-paper-trading-status.usecase';
import { formatPaperTradingStatus } from './paper-trading.formatter';

// 계좌는 CLI(scripts/paper-trade.ts)·autopilot 모두 'DEFAULT' 하나만 쓴다.
const DEFAULT_ACCOUNT_NAME = 'DEFAULT';
// 최근 추이용 — 5거래일이면 한 주치 흐름이 보인다.
const SNAPSHOT_LIMIT = 5;

// 자연어 "가상계좌 수익률 어때" → 계좌 현황 조회 (V3 자연어 진입).
//
// 조회 전용 worker 라 LLM 을 거치지 않는다 (VACATION 의 LIST 분기와 같은 deterministic 패턴):
// 추출할 파라미터가 없고, 계좌도 DEFAULT 하나뿐이다. 따라서 codex 쿼터를 쓰지 않고 즉시 응답한다.
//
// 장마감 평가(EvaluatePaperAccountUsecase)를 부르지 않는 것은 의도적이다 — 그쪽은 시세를 새로
// 조회하고 평가 스냅샷을 DB 에 적재하므로, 사용자가 수익률을 물을 때마다 성적표가 오염된다.
// 여기서는 마지막으로 적재된 스냅샷을 읽기만 하고, 기준 날짜를 응답에 함께 노출한다.
@Injectable()
export class PaperTradeDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.PAPER_TRADE;

  constructor(private readonly getStatus: GetPaperTradingStatusUsecase) {}

  // AgentDispatcher.dispatch(input) 의 input 을 쓰지 않는다 — 조회에 입력 파라미터가 없다.
  async dispatch(): Promise<DispatchOutcome> {
    const status = await this.getStatus.execute({
      accountName: DEFAULT_ACCOUNT_NAME,
      snapshotLimit: SNAPSHOT_LIMIT,
    });
    // agentRunId=0 은 "유효 run 없음" sentinel — deterministic 조회는 AgentRun 통계를
    // 오염시키지 않는다 (router 의 setParentId 가드도 0 을 건너뛴다).
    return {
      agentRunId: 0,
      output: status,
      modelUsed: 'deterministic',
      formattedText: formatPaperTradingStatus(status),
    };
  }
}
