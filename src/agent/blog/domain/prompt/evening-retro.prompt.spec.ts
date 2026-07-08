import {
  buildEveningBlogBodyPrompt,
  buildEveningRetroPrompt,
  parseEveningRetroOutput,
} from './evening-retro.prompt';

describe('parseEveningRetroOutput', () => {
  it('코드펜스로 감싼 JSON 을 파싱한다', () => {
    const text =
      '```json\n{"retrospective":"오늘 X 함","candidates":[{"title":"T","keywords":["k1"],"blogValueScore":80,"reason":"R","sourceRefs":["schoolbell-e/sbe-api-v5#864"]}]}\n```';
    const result = parseEveningRetroOutput(text);
    expect(result.retrospective).toBe('오늘 X 함');
    expect(result.candidates[0].blogValueScore).toBe(80);
    expect(result.candidates[0].keywords).toEqual(['k1']);
    expect(result.candidates[0].sourceRefs).toEqual([
      'schoolbell-e/sbe-api-v5#864',
    ]);
  });

  it('candidate sourceRefs 가 배열이 아니면 빈 배열로 방어한다', () => {
    const text =
      '{"retrospective":"r","candidates":[{"title":"T","keywords":[],"blogValueScore":10,"reason":"R","sourceRefs":"bad"}]}';

    const result = parseEveningRetroOutput(text);

    expect(result.candidates[0].sourceRefs).toEqual([]);
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
});
