import { buildPaperRecommendationPrompt } from '../../agent/paper-recommend/domain/prompt/paper-recommend-system.prompt';
import { StockIndicators } from '../../market-data/domain/stock-indicator';
import {
  amountWeightedAgreement,
  blockBootstrapInterval,
  decideSelectionVerdict,
  executeBuys,
  hasBuyingHeadroom,
  Interval,
  isoWeekKey,
  modalFrequency,
  pairwiseAgreement,
  parseRecommendationPrompt,
  RecommendationPromptInputs,
  ruleAgreement,
} from './selection-consistency';

const indicatorsOf = (close: number): StockIndicators =>
  ({ close, ma5: close, isAligned: true }) as unknown as StockIndicators;

describe('selection-consistency', () => {
  describe('parseRecommendationPrompt', () => {
    it('운영 프롬프트 빌더가 만든 문자열에서 현금·보유·후보·종가를 되살린다', () => {
      const prompt =
        buildPaperRecommendationPrompt({
          strategy: 'SWING',
          purchasableCash: 4_973_723,
          accountValuation: 8_086_033,
          maximumWeightPercent: 20,
          positions: [
            {
              code: '020560',
              name: '아시아나항공',
              sector: '항공 여객 운송업',
              quantity: 193,
              indicators: indicatorsOf(8400),
            },
          ],
          candidates: [
            {
              code: '159010',
              name: '아스플로',
              sector: '그외 기타 전문, 과학 및 기술 서비스업',
              score: 90.21,
              indicators: indicatorsOf(29_400),
            },
            {
              code: '0001A0',
              name: '덕양에너젠',
              sector: null,
              score: 88.1,
              indicators: indicatorsOf(12_000),
            },
          ],
        }) + '\n\n[지난 성적]\n누적 수익률 -3%';

      expect(parseRecommendationPrompt(prompt)).toEqual({
        purchasableCash: 4_973_723,
        accountValuation: 8_086_033,
        positions: [{ code: '020560', quantity: 193 }],
        candidates: [
          { code: '159010', name: '아스플로', score: 90.21, close: 29_400 },
          { code: '0001A0', name: '덕양에너젠', score: 88.1, close: 12_000 },
        ],
      });
    });

    it('2026-08-28 까지의 형식(업종 없음·현금 잔액)도 읽는다', () => {
      const prompt = [
        '전략: 장기투자',
        '현금 잔액: 10000000',
        '계좌 평가액: 10000000',
        '',
        '[보유 종목]',
        '없음',
        '',
        '[신규 후보]',
        '121440 골프존홀딩스 (screen score 78.33)',
        '지표: {"close":6810}',
        '',
        '후보와 보유 종목을 함께 검토해 매도와 매수를 판단하라.',
      ].join('\n');

      expect(parseRecommendationPrompt(prompt)).toEqual({
        purchasableCash: 10_000_000,
        accountValuation: 10_000_000,
        positions: [],
        candidates: [
          { code: '121440', name: '골프존홀딩스', score: 78.33, close: 6810 },
        ],
      });
    });

    it('알 수 없는 후보 줄은 건너뛰지 않고 던진다', () => {
      const prompt = [
        '매수 가능 현금: 1',
        '계좌 평가액: 1',
        '[신규 후보]',
        '121440 골프존홀딩스 score=78',
      ].join('\n');

      expect(() => parseRecommendationPrompt(prompt)).toThrow('형식');
    });

    it('현금 줄이 없으면 지어내지 않고 던진다', () => {
      expect(() => parseRecommendationPrompt('계좌 평가액: 100')).toThrow(
        '매수 가능 현금',
      );
    });
  });

  const inputs: RecommendationPromptInputs = {
    purchasableCash: 2_500_000,
    accountValuation: 10_000_000,
    positions: [{ code: 'HELD', quantity: 10 }],
    candidates: [
      { code: 'HELD', name: '보유', score: 99, close: 1000 },
      { code: 'A', name: 'A', score: 90, close: 100_000 },
      { code: 'B', name: 'B', score: 80, close: 100_000 },
      { code: 'C', name: 'C', score: 80, close: 100_000 },
      { code: 'D', name: 'D', score: 70, close: 100_000 },
    ],
  };

  describe('executeBuys', () => {
    it('모델이 낸 순서대로 현금을 써서 [A,B] 와 [B,A] 가 다른 주문이 된다', () => {
      const buy = (code: string) => ({ code, reason: '' });
      const ab = executeBuys({
        recommendation: { sells: [], buys: [buy('A'), buy('B')] },
        inputs,
      });
      const ba = executeBuys({
        recommendation: { sells: [], buys: [buy('B'), buy('A')] },
        inputs,
      });

      // 평가액 20% = 2백만 → 첫 종목 20주, 남은 50만으로 두 번째 5주.
      expect(ab).toEqual([
        { code: 'A', amount: 2_000_000 },
        { code: 'B', amount: 500_000 },
      ]);
      expect(ba).toEqual([
        { code: 'B', amount: 2_000_000 },
        { code: 'A', amount: 500_000 },
      ]);
      // 종목 집합이 같아도 배정액이 다르면 완전일치가 아니다.
      expect(pairwiseAgreement([ab, ba])).toBe(0);
      expect(pairwiseAgreement([ab, ab])).toBe(1);
      expect(amountWeightedAgreement(ab, ba)).toBeCloseTo(
        1_000_000 / 4_000_000,
      );
    });
  });

  describe('pairwiseAgreement', () => {
    const a = [{ code: 'A', amount: 1 }];
    const b = [{ code: 'B', amount: 1 }];

    it('모든 쌍 중 같은 체결 집합의 비율을 낸다', () => {
      expect(pairwiseAgreement([a, a, b])).toBeCloseTo(1 / 3);
      expect(pairwiseAgreement([[], []])).toBe(1);
    });

    it('파싱 실패는 주지표에서 빼고, 민감도에서는 하나의 답으로 센다', () => {
      expect(pairwiseAgreement([a, null, null])).toBeNull();
      expect(
        pairwiseAgreement([a, null, null], { failureAsAnswer: true }),
      ).toBeCloseTo(1 / 3);
    });

    it('최빈 답 빈도를 낸다', () => {
      expect(modalFrequency([a, a, b, null])).toBeCloseTo(2 / 3);
      expect(modalFrequency([null])).toBeNull();
    });
  });

  describe('ruleAgreement', () => {
    it('보유 종목을 뺀 점수 상위 k 에 드는 비율을 내고 경계 동점은 일치로 센다', () => {
      expect(ruleAgreement([{ code: 'A', amount: 1 }], inputs)).toBe(1);
      // k=2 경계 점수 80 — B·C 동점이라 C 를 골라도 일치.
      expect(
        ruleAgreement(
          [
            { code: 'A', amount: 1 },
            { code: 'C', amount: 1 },
          ],
          inputs,
        ),
      ).toBe(1);
      expect(
        ruleAgreement(
          [
            { code: 'D', amount: 1 },
            { code: 'A', amount: 1 },
          ],
          inputs,
        ),
      ).toBe(0.5);
    });

    it('모델이 기권하면 null', () => {
      expect(ruleAgreement([], inputs)).toBeNull();
    });
  });

  it('매수 여력은 평가액의 18% 기준이다', () => {
    expect(hasBuyingHeadroom(inputs)).toBe(true);
    expect(hasBuyingHeadroom({ ...inputs, purchasableCash: 1_700_000 })).toBe(
      false,
    );
  });

  describe('blockBootstrapInterval', () => {
    it('같은 시드면 같은 구간을 내고 평균을 감싼다', () => {
      const values = [
        { block: 'w1', value: 1 },
        { block: 'w1', value: 1 },
        { block: 'w2', value: 0 },
        { block: 'w3', value: 1 / 3 },
      ];
      const first = blockBootstrapInterval(values, { iterations: 2000 });
      const second = blockBootstrapInterval(values, { iterations: 2000 });

      expect(first).toEqual(second);
      expect(first!.lower).toBeLessThanOrEqual(first!.mean);
      expect(first!.upper).toBeGreaterThanOrEqual(first!.mean);
      expect(first!.blocks).toBe(3);
    });

    it('값이 없으면 null', () => {
      expect(blockBootstrapInterval([])).toBeNull();
    });
  });

  it('ISO 주 키는 월요일에 시작한다', () => {
    expect(isoWeekKey(new Date('2026-10-04T10:00:00Z'))).toBe('2026-W40');
    expect(isoWeekKey(new Date('2026-10-05T10:00:00Z'))).toBe('2026-W41');
  });

  describe('decideSelectionVerdict', () => {
    const interval = (lower: number, upper: number): Interval => ({
      mean: (lower + upper) / 2,
      lower,
      upper,
      blocks: 10,
      values: 28,
    });

    it.each([
      [interval(0.85, 0.95), interval(0.75, 0.9), 'MIGRATE'],
      [interval(0.85, 0.95), interval(0.3, 0.6), 'JUDGE_BY_PERFORMANCE'],
      [interval(0.2, 0.45), interval(0.75, 0.9), 'MIGRATE_STRONG'],
      [interval(0.2, 0.45), interval(0.3, 0.6), 'UNSTABLE_COMPARE_PERFORMANCE'],
      // 점추정이 0.8 이어도 구간이 걸치면 보류.
      [interval(0.65, 0.95), interval(0.75, 0.9), 'HOLD'],
      [interval(0.85, 0.95), interval(0.6, 0.8), 'HOLD'],
    ])('①%j ④%j → %s', (consistency, rule, expected) => {
      expect(decideSelectionVerdict({ consistency, rule })).toBe(expected);
    });
  });
});
