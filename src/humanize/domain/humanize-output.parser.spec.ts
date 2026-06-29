import { parseHumanizeOutput } from './humanize-output.parser';

describe('parseHumanizeOutput', () => {
  it('키 집합이 일치하면 윤문 맵을 반환한다', () => {
    const raw = JSON.stringify({
      headline: '다듬은 헤드라인',
      reasoning: '다듬은 근거',
    });
    const parsed = parseHumanizeOutput(raw, ['headline', 'reasoning']);
    expect(parsed).toEqual({
      headline: '다듬은 헤드라인',
      reasoning: '다듬은 근거',
    });
  });

  it('코드펜스로 감싸도 추출한다', () => {
    const raw = '```json\n{"headline":"x"}\n```';
    expect(parseHumanizeOutput(raw, ['headline'])).toEqual({ headline: 'x' });
  });

  it('키가 누락되면 throw 한다', () => {
    const raw = JSON.stringify({ headline: 'x' });
    expect(() => parseHumanizeOutput(raw, ['headline', 'reasoning'])).toThrow();
  });

  it('값이 string 이 아니면 throw 한다', () => {
    const raw = JSON.stringify({ headline: 123 });
    expect(() => parseHumanizeOutput(raw, ['headline'])).toThrow();
  });

  it('JSON 파싱 불가면 throw 한다', () => {
    expect(() => parseHumanizeOutput('not json', ['headline'])).toThrow();
  });
});
