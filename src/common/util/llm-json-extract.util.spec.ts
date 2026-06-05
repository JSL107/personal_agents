import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from './llm-json-extract.util';

describe('extractJsonObjectText — LLM 응답 robust JSON 추출', () => {
  it('1) 전체가 code fence ```json ...``` 인 경우 본문 추출', () => {
    const raw = '```json\n{"foo": 1}\n```';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('1) language tag 없는 ``` ... ``` 도 본문 추출', () => {
    const raw = '```\n{"foo": 1}\n```';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('2) code fence 앞에 설명 텍스트가 있어도 fence 본문만 추출', () => {
    const raw = '다음은 plan 입니다:\n```json\n{"foo": 1}\n```';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('2) code fence 뒤에 설명 텍스트가 있어도 fence 본문만 추출', () => {
    const raw = '```json\n{"foo": 1}\n```\n위 내용으로 진행하세요.';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('2) code fence 앞뒤 모두 설명 텍스트가 있어도 fence 본문만 추출', () => {
    const raw =
      '여기 plan 결과입니다.\n```json\n{"foo": 1, "bar": "x"}\n```\n수정 필요 시 알려주세요.';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1, "bar": "x"}');
  });

  it('3) fence 없이 앞 설명 텍스트만 있어도 첫 { 부터 마지막 } 까지 추출', () => {
    const raw = '결과:\n{"foo": 1}';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('3) fence 없이 앞뒤 설명 텍스트가 있어도 JSON object 만 추출', () => {
    const raw = '다음과 같습니다.\n{"foo": 1, "nested": {"x": 2}}\n끝.';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1, "nested": {"x": 2}}');
  });

  it('순수 JSON 만 들어오면 그대로 (trim 만)', () => {
    const raw = '  {"foo": 1}  ';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1}');
  });

  it('JSON object 형태가 전혀 없으면 trim 만 한 원본 반환 (호출자가 SyntaxError 받게)', () => {
    const raw = '죄송합니다. 모르겠어요.';
    expect(extractJsonObjectText(raw)).toBe('죄송합니다. 모르겠어요.');
  });

  it('빈 문자열은 빈 문자열 반환 (호출자가 SyntaxError 받게)', () => {
    expect(extractJsonObjectText('')).toBe('');
  });
});

describe('buildJsonParseCauseMessage — debug log 친화 cause', () => {
  it('Error 객체의 message + raw 응답 첫 300자를 포함', () => {
    const error = new SyntaxError('Unexpected token } in JSON');
    const raw = '{"foo": 1, "bar": ';
    const cause = buildJsonParseCauseMessage(error, raw);
    expect(cause).toContain('Unexpected token } in JSON');
    expect(cause).toContain('raw=');
    expect(cause).toContain('{"foo": 1, "bar":');
  });

  it('Error 가 아닌 값도 String 으로 변환해서 포함', () => {
    const cause = buildJsonParseCauseMessage('plain string error', 'raw text');
    expect(cause).toContain('plain string error');
    expect(cause).toContain('raw=raw text');
  });

  it('raw 응답이 300자 초과면 첫 300자만 (log 폭증 방지)', () => {
    const longRaw = 'a'.repeat(500);
    const cause = buildJsonParseCauseMessage(new Error('boom'), longRaw);
    expect(cause).toContain('a'.repeat(300));
    expect(cause).not.toContain('a'.repeat(310));
  });
});
