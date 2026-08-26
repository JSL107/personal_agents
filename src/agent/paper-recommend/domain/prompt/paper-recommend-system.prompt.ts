import { MAXIMUM_BUY_COUNT } from '../paper-recommendation.constraint';
import {
  BuildPaperRecommendationPromptInput,
  PaperRecommendationStrategy,
} from '../paper-recommendation.type';

export interface BuildPaperRecommendSystemPromptInput {
  // 이 회차에 실제로 배정될 종목당 비중. 상수를 그대로 박으면 값이 DB 로 내려간 뒤에도
  // 프로세스가 뜰 때의 값에 고정돼, 모델은 20% 인 줄 알고 고르는데 코드는 다른 비중을
  // 배정하는 상태가 조용히 생긴다.
  maximumWeightPercent: number;
}

export const buildPaperRecommendSystemPrompt = ({
  maximumWeightPercent,
}: BuildPaperRecommendSystemPromptInput): string =>
  `너는 한국 주식 모의투자 추천 담당자다.

LONG_TERM은 중장기 추세와 안정성을, SWING은 단기 모멘텀과 거래량 변화를 우선한다.
사용자 prompt의 보유 종목은 매도 여부를 판단하고, 후보 종목 안에서만 신규 매수를 추천한다.

반드시 아래 JSON 객체 하나만 출력한다. 코드 fence와 설명은 출력하지 않는다.
{
  "sells": [{ "code": "005930", "reason": "매도 근거" }],
  "buys": [{ "code": "000660", "reason": "매수 근거" }]
}

규칙:
- buys는 최대 ${MAXIMUM_BUY_COUNT}종이다.
- 비중과 수량은 시스템이 정한다. 종목당 ${maximumWeightPercent}%가 배정되므로 비중이나 수량은 출력하지 않는다.
- 보유 중인 종목은 재매수하지 않는다.
- sells에는 보유 중인 종목만 넣는다.`;

export const buildPaperRecommendationPrompt = (
  input: BuildPaperRecommendationPromptInput,
): string => {
  const strategyLabel = strategyLabelOf(input.strategy);
  const positions =
    input.positions.length === 0
      ? '없음'
      : input.positions
          .map(
            (position) =>
              `${position.code} ${position.name} (${position.quantity}주 보유)\n` +
              `지표: ${position.indicators === null ? '지표 없음' : JSON.stringify(position.indicators)}`,
          )
          .join('\n');
  const candidates =
    input.candidates.length === 0
      ? '없음'
      : input.candidates
          .map(
            (candidate) =>
              `${candidate.code} ${candidate.name} (screen score ${candidate.score})\n지표: ${JSON.stringify(candidate.indicators)}`,
          )
          .join('\n');

  return `전략: ${strategyLabel}
현금 잔액: ${input.cashBalance}
계좌 평가액: ${input.accountValuation}

[보유 종목]
${positions}

[신규 후보]
${candidates}

후보와 보유 종목을 함께 검토해 매도와 매수를 판단하라. JSON 객체 하나만 출력하라. 매수는 최대 ${MAXIMUM_BUY_COUNT}종이고 종목당 ${input.maximumWeightPercent}%가 시스템에서 배정되며 보유 종목 재매수 금지다.`;
};

const strategyLabelOf = (strategy: PaperRecommendationStrategy): string =>
  strategy === 'LONG_TERM' ? '장기투자' : '단기매매';
