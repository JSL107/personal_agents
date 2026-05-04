import { parsePrConventionReport } from './be-fix.parser';

describe('parsePrConventionReport', () => {
  it('raw JSON 응답을 그대로 파싱한다', () => {
    const text = JSON.stringify({
      violations: [
        {
          filePath: 'src/foo.ts',
          line: 10,
          category: 'magic-number',
          message: '숫자 300 은 상수로 추출해야 합니다.',
          suggestedFix: '```ts\nconst TIMEOUT = 300;\n```',
        },
      ],
      summary: '1건의 위반.',
    });

    const result = parsePrConventionReport(text);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].filePath).toBe('src/foo.ts');
    expect(result.violations[0].line).toBe(10);
    expect(result.violations[0].category).toBe('magic-number');
    expect(result.summary).toBe('1건의 위반.');
    expect(result.parseError).toBeUndefined();
  });

  it('```json 펜스로 감싸진 응답을 풀어서 파싱한다', () => {
    const inner = JSON.stringify({
      violations: [],
      summary: '컨벤션 통과',
    });
    const text = '```json\n' + inner + '\n```';

    const result = parsePrConventionReport(text);

    expect(result.violations).toHaveLength(0);
    expect(result.summary).toBe('컨벤션 통과');
    expect(result.parseError).toBeUndefined();
  });

  it('자유 텍스트 fallback — parseError:true, violations 빈 배열', () => {
    const result = parsePrConventionReport(
      'LLM 이 알 수 없는 텍스트를 반환했다.',
    );

    expect(result.violations).toEqual([]);
    expect(result.parseError).toBe(true);
    expect(result.summary).toContain('LLM');
  });

  it('빈 응답 — parseError:true', () => {
    const result = parsePrConventionReport('');

    expect(result.violations).toEqual([]);
    expect(result.parseError).toBe(true);
  });

  it('violations 배열 안에 invalid item 은 필터링된다', () => {
    const text = JSON.stringify({
      violations: [
        {
          filePath: 'src/foo.ts',
          line: 5,
          category: 'naming',
          message: 'n 은 너무 짧은 변수명.',
          suggestedFix: '```ts\nconst count = n;\n```',
        },
        // filePath 없음 → 필터링
        { line: 3, category: 'naming', message: 'x', suggestedFix: '' },
        // message 없음 → 필터링
        { filePath: 'src/bar.ts', category: 'other', suggestedFix: '' },
        // suggestedFix 가 number → 필터링
        {
          filePath: 'src/baz.ts',
          category: 'other',
          message: 'm',
          suggestedFix: 42,
        },
      ],
      summary: '1건 유효.',
    });

    const result = parsePrConventionReport(text);

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].filePath).toBe('src/foo.ts');
  });

  it('알 수 없는 category 는 other 로 변환된다', () => {
    const text = JSON.stringify({
      violations: [
        {
          filePath: 'src/x.ts',
          category: 'some-unknown-cat',
          message: '알 수 없는 위반.',
          suggestedFix: '',
        },
      ],
      summary: '1건.',
    });

    const result = parsePrConventionReport(text);

    expect(result.violations[0].category).toBe('other');
  });

  it('server-injected 필드는 항상 초기값 (usecase 가 덮어쓴다)', () => {
    const text = JSON.stringify({
      prRef: 'should-be-ignored',
      prTitle: 'should-be-ignored',
      baseSha: 'abc',
      headSha: 'def',
      diffByteLength: 9999,
      diffTruncated: true,
      violations: [],
      summary: '통과',
    });

    const result = parsePrConventionReport(text);

    expect(result.prRef).toBe('');
    expect(result.prTitle).toBe('');
    expect(result.baseSha).toBe('');
    expect(result.headSha).toBe('');
    expect(result.diffByteLength).toBe(0);
    expect(result.diffTruncated).toBe(false);
  });
});
