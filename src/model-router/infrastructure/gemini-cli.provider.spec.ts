import {
  buildGeminiArgs,
  buildGeminiStdinPayload,
  parseGeminiJsonOutput,
} from './gemini-cli.provider';

describe('buildGeminiArgs', () => {
  it('-p "" + -o json + --approval-mode plan 포함', () => {
    const args = buildGeminiArgs({});
    expect(args).toEqual(
      expect.arrayContaining(['-p', '', '-o', 'json', '--approval-mode', 'plan']),
    );
  });

  it('--yolo 는 포함하지 않는다 (도구 자동 승인 차단)', () => {
    expect(buildGeminiArgs({})).not.toContain('--yolo');
  });

  it('positional prompt 를 argv 로 넘기지 않는다 (stdin 전달이라 -- 불필요)', () => {
    expect(buildGeminiArgs({})).not.toContain('--');
  });
});

describe('buildGeminiStdinPayload', () => {
  it('systemPrompt 이 없으면 prompt 그대로', () => {
    expect(buildGeminiStdinPayload({ prompt: 'hello' })).toBe('hello');
  });

  it('systemPrompt 가 있으면 [System Instructions] / [User] 블록으로 합친다', () => {
    expect(
      buildGeminiStdinPayload({ prompt: 'u', systemPrompt: 's' }),
    ).toBe('[System Instructions]\ns\n\n[User]\nu');
  });
});

describe('parseGeminiJsonOutput', () => {
  it('response 필드를 추출', () => {
    const raw = JSON.stringify({
      response: '안녕하세요',
      stats: { model: 'gemini-2.5-pro' },
    });
    const { text, modelUsed } = parseGeminiJsonOutput(raw);
    expect(text).toBe('안녕하세요');
    expect(modelUsed).toBe('gemini-2.5-pro');
  });

  it('result 키 fallback (CLI 버전마다 키 다름)', () => {
    const { text } = parseGeminiJsonOutput(JSON.stringify({ result: 'OK' }));
    expect(text).toBe('OK');
  });

  it('text 키 fallback', () => {
    const { text } = parseGeminiJsonOutput(JSON.stringify({ text: '응답' }));
    expect(text).toBe('응답');
  });

  it('model 정보 없으면 기본 gemini-cli 로 fallback', () => {
    const { modelUsed } = parseGeminiJsonOutput(
      JSON.stringify({ response: 'x' }),
    );
    expect(modelUsed).toBe('gemini-cli');
  });

  it('error 객체 응답이면 메시지를 포함한 예외', () => {
    const raw = JSON.stringify({
      session_id: 's',
      error: { type: 'Error', message: 'auth missing', code: 41 },
    });
    expect(() => parseGeminiJsonOutput(raw)).toThrow(/auth missing/);
  });

  it('빈 응답이면 예외', () => {
    expect(() => parseGeminiJsonOutput('   ')).toThrow(/빈 응답/);
  });

  it('JSON 파싱 불가하면 예외', () => {
    expect(() => parseGeminiJsonOutput('not json')).toThrow();
  });

  it('response/result/text 다 없으면 예외', () => {
    expect(() => parseGeminiJsonOutput(JSON.stringify({ foo: 'bar' }))).toThrow(
      /response\/result\/text/,
    );
  });
});
