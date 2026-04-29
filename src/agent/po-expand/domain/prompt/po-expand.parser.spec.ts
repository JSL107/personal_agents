import { parsePoOutline } from './po-expand.parser';

describe('parsePoOutline', () => {
  it('raw JSON 응답을 그대로 파싱한다', () => {
    const text = JSON.stringify({
      outline: ['개요 1', '개요 2'],
      clarifyingQuestions: ['질문 1'],
    });

    const result = parsePoOutline('결제 재시도', text);

    expect(result).toEqual({
      subject: '결제 재시도',
      outline: ['개요 1', '개요 2'],
      clarifyingQuestions: ['질문 1'],
    });
    expect(result.parseError).toBeUndefined();
  });

  it('```json 펜스로 감싸진 응답을 풀어서 파싱한다', () => {
    const text = '```json\n{"outline":["a"],"clarifyingQuestions":[]}\n```';

    const result = parsePoOutline('테스트', text);

    expect(result.outline).toEqual(['a']);
    expect(result.clarifyingQuestions).toEqual([]);
    expect(result.parseError).toBeUndefined();
  });

  it('``` 펜스(언어 표시 없음) 도 동일하게 처리한다', () => {
    const text = '```\n{"outline":["x"],"clarifyingQuestions":["y"]}\n```';

    const result = parsePoOutline('테스트', text);

    expect(result.outline).toEqual(['x']);
    expect(result.clarifyingQuestions).toEqual(['y']);
  });

  it('JSON 이 아닌 자유 텍스트면 원문을 outline 으로 보존하고 parseError=true 표시', () => {
    const text = '아이디어를 다음과 같이 정리해보겠습니다…';

    const result = parsePoOutline('테스트', text);

    expect(result.outline).toEqual([text]);
    expect(result.clarifyingQuestions).toEqual([]);
    expect(result.parseError).toBe(true);
  });

  it('outline / clarifyingQuestions 가 배열이 아니면 빈 배열로 graceful', () => {
    const text = JSON.stringify({
      outline: 'not an array',
      clarifyingQuestions: 42,
    });

    const result = parsePoOutline('테스트', text);

    expect(result.outline).toEqual([]);
    expect(result.clarifyingQuestions).toEqual([]);
  });
});
