import {
  buildEveningBlogBodyPrompt,
  buildEveningRetroPrompt,
  EVENING_BLOG_BODY_SYSTEM_PROMPT,
  formatRetroContext,
  parseEveningRetroOutput,
} from './evening-retro.prompt';

describe('parseEveningRetroOutput', () => {
  it('코드펜스로 감싼 JSON 을 파싱한다', () => {
    const text =
      '```json\n{"retrospective":{"keep":"가드를 강제조건에서 검증했다","problem":"확인 없이 결론을 썼다","tryNext":"결론 전에 명령을 한 번 돌린다","carryOver":"#605 리베이스가 남았다"},"candidates":[{"title":"T","keywords":["k1"],"blogValueScore":80,"reason":"R","sourceRefs":["schoolbell-e/sbe-api-v5#864"],"outline":["문제","접근","결과"]}],"prNotes":[{"ref":"schoolbell-e/sbe-api-v5#864","note":"정합성 문제를 트랜잭션으로 보강"}]}\n```';
    const result = parseEveningRetroOutput(text);
    expect(result.retrospective).toEqual({
      keep: '가드를 강제조건에서 검증했다',
      problem: '확인 없이 결론을 썼다',
      tryNext: '결론 전에 명령을 한 번 돌린다',
      carryOver: '#605 리베이스가 남았다',
    });
    expect(result.candidates[0].blogValueScore).toBe(80);
    expect(result.candidates[0].keywords).toEqual(['k1']);
    expect(result.candidates[0].sourceRefs).toEqual([
      'schoolbell-e/sbe-api-v5#864',
    ]);
    expect(result.candidates[0]).toHaveProperty('outline', [
      '문제',
      '접근',
      '결과',
    ]);
    expect(result).toHaveProperty('prNotes', [
      {
        ref: 'schoolbell-e/sbe-api-v5#864',
        note: '정합성 문제를 트랜잭션으로 보강',
      },
    ]);
  });

  it('candidate sourceRefs 가 배열이 아니면 빈 배열로 방어한다', () => {
    const text =
      '{"retrospective":{"keep":"r"},"candidates":[{"title":"T","keywords":[],"blogValueScore":10,"reason":"R","sourceRefs":"bad"}]}';

    const result = parseEveningRetroOutput(text);

    expect(result.candidates[0].sourceRefs).toEqual([]);
  });

  it('candidate outline 이 배열이 아니거나 누락되면 빈 배열로 방어한다', () => {
    const text =
      '{"retrospective":{"keep":"r"},"candidates":[{"title":"A","keywords":[],"blogValueScore":10,"reason":"R","sourceRefs":[],"outline":"bad"},{"title":"B","keywords":[],"blogValueScore":9,"reason":"R","sourceRefs":[]}],"prNotes":[]}';

    const result = parseEveningRetroOutput(text);

    expect(result.candidates[0]).toHaveProperty('outline', []);
    expect(result.candidates[1]).toHaveProperty('outline', []);
  });

  it('prNotes 가 배열이 아니면 빈 배열, ref 가 비면 제외한다', () => {
    const missingNotesText = '{"retrospective":{"keep":"r"},"candidates":[] }';
    const mixedNotesText =
      '{"retrospective":{"keep":"r"},"candidates":[],"prNotes":[{"ref":"schoolbell-e/sbe-api-v5#864","note":"노트"},{"ref":"","note":"제외"},{"note":"ref 없음"}]}';

    expect(parseEveningRetroOutput(missingNotesText)).toHaveProperty(
      'prNotes',
      [],
    );
    expect(parseEveningRetroOutput(mixedNotesText)).toHaveProperty('prNotes', [
      { ref: 'schoolbell-e/sbe-api-v5#864', note: '노트' },
    ]);
  });

  it('candidates 가 비어도 파싱한다', () => {
    const text = '{"retrospective":{"keep":"r"},"candidates":[]}';
    expect(parseEveningRetroOutput(text).candidates).toEqual([]);
  });

  it('파싱 불가 텍스트는 throw', () => {
    expect(() => parseEveningRetroOutput('그냥 문장')).toThrow();
  });
});

