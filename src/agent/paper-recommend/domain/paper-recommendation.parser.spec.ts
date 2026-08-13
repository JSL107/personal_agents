import { parsePaperRecommendation } from './paper-recommendation.parser';
import { PaperRecommendationErrorCode } from './paper-recommendation-error-code.enum';

describe('parsePaperRecommendation', () => {
  it('매수와 매도 JSON을 파싱한다', () => {
    const result = parsePaperRecommendation(`{
      "sells": [{ "code": "005930", "reason": "추세 이탈" }],
      "buys": [{ "code": "000660", "weightPercent": 20, "reason": "돌파" }]
    }`);

    expect(result).toEqual({
      sells: [{ code: '005930', reason: '추세 이탈' }],
      buys: [{ code: '000660', weightPercent: 20, reason: '돌파' }],
    });
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
          buys: [{ code: '000660', weightPercent: '20', reason: '돌파' }],
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
