import {
  buildPaperRecommendationPrompt,
  buildPaperRecommendSystemPrompt,
} from './paper-recommend-system.prompt';

const indicators = {
  close: 10_000,
  ma5: 9_500,
  ma20: 9_000,
  ma60: 8_500,
  ma120: 8_000,
  isAligned: true,
  volumeSurge: 2,
  return1d: 0,
  return1m: 5,
  return3m: 8,
  return6m: 12,
  high200Position: 0.95,
  volatility20: 15,
  turnover60: 800_000_000,
  highFallbackBarCount: 0,
  barCount: 200,
};

describe('buildPaperRecommendationPrompt', () => {
  it('전략, 보유 종목, 후보와 JSON 출력 제약을 포함한다', () => {
    const prompt = buildPaperRecommendationPrompt({
      strategy: 'LONG_TERM',
      purchasableCash: 7_000_000,
      accountValuation: 10_000_000,
      maximumWeightPercent: 20,
      positions: [
        {
          code: '005930',
          name: '삼성전자',
          sector: '전기전자',
          quantity: 3,
          indicators: null,
        },
      ],
      candidates: [
        {
          code: '000660',
          name: 'SK하이닉스',
          sector: '반도체',
          score: 92.5,
          indicators,
        },
      ],
    });

    expect(prompt).toContain('장기투자');
    expect(prompt).toContain('005930');
    expect(prompt).toContain('000660');
    expect(prompt).toContain('JSON 객체 하나만');
    expect(prompt).toContain('최대 3종');
    expect(prompt).toContain('20%');
    expect(prompt).toContain('재매수 금지');
    expect(prompt).toContain('매수 가능 현금: 7000000');
    expect(prompt).toContain('계좌 평가액: 10000000');
    expect(prompt).toContain(JSON.stringify(indicators));
    expect(prompt).toContain('지표 없음');
    // 업종은 보유·후보 양쪽에 실려야 한다. 한쪽만 실으면 모델이 분산을 판단할 때 나머지
    // 한쪽을 종목명으로 추측하게 된다.
    expect(prompt).toContain('005930 삼성전자 [전기전자]');
    expect(prompt).toContain('000660 SK하이닉스 [반도체]');
  });

  // 비중은 코드가 정한다. 프롬프트에 비중 요구가 남아 있으면 모델이 다시 숫자를 뱉기 시작하고
  // 그 순간 같은 후보에도 회차마다 다른 수량이 나온다.
  it('시스템 프롬프트가 비중 출력을 요구하지 않는다', () => {
    const systemPrompt = buildPaperRecommendSystemPrompt({
      maximumWeightPercent: 20,
    });
    expect(systemPrompt).not.toContain('weightPercent');
    expect(systemPrompt).toContain('비중이나 수량은 출력하지 않는다');
    // 상한을 프롬프트가 따로 적어 두면 제약 코드와 갈린다 — 넘긴 값을 읽어 쓰는지 확인한다.
    expect(systemPrompt).toContain('최대 3종');
    expect(systemPrompt).toContain('종목당 20%');
  });

  // 값이 DB 로 내려간 뒤에도 프롬프트가 상수에 고정돼 있으면, 모델은 20% 인 줄 알고 고르는데
  // 코드는 다른 비중을 배정한다. 두 프롬프트 모두 넘긴 값을 그대로 실어야 한다.
  it('두 프롬프트가 상수가 아니라 넘긴 비중을 싣는다', () => {
    const systemPrompt = buildPaperRecommendSystemPrompt({
      maximumWeightPercent: 12.5,
    });
    expect(systemPrompt).toContain('종목당 12.5%');
    expect(systemPrompt).not.toContain('종목당 20%');

    const userPrompt = buildPaperRecommendationPrompt({
      strategy: 'SWING',
      purchasableCash: 1_000_000,
      accountValuation: 1_000_000,
      maximumWeightPercent: 12.5,
      positions: [],
      candidates: [],
    });
    expect(userPrompt).toContain('종목당 12.5%');
    expect(userPrompt).not.toContain('종목당 20%');
  });

  // 업종을 모르는 종목을 빈 대괄호로 내보내면 모델이 앞뒤 종목의 업종으로 메우거나 이름에서
  // 추측한다. 모른다는 사실 자체가 프롬프트에 적혀야 그 추측이 근거로 올라오지 않는다.
  it('업종이 없는 종목은 미분류로 적는다', () => {
    const prompt = buildPaperRecommendationPrompt({
      strategy: 'SWING',
      purchasableCash: 1_000_000,
      accountValuation: 1_000_000,
      maximumWeightPercent: 20,
      positions: [],
      candidates: [
        {
          code: '900310',
          name: '이름없는종목',
          sector: null,
          score: 50,
          indicators,
        },
      ],
    });

    expect(prompt).toContain('900310 이름없는종목 [미분류]');
    expect(prompt).not.toContain('[]');
  });
});
