import { parseSreAnalysis } from './be-sre.parser';

describe('parseSreAnalysis', () => {
  it('raw JSON 응답을 파싱해 LLM 필드를 반환한다', () => {
    const payload = {
      rootCauseHypothesis: 'null 참조일 가능성이 높음',
      patchProposal: '```typescript\nconst x = value ?? defaultValue;\n```',
      reasoning: 'stack frame 이 FooService.doWork 에서 종료됨',
    };

    const result = parseSreAnalysis(JSON.stringify(payload));

    expect(result.rootCauseHypothesis).toBe(payload.rootCauseHypothesis);
    expect(result.patchProposal).toBe(payload.patchProposal);
    expect(result.reasoning).toBe(payload.reasoning);
    expect(result.parseError).toBeUndefined();
  });

  it('```json fence 로 감싸진 응답을 풀어서 파싱한다', () => {
    const payload = {
      rootCauseHypothesis: '비동기 예외 미처리',
      patchProposal: '```typescript\nawait handle();\n```',
      reasoning: 'unhandled promise rejection',
    };
    const text = '```json\n' + JSON.stringify(payload) + '\n```';

    const result = parseSreAnalysis(text);

    expect(result.rootCauseHypothesis).toBe(payload.rootCauseHypothesis);
    expect(result.parseError).toBeUndefined();
  });

  it('자유 텍스트 fallback — 원문을 patchProposal 에 보존하고 parseError:true 를 설정한다', () => {
    const freeText = '이것은 JSON 이 아닌 자유 텍스트 응답입니다.';

    const result = parseSreAnalysis(freeText);

    expect(result.patchProposal).toBe(freeText);
    expect(result.parseError).toBe(true);
  });

  it('빈 응답이면 parseError:true 이고 빈 문자열이 보존된다', () => {
    const result = parseSreAnalysis('');

    expect(result.parseError).toBe(true);
    expect(result.patchProposal).toBe('');
  });
});
