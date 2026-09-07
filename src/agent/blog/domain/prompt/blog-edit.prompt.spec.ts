import {
  buildBlogEditSystemPrompt,
  MIN_EDITED_BODY_RATIO,
} from './blog-edit.prompt';

// 프롬프트를 섹션별로 가른다. 「덜어낼 것」에 있는 문구와 「덜어내면 안 되는 것」에 있는
// 문구는 정반대 뜻이라, 전문 검색(`toContain`)으로는 어느 쪽에 있는지 가릴 수 없다.
const sectionOf = (heading: string): string => {
  const lines = buildBlogEditSystemPrompt([]).split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) {
    throw new Error(`프롬프트에 '${heading}' 섹션이 없습니다.`);
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
};

describe('BLOG_EDIT_SYSTEM_PROMPT — 인용 보존', () => {
  // 실측: 원문 인용 7줄이 편집 단계에서 0줄이 됐다(익명화 산출물은 7줄 그대로였다).
  // 고장이 아니라 지시 이행이었다 — 삭제 대상 목록에 인용이 있었고 보호 목록에는 코드뿐이었다.
  it('「덜어낼 것」에 인용을 두지 않는다', () => {
    expect(sectionOf('## 덜어낼 것')).not.toContain('인용');
  });

  it('「덜어내면 안 되는 것」이 인용을 보호한다', () => {
    const 보호 = sectionOf('## 덜어내면 안 되는 것');
    expect(보호).toContain('인용');
    // 지우지 말라는 것만으로는 부족하다 — 본문 문장으로 풀어 옮기면 따온 말과 쓴 말의
    // 경계가 지워지는데 인용 줄 수는 똑같이 0 이 된다.
    expect(보호).toContain('본문 문장으로 풀어 옮기지도 마라');
  });
});

describe('BLOG_EDIT_SYSTEM_PROMPT — 분량 예산', () => {
  // 이 값이 코드에만 있던 동안 모델은 예산을 모른 채 자르고 코드는 자른 뒤에 벌했다.
  it('가드가 집행하는 비율을 모델에게도 알려준다', () => {
    const 예산 = sectionOf('## 얼마나 덜어낼 것인가');
    expect(예산).toContain(`${Math.round(MIN_EDITED_BODY_RATIO * 100)}% 이상`);
  });

  // 덜어내라는 지시만 있고 한계가 없으면 "많이 지울수록 잘한 것" 으로 읽힌다.
  it('덜어내기 자체가 목적이 아님을 못 박는다', () => {
    expect(sectionOf('## 얼마나 덜어낼 것인가')).toContain(
      '덜어내는 것 자체가 목적이 아니다',
    );
  });
});

describe('학습 규칙 섹션', () => {
  it('정리 규칙과 보호 규칙 사이에 같은 불릿 형식으로 싣는다', () => {
    const prompt = buildBlogEditSystemPrompt([
      '중복 결론을 덜어낸다.',
      '도입에서 주제를 밝힌다.',
    ]);
    const start = prompt.indexOf('## 이 블로그에서 반복된 수정');
    expect(start).toBeGreaterThan(prompt.indexOf('## 정리할 것'));
    expect(start).toBeLessThan(prompt.indexOf('## 절대 건드리지 말 것'));
    expect(prompt).toContain(
      '- 중복 결론을 덜어낸다.\n- 도입에서 주제를 밝힌다.',
    );
  });
  // 규칙은 지난 글의 수정 이력에서 모델이 뽑은 문장이라, 보호 규칙과 어긋나는 지시가 섞여
  // 들어올 수 있다. 어느 쪽이 이기는지 프롬프트 안에 남아 있어야 한다.
  it('보호 규칙이 우선한다는 것을 규칙 앞에 밝힌다', () => {
    const prompt = buildBlogEditSystemPrompt(['중복 결론을 덜어낸다.']);
    const notice = prompt.indexOf(
      '「절대 건드리지 말 것」과 어긋나는 항목이 있으면',
    );
    expect(notice).toBeGreaterThan(
      prompt.indexOf('## 이 블로그에서 반복된 수정'),
    );
    expect(notice).toBeLessThan(prompt.indexOf('- 중복 결론을 덜어낸다.'));
  });
  it('규칙이 없으면 빈 섹션도 만들지 않는다', () => {
    expect(buildBlogEditSystemPrompt([])).not.toContain(
      '## 이 블로그에서 반복된 수정',
    );
  });
});
