import { Injectable } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import { GetPaperTradingStatusUsecase } from '../application/get-paper-trading-status.usecase';
import { formatPaperPortfolioStatus } from './paper-trading.formatter';

// 최근 추이용 — 5거래일이면 한 주치 흐름이 보인다.
const SNAPSHOT_LIMIT = 5;

// 자연어 "가상계좌 수익률 어때" → 열려 있는 모든 계좌의 현황 조회 (V3 자연어 진입).
//
// 계좌를 이름으로 지정하지 않는 것이 핵심이다 — PAPER_RECOMMEND 가 전략명(LONG_TERM / SWING)
// 으로 계좌를 열기 때문에, 조회 쪽이 'DEFAULT' 같은 이름을 들고 있으면 전략이 늘어날 때마다
// 실제 투자가 일어나는 계좌를 못 보고 "보유 없음" 만 답하게 된다.
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
    const statuses = await this.getStatus.executeAll({
      snapshotLimit: SNAPSHOT_LIMIT,
    });
    // agentRunId=0 은 "유효 run 없음" sentinel — deterministic 조회는 AgentRun 통계를
    // 오염시키지 않는다 (router 의 setParentId 가드도 0 을 건너뛴다).
    return {
      agentRunId: 0,
      output: statuses,
      modelUsed: 'deterministic',
      formattedText: formatPaperPortfolioStatus(statuses),
    };
  }
}
