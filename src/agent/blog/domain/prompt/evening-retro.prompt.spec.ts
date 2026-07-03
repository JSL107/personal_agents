import { parseEveningRetroOutput } from './evening-retro.prompt';

describe('parseEveningRetroOutput', () => {
  it('코드펜스로 감싼 JSON 을 파싱한다', () => {
    const text =
      '```json\n{"retrospective":"오늘 X 함","candidates":[{"title":"T","keywords":["k1"],"blogValueScore":80,"reason":"R"}]}\n```';
    const result = parseEveningRetroOutput(text);
    expect(result.retrospective).toBe('오늘 X 함');
    expect(result.candidates[0].blogValueScore).toBe(80);
    expect(result.candidates[0].keywords).toEqual(['k1']);
  });

  it('candidates 가 비어도 파싱한다', () => {
    const text = '{"retrospective":"r","candidates":[]}';
    expect(parseEveningRetroOutput(text).candidates).toEqual([]);
  });

  it('파싱 불가 텍스트는 throw', () => {
    expect(() => parseEveningRetroOutput('그냥 문장')).toThrow();
  });
});