// 이 블록이 이 작업의 요구사항 자체다 — 모델이 근거 없이 칸을 채우는 것을 막으려면
// 빈 칸이 정상 경로여야 한다. 한 칸이라도 필수가 되면 모델은 그 칸을 지어내서 채운다.
describe('parseEveningRetroOutput — 회고 칸은 비울 수 있다', () => {
  const withReflection = (reflectionJson: string): string =>
    `{"retrospective":${reflectionJson},"candidates":[]}`;

  it('일부 칸만 있으면 나머지는 undefined 로 둔다', () => {
    const result = parseEveningRetroOutput(
      withReflection('{"keep":"가드를 강제조건에서 검증했다"}'),
    );

    expect(result.retrospective).toEqual({
      keep: '가드를 강제조건에서 검증했다',
    });
    expect(result.retrospective.problem).toBeUndefined();
    expect(result.retrospective.tryNext).toBeUndefined();
    expect(result.retrospective.carryOver).toBeUndefined();
  });

  it('네 칸이 모두 없어도 통과한다', () => {
    expect(parseEveningRetroOutput(withReflection('{}')).retrospective).toEqual(
      {},
    );
  });

  it('retrospective 키 자체가 없어도 통과한다 — malformed 로 치지 않는다', () => {
    const result = parseEveningRetroOutput('{"candidates":[]}');

    expect(result.retrospective).toEqual({});
    expect(result.retrospective.malformed).toBeUndefined();
  });

  it('빈 문자열·공백만 있는 칸은 뺀다', () => {
    const result = parseEveningRetroOutput(
      withReflection('{"keep":"","problem":"   ","tryNext":"실제 내용"}'),
    );

    expect(result.retrospective).toEqual({ tryNext: '실제 내용' });
  });

  it('문자열 앞뒤 공백은 정리한다', () => {
    const result = parseEveningRetroOutput(
      withReflection('{"problem":"  확인 없이 결론을 썼다  "}'),
    );

    expect(result.retrospective.problem).toBe('확인 없이 결론을 썼다');
  });

  it('문자열로 퇴행하면 malformed 로 표시하고 던지지 않는다', () => {
    const result = parseEveningRetroOutput(
      '{"retrospective":"옛 평문 회고","candidates":[],"prNotes":[{"ref":"a/b#1","note":"n"}]}',
    );

    // 형식만 어겼을 뿐 읽을 수 있는 회고라 원문을 버리지 않는다 — 원장에는 파싱 결과만
    // 남으므로 여기서 버리면 그날 회고를 어디서도 읽을 수 없다.
    expect(result.retrospective).toEqual({
      malformed: true,
      rawText: '옛 평문 회고',
    });
    // 회고를 못 읽어도 그날의 블로그·이력서 재료는 살아남아야 한다.
    expect(result.prNotes).toEqual([{ ref: 'a/b#1', note: 'n' }]);
  });

  it('형식을 어긴 원문은 블로그 맥락으로도 쓴다', () => {
    const result = parseEveningRetroOutput(
      '{"retrospective":"옛 평문 회고","candidates":[]}',
    );

    expect(formatRetroContext(result.retrospective)).toBe('옛 평문 회고');
  });

  it('배열·null 로 와도 malformed 로 표시한다', () => {
    expect(parseEveningRetroOutput(withReflection('[]')).retrospective).toEqual(
      { malformed: true },
    );
    expect(
      parseEveningRetroOutput(withReflection('null')).retrospective,
    ).toEqual({ malformed: true });
  });

  it('"없음" 류 문자열은 지우지 않는다 — 관측 전에 목록을 만들지 않는다', () => {
    // 렌더는 빈 칸을 「없음」 으로 찍으므로 화면상 결과가 같다. 모델이 실제로 쓰는 표현을
    // 관측하기 전에 목록을 박으면 그 목록이 실측인 척 남는다.
    const result = parseEveningRetroOutput(
      withReflection('{"problem":"없음"}'),
    );

    expect(result.retrospective.problem).toBe('없음');
  });
});

describe('formatRetroContext', () => {
  it('채워진 칸만 라벨과 함께 이어 붙인다', () => {
    const context = formatRetroContext({
      keep: '가드를 강제조건에서 검증했다',
      carryOver: '#605 리베이스가 남았다',
    });

    expect(context).toBe(
      '유지: 가드를 강제조건에서 검증했다\n미완: #605 리베이스가 남았다',
    );
  });

  it('네 칸이 모두 비면 (없음) 을 준다 — 블로그 프롬프트에 빈 제목만 남지 않게', () => {
    expect(formatRetroContext({})).toBe('(없음)');
  });
});

