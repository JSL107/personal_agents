import { parseSpecCode } from './be-test.parser';

describe('parseSpecCode', () => {
  it('raw JSON 응답을 파싱해 specCode 를 반환한다', () => {
    const specCode = "describe('Foo', () => { it('works', () => {}); });";
    const text = JSON.stringify({ specCode });

    const result = parseSpecCode(text);

    expect(result.specCode).toBe(specCode);
  });

  it('```json fence 로 감싸진 응답을 풀어서 파싱한다', () => {
    const specCode = "import { Foo } from './foo';\ndescribe('Foo', () => {});";
    const text = '```json\n' + JSON.stringify({ specCode }) + '\n```';

    const result = parseSpecCode(text);

    expect(result.specCode).toBe(specCode);
  });

  it('plain TypeScript 코드를 그대로 specCode 로 수용한다', () => {
    const tsCode =
      "import { Bar } from './bar';\ndescribe('Bar', () => { it('should work', () => {}); });";

    const result = parseSpecCode(tsCode);

    expect(result.specCode).toBe(tsCode);
  });

  it('빈 응답이면 specCode 에 빈 문자열이 들어간다', () => {
    const result = parseSpecCode('');

    expect(result.specCode).toBe('');
  });

  it('JSON 안에 추가 noise 필드가 있어도 specCode 만 추출한다', () => {
    const specCode = "describe('X', () => {});";
    const text = JSON.stringify({ specCode, extra: 'noise', count: 42 });

    const result = parseSpecCode(text);

    expect(result.specCode).toBe(specCode);
  });
});
