import {
  buildEveningBlogBodyPrompt,
  buildEveningRetroPrompt,
  parseEveningRetroOutput,
} from './evening-retro.prompt';

describe('parseEveningRetroOutput', () => {
  it('코드펜스로 감싼 JSON 을 파싱한다', () => {
    const text =
      '```json\n{"retrospective":"오늘 X 함","candidates":[{"title":"T","keywords":["k1"],"blogValueScore":80,"reason":"R","sourceRefs":["schoolbell-e/sbe-api-v5#864"],"outline":["문제","접근","결과"]}],"prNotes":[{"ref":"schoolbell-e/sbe-api-v5#864","note":"정합성 문제를 트랜잭션으로 보강"}]}\n```';
    const result = parseEveningRetroOutput(text);
    expect(result.retrospective).toBe('오늘 X 함');
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
      '{"retrospective":"r","candidates":[{"title":"T","keywords":[],"blogValueScore":10,"reason":"R","sourceRefs":"bad"}]}';

    const result = parseEveningRetroOutput(text);

    expect(result.candidates[0].sourceRefs).toEqual([]);
  });

  it('candidate outline 이 배열이 아니거나 누락되면 빈 배열로 방어한다', () => {
    const text =
      '{"retrospective":"r","candidates":[{"title":"A","keywords":[],"blogValueScore":10,"reason":"R","sourceRefs":[],"outline":"bad"},{"title":"B","keywords":[],"blogValueScore":9,"reason":"R","sourceRefs":[]}],"prNotes":[]}';

    const result = parseEveningRetroOutput(text);

    expect(result.candidates[0]).toHaveProperty('outline', []);
    expect(result.candidates[1]).toHaveProperty('outline', []);
  });

  it('prNotes 가 배열이 아니면 빈 배열, ref 가 비면 제외한다', () => {
    const missingNotesText = '{"retrospective":"r","candidates":[] }';
    const mixedNotesText =
      '{"retrospective":"r","candidates":[],"prNotes":[{"ref":"schoolbell-e/sbe-api-v5#864","note":"노트"},{"ref":"","note":"제외"},{"note":"ref 없음"}]}';

    expect(parseEveningRetroOutput(missingNotesText)).toHaveProperty(
      'prNotes',
      [],
    );
    expect(parseEveningRetroOutput(mixedNotesText)).toHaveProperty('prNotes', [
      { ref: 'schoolbell-e/sbe-api-v5#864', note: '노트' },
    ]);
  });

  it('candidates 가 비어도 파싱한다', () => {
    const text = '{"retrospective":"r","candidates":[]}';
    expect(parseEveningRetroOutput(text).candidates).toEqual([]);
  });

  it('파싱 불가 텍스트는 throw', () => {
    expect(() => parseEveningRetroOutput('그냥 문장')).toThrow();
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
      worklogText: null,
      dailyEvalText: null,
    });

    expect(prompt).toContain('[회사 실무][schoolbell-e/sbe-api-v5#864]');
    expect(prompt).toContain('[개인 프로젝트][JSL107/personal_agents#142]');
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
