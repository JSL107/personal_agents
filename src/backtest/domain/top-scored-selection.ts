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
}

// 실전에서는 codex 가 고르고 판다. 백테스트는 그 자리를 규칙으로 채운다.
// 매수는 점수 상위, 매도는 보유일수 경과 전량 청산이다. 같은 입력이면 항상 같은 출력이어야
// 규칙 A/B 비교의 기준선이 흔들리지 않는다.
export const selectDeterministicRecommendation = (
  input: SelectDeterministicRecommendationInput,
): PaperRecommendation => {
  const { holdingTradeDays } = input;
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
  const openSlots = Math.max(
    0,
    input.maximumPositions - (heldCodes.size - sellCodes.size),
  );
  // 실제 비중은 재생 루프가 CLI 의 --weight 로 덮어쓴다. 여기서는 자리 수로 균등 배분한 값을
  // 기본으로 둬서 이 함수만 따로 써도 합이 100% 를 넘지 않게 한다.
  const weightPercent =
    input.maximumPositions === 0 ? 0 : 100 / input.maximumPositions;
  const buys = input.rankedStocks
    .filter((stock) => !heldCodes.has(stock.code))
    .slice(0, openSlots)
    .map((stock) => ({
      code: stock.code,
      weightPercent,
      reason: `스크리너 점수 ${stock.score}`,
    }));

  return { sells, buys };
};
