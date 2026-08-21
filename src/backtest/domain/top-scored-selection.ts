import { PaperRecommendation } from '../../agent/paper-recommend/domain/paper-recommendation.type';

export interface RankedStock {
  tickerId: number;
  code: string;
  name: string;
  score: number;
}

export interface HeldPosition {
  code: string;
  // 매수 체결일부터 센 거래일 수.
  holdingTradeDays: number;
}

export interface SelectDeterministicRecommendationInput {
  rankedStocks: RankedStock[];
  heldPositions: HeldPosition[];
  maximumPositions: number;
  holdingTradeDays?: number;
  // 대기 매수 종목. 같은 종목을 또 사지 않도록 후보에서 뺀다.
  pendingBuyCodes?: ReadonlySet<string>;
}

// 실전에서는 codex 가 고르고 판다. 백테스트는 그 자리를 규칙으로 채운다.
// 매수는 점수 상위, 매도는 보유일수 경과 전량 청산이다. 같은 입력이면 항상 같은 출력이어야
// 규칙 A/B 비교의 기준선이 흔들리지 않는다.
export const selectDeterministicRecommendation = (
  input: SelectDeterministicRecommendationInput,
): PaperRecommendation => {
  const { holdingTradeDays } = input;
  const pendingBuyCodes = input.pendingBuyCodes ?? new Set<string>();
  const heldCodes = new Set(
    input.heldPositions.map((position) => position.code),
  );
  const sells =
    holdingTradeDays === undefined
      ? []
      : input.heldPositions
          .filter((position) => position.holdingTradeDays >= holdingTradeDays)
          .map((position) => ({
            code: position.code,
            reason: `보유 ${position.holdingTradeDays}거래일 경과로 청산`,
          }));
  // 청산 예정 종목의 자리는 그날 바로 채운다. 비워 두면 만기 청산 뒤 하루씩 자리가 놀아
  // 성적이 규칙이 아니라 청산 타이밍에 좌우된다.
  const sellCodes = new Set(sells.map((sell) => sell.code));
  // 대기 매수는 자리로 세지 않는다. 연휴 동안 추천이 쌓였다가 개장일에 한꺼번에 체결되는
  // 것은 실전에서도 일어나는 정상 동작이고(실전 추천 크론은 공휴일에도 돌고 보유 종목 수
  // 상한 자체가 없다), 백테스트는 그것을 막는 것이 아니라 성적에 미치는 영향을 측정한다
  // (2026-08-16 백테스트 설계 §7). 여기서 세면 그 현상이 사라져 실전과 다른 것을 재게 된다.
  const openSlots = Math.max(
    0,
    input.maximumPositions - (heldCodes.size - sellCodes.size),
  );
  // 비중은 종목 선정과 분리돼 constrainPaperRecommendation 이 정한다 (재생 루프가 CLI 의
  // --weight 를 maximumWeightPercent 로 넘긴다). 여기서는 무엇을 살지만 고른다.
  const buys = input.rankedStocks
    .filter(
      (stock) => !heldCodes.has(stock.code) && !pendingBuyCodes.has(stock.code),
    )
    .slice(0, openSlots)
    .map((stock) => ({
      code: stock.code,
      reason: `스크리너 점수 ${stock.score}`,
    }));

  return { sells, buys };
};
