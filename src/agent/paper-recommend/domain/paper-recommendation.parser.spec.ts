import { parsePaperRecommendation } from './paper-recommendation.parser';
import { PaperRecommendationErrorCode } from './paper-recommendation-error-code.enum';

describe('parsePaperRecommendation', () => {
  it('매수와 매도 JSON을 파싱한다', () => {
    const result = parsePaperRecommendation(`{
      "sells": [{ "code": "005930", "reason": "추세 이탈" }],
      "buys": [{ "code": "000660", "reason": "돌파" }]
    }`);

    expect(result).toEqual({
      sells: [{ code: '005930', reason: '추세 이탈' }],
      buys: [{ code: '000660', reason: '돌파' }],
    });
  });

  // 비중은 코드가 정한다. 모델이 보낸 값을 오류로 보지도 않지만 결과에 남겨서도 안 된다 —
  // 남으면 나중에 누가 읽어 회차마다 다른 수량이 다시 나온다.
  it('모델이 비중을 보내면 오류 없이 그 값을 떨궈 낸다', () => {
    const result = parsePaperRecommendation(
      JSON.stringify({
        sells: [],
        buys: [
          { code: '000660', weightPercent: '터무니없는 값', reason: '돌파' },
        ],
      }),
    );

    expect(result.buys).toEqual([{ code: '000660', reason: '돌파' }]);
    expect(result.buys[0]).not.toHaveProperty('weightPercent');
  });

  it('잘못된 JSON이면 PAPER_RECOMMEND_INVALID_MODEL_OUTPUT을 던진다', () => {
    expect(() => parsePaperRecommendation('{not json}')).toThrow(
      expect.objectContaining({
        paperRecommendationErrorCode:
          PaperRecommendationErrorCode.INVALID_MODEL_OUTPUT,
      }),
    );
  });

  it('필수 필드 형태가 아니면 PAPER_RECOMMEND_INVALID_MODEL_OUTPUT을 던진다', () => {
    expect(() =>
      parsePaperRecommendation(
        JSON.stringify({
          sells: [{ code: '005930' }],
          buys: [{ code: '000660', reason: 42 }],
        }),
      ),
    ).toThrow(
      expect.objectContaining({
        paperRecommendationErrorCode:
          PaperRecommendationErrorCode.INVALID_MODEL_OUTPUT,
      }),
    );
  });

  it('sells와 buys가 누락되거나 null이면 빈 배열로 파싱한다', () => {
    expect(parsePaperRecommendation('{}')).toEqual({ sells: [], buys: [] });
    expect(
      parsePaperRecommendation(JSON.stringify({ sells: null, buys: null })),
    ).toEqual({ sells: [], buys: [] });
  });

  it.each([
    ['sells', 'not-an-array'],
    ['buys', { code: '000660' }],
  ])('%s가 nullish 외 비배열이면 오류를 던진다', (field, value) => {
    expect(() =>
      parsePaperRecommendation(
        JSON.stringify({ sells: [], buys: [], [field]: value }),
      ),
    ).toThrow(
      expect.objectContaining({
        paperRecommendationErrorCode:
          PaperRecommendationErrorCode.INVALID_MODEL_OUTPUT,
      }),
    );
  });
});
