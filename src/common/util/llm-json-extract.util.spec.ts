import {
  buildJsonParseCauseMessage,
  extractJsonArrayText,
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

  // 실제 실패 케이스 (BLOG_PUBLISH run#864): 모델이 지시대로 fence 없이 JSON 만 냈지만
  // string 값(블로그 본문·diff)에 마크다운 코드펜스가 들어 있다. 패턴 2 정규식은 JSON string
  // 경계를 모르므로 그 안쪽 fence 를 응답 fence 로 오인한다.
  it('JSON string 값 안의 코드펜스를 응답 fence 로 오인하지 않는다', () => {
    const raw = JSON.stringify({
      slug: 'legacy-to-node',
      body: '## 문제\n\n```php\n$row = query("SELECT 1");\n```\n\n## 교훈\n원장을 먼저.',
    });
    expect(extractJsonObjectText(raw)).toBe(raw);
    expect(JSON.parse(extractJsonObjectText(raw))).toHaveProperty(
      'slug',
      'legacy-to-node',
    );
  });

  it('바깥 fence + 안쪽 코드펜스 + 뒤 설명 텍스트에서도 JSON 전체를 추출한다', () => {
    const json = JSON.stringify({
      diff: '--- a/x.ts\n+++ b/x.ts\n```',
      reasoning: 'fence 포함',
    });
    const raw = `\`\`\`json\n${json}\n\`\`\`\n위와 같이 정리했습니다.`;
    expect(extractJsonObjectText(raw)).toBe(json);
  });

  it('어떤 후보도 JSON 이 아니면 기존 동작대로 첫 후보를 반환한다', () => {
    const raw = '```json\n{"foo": 1,\n```';
    expect(extractJsonObjectText(raw)).toBe('{"foo": 1,');
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

describe('extractJsonArrayText — 판정 배열 추출', () => {
  it('앞에 라벨이 붙어도 JSON 배열만 뽑는다', () => {
    // 첫 `[` 부터 마지막 `]` 까지 한 번에 잡으면 라벨까지 삼켜 파싱이 깨진다.
    const raw = '[판정 결과]\n[{"id": 1, "verdict": "ACCEPTED"}]';
    expect(extractJsonArrayText(raw)).toBe(
      '[{"id": 1, "verdict": "ACCEPTED"}]',
    );
  });

  it('뒤에 꼬리가 붙어도 JSON 배열만 뽑는다', () => {
    const raw = '[{"id": 1, "verdict": "REJECTED"}]\n[참고] 근거는 위와 같다';
    expect(extractJsonArrayText(raw)).toBe(
      '[{"id": 1, "verdict": "REJECTED"}]',
    );
  });

  it('code fence 안의 배열도 뽑는다', () => {
    const raw = '```json\n[{"id": 2, "verdict": "UNCLEAR"}]\n```';
    expect(extractJsonArrayText(raw)).toBe('[{"id": 2, "verdict": "UNCLEAR"}]');
  });

  it('값 안에 중첩 배열이 있어도 바깥 배열을 고른다', () => {
    // 좁은 후보(`[{` ~ `}]`)를 먼저 쓰면 중첩 배열만 단독으로 파싱에 성공해
    // 바깥 배열 대신 선택된다. 넓은 후보를 먼저 시도해야 한다.
    const raw = '[ {"id": 1, "verdict": "ACCEPTED", "evidence": [{"x": 1}]} ]';
    const extracted = extractJsonArrayText(raw);

    expect(extracted).not.toBeNull();
    const parsed = JSON.parse(extracted as string) as { id: number }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(1);
  });

  it('라벨과 함께 pretty JSON 을 출력해도 뽑는다', () => {
    // `[\n  {` 처럼 경계 사이에 개행이 들어가면 `indexOf('[{')` 로는 후보가 안 잡힌다.
    const raw = '[판정 결과]\n[\n  {"id": 1, "verdict": "ACCEPTED"}\n]\n[참고]';
    const extracted = extractJsonArrayText(raw);

    expect(extracted).not.toBeNull();
    const parsed = JSON.parse(extracted as string) as { id: number }[];
    expect(parsed).toEqual([{ id: 1, verdict: 'ACCEPTED' }]);
  });

  it('라벨·꼬리·공백 시작·중첩 배열이 한꺼번에 있어도 바깥 배열을 고른다', () => {
    // 넓은 후보가 라벨·꼬리로 깨진 상태에서 좁은 후보가 중첩 배열을 가리키면
    // 내부 배열이 단독 파싱에 성공해 잘못 선택된다.
    const raw =
      '[판정 결과]\n[ {"id": 1, "verdict": "ACCEPTED", "evidence": [{"x": 1}]} ]\n[참고]';
    const extracted = extractJsonArrayText(raw);

    expect(extracted).not.toBeNull();
    const parsed = JSON.parse(extracted as string) as { id: number }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe(1);
  });

  it('배열이 없으면 null 을 돌려준다 — 호출부가 파싱 실패를 구분할 수 있어야 한다', () => {
    expect(extractJsonArrayText('판단할 수 없습니다')).toBeNull();
  });
});