describe('buildEveningRetroPrompt', () => {
  it('PR 입력에 회사/개인 소스 라벨을 포함한다', () => {
    const prompt = buildEveningRetroPrompt({
      mergedPrs: [
        {
          repo: 'schoolbell-e/sbe-api-v5',
          number: 864,
          url: 'https://github.com/schoolbell-e/sbe-api-v5/pull/864',
          title: '회사 PR',
          body: '본문',
          source: 'company',
        },
        {
          repo: 'JSL107/personal_agents',
          number: 142,
          url: 'https://github.com/JSL107/personal_agents/pull/142',
          title: '개인 PR',
          body: '본문',
          source: 'personal',
        },
      ],
      openPrs: [],
      worklogText: null,
      dailyEvalText: null,
    });

    expect(prompt).toContain('[회사 실무][schoolbell-e/sbe-api-v5#864]');
    expect(prompt).toContain('[개인 프로젝트][JSL107/personal_agents#142]');
  });

  it('열린 PR 을 별도 섹션으로 넘긴다 — carryOver 의 근거다', () => {
    const prompt = buildEveningRetroPrompt({
      mergedPrs: [],
      openPrs: [
        {
          repo: 'JSL107/personal_agents',
          number: 611,
          url: 'https://github.com/JSL107/personal_agents/pull/611',
          title: '아직 안 끝난 작업',
          body: '열린 PR 의 긴 본문',
          source: 'personal',
        },
      ],
      worklogText: null,
      dailyEvalText: null,
    });

    expect(prompt).toContain('## 아직 열려 있는 내 PR (오늘 업데이트)');
    expect(prompt).toContain('[개인 프로젝트][JSL107/personal_agents#611]');
    expect(prompt).toContain('아직 안 끝난 작업');
    // 본문은 싣지 않는다 — carryOver 는 "무엇이 안 끝났나" 만 알면 되고, 머지 PR 과 같은
    // 크기로 실으면 프롬프트가 두 배가 된다.
    expect(prompt).not.toContain('열린 PR 의 긴 본문');
  });

  it('열린 PR 이 없으면 없다고 명시한다', () => {
    const prompt = buildEveningRetroPrompt({
      mergedPrs: [],
      openPrs: [],
      worklogText: null,
      dailyEvalText: null,
    });

    expect(prompt).toContain('(열려 있는 PR 없음)');
  });
});

describe('buildEveningBlogBodyPrompt', () => {
  it('reason 과 근거 PR 제목/본문을 포함한다', () => {
    const prompt = buildEveningBlogBodyPrompt({
      title: '유령 학급 근본 수정',
      keywords: ['user_to_group'],
      reason: '실제 장애 원인과 해결 과정을 설명할 수 있다.',
      retroContext: '오늘 회고',
      sourcePrs: [
        {
          repo: 'schoolbell-e/sbe-api-v5',
          number: 864,
          url: 'https://github.com/schoolbell-e/sbe-api-v5/pull/864',
          title: 'user_to_group 정합성 수정',
          body: '문제는 group_members 와 user_to_group 간 정합성 불일치였다.',
        },
      ],
    });

    expect(prompt).toContain('## 왜 쓸 가치');
    expect(prompt).toContain('실제 장애 원인과 해결 과정을 설명할 수 있다.');
    expect(prompt).toContain('## 근거 PR');
    expect(prompt).toContain('[schoolbell-e/sbe-api-v5#864]');
    expect(prompt).toContain('정합성 불일치였다.');
  });

  it('outline 이 있으면 초안 개요 섹션을 포함한다', () => {
    const input = {
      title: '유령 학급 근본 수정',
      keywords: ['user_to_group'],
      reason: '실제 장애 원인과 해결 과정을 설명할 수 있다.',
      retroContext: '오늘 회고',
      sourcePrs: [],
      outline: [
        '문제: group_members 와 user_to_group 정합성이 어긋났다.',
        '접근: 동기화 경계를 트랜잭션으로 묶었다.',
        '결과: 유령 학급 재발 가능성을 낮췄다.',
      ],
    };

    const prompt = buildEveningBlogBodyPrompt(input);

    expect(prompt).toContain('## 초안 개요');
    expect(prompt).toContain(
      '- 문제: group_members 와 user_to_group 정합성이 어긋났다.',
    );
    expect(prompt).toContain(
      '위 초안 개요 흐름(문제→접근→결과)을 따르되 근거 PR 로 살을 붙여라.',
    );
    expect(prompt).toContain(
      '위 근거 PR 의 실제 변경 내용을 바탕으로 기술 블로그 초안(제목 + 본문)을 마크다운으로 작성하라.',
    );
  });

  it('outline 이 없으면 초안 개요 섹션을 생략한다', () => {
    const prompt = buildEveningBlogBodyPrompt({
      title: '유령 학급 근본 수정',
      keywords: ['user_to_group'],
      reason: '실제 장애 원인과 해결 과정을 설명할 수 있다.',
      retroContext: '오늘 회고',
      sourcePrs: [],
    });

    expect(prompt).not.toContain('## 초안 개요');
  });
});

describe('EVENING_BLOG_BODY_SYSTEM_PROMPT', () => {
  it('저녁 블로그 생성에도 통합 채점표의 핵심 기준을 적용한다', () => {
    for (const rule of [
      '문장의 호흡을 무조건 짧게 만들지 않는다',
      '임의로 줄바꿈하지 않는다',
      '마침표만 붙여 나열하지 않는다',
      '공식·1차 출처',
    ]) {
      expect(EVENING_BLOG_BODY_SYSTEM_PROMPT).toContain(rule);
    }
  });
});
