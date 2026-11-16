import {
  extractTargetRepoRuleSection,
  PERSONAL_RULES_LABEL,
  renderTargetRepoRules,
  renderTargetRepoRuleSections,
  TARGET_REPO_RULES_MAX_BYTES,
  TargetRepoRules,
  TargetRepoRuleSource,
} from './target-repo-rules';

interface RenderInput {
  sources: TargetRepoRuleSource[];
  personal?: string;
}

const render = ({ sources, personal }: RenderInput): TargetRepoRules =>
  renderTargetRepoRules({
    sections: renderTargetRepoRuleSections(sources),
    personal,
  });

describe('extractTargetRepoRuleSection', () => {
  it('제목에 review 가 든 절을 다음 같은 수준 제목 전까지 고른다', () => {
    const markdown =
      '# AGENTS.md\n## Stack\nNest\n## Review Focus\n- 권한 검사 누락을 본다\n### 세부\n- 로그 마스킹\n## Safety\n무관';
    expect(extractTargetRepoRuleSection(markdown)).toEqual({
      heading: 'Review Focus',
      body: '- 권한 검사 누락을 본다\n### 세부\n- 로그 마스킹',
    });
  });

  it('리뷰 절이 없으면 컨벤션 절을 고른다', () => {
    const markdown =
      '# AGENTS.md\n## 실데이터(DB) 상황파악\nDB 규칙\n## 컨벤션\n- 응답은 DTO 로 감싼다\n## 개발 명령\nnpm run';
    expect(extractTargetRepoRuleSection(markdown)).toEqual({
      heading: '컨벤션',
      body: '- 응답은 DTO 로 감싼다',
    });
  });

  it('리뷰 절과 컨벤션 절이 모두 있으면 리뷰 절이 이긴다', () => {
    const markdown = '## Conventions\nA\n## Code Review Rules\nB';
    expect(extractTargetRepoRuleSection(markdown)?.heading).toBe(
      'Code Review Rules',
    );
  });

  it('제목에 리뷰가 들어갔을 뿐인 절보다 리뷰 기준 절이 이긴다 (이 레포 AGENTS.md 실측)', () => {
    const markdown =
      '## 7. commit / 리뷰 워크플로우\n1. commit 은 요청 후에만\n## 8. 함정\nx\n## Code Review Rules\n### 리뷰 방식\n- 한국어로';
    expect(extractTargetRepoRuleSection(markdown)).toEqual({
      heading: 'Code Review Rules',
      body: '### 리뷰 방식\n- 한국어로',
    });
  });

  it('리뷰 기준 절이 없으면 제목이 리뷰로 시작하는 절을 고른다', () => {
    const markdown = '## 커밋·리뷰 절차\nA\n## 2. 리뷰할 때\nB';
    expect(extractTargetRepoRuleSection(markdown)?.heading).toBe(
      '2. 리뷰할 때',
    );
  });

  it('먼저 나온 같은 우선순위 제목이 비어 있으면 뒤의 제목을 고른다', () => {
    const markdown =
      '## Review Focus\n\n## 백엔드 리뷰 기준\n- 권한 검사\n## 기타\nx';
    expect(extractTargetRepoRuleSection(markdown)).toEqual({
      heading: '백엔드 리뷰 기준',
      body: '- 권한 검사',
    });
  });

  it('둘 다 없거나 본문이 비면 null — 레포 안내뿐인 문서를 통째로 싣지 않는다', () => {
    expect(
      extractTargetRepoRuleSection(
        '# Codex Bootstrap\n## General Guidelines for working with Nx\n...',
      ),
    ).toBeNull();
    expect(
      extractTargetRepoRuleSection('## Review Focus\n\n## Next\nx'),
    ).toBeNull();
  });
});

describe('renderTargetRepoRules', () => {
  it('실을 것이 없으면 빈 블록이다', () => {
    expect(
      render({
        sources: [{ path: 'AGENTS.md', content: '# 안내\n없음' }],
      }),
    ).toEqual({ block: '', used: [] });
  });

  it('출처와 절 제목을 남기고, 본문은 신뢰 경계 안에 둔다', () => {
    const rules = render({
      sources: [
        { path: 'AGENTS.md', content: '## Review Focus\n- 권한 검사' },
        { path: 'CLAUDE.md', content: '## 컨벤션\n- DTO' },
      ],
    });
    expect(rules.used).toEqual(['AGENTS.md#Review Focus', 'CLAUDE.md#컨벤션']);
    const inside = rules.block.slice(rules.block.indexOf('<untrusted-input>'));
    expect(inside).toContain('### AGENTS.md — Review Focus\n- 권한 검사');
    expect(inside).toContain('### CLAUDE.md — 컨벤션\n- DTO');
  });

  it('합계 상한을 넘는 절은 뺀다', () => {
    const huge = `## Review Focus\n${'가'.repeat(5_000)}`;
    const rules = render({
      sources: [
        { path: 'A.md', content: huge },
        { path: 'B.md', content: huge },
        { path: 'C.md', content: huge },
      ],
    });
    expect(rules.used.length).toBeLessThan(3);
    expect(Buffer.byteLength(rules.block, 'utf-8')).toBeLessThan(
      TARGET_REPO_RULES_MAX_BYTES + 2_000,
    );
  });

  it('개인 규칙은 레포 문서보다 앞에, 신뢰 경계 밖에 싣는다', () => {
    const rules = render({
      sources: [{ path: 'AGENTS.md', content: '## Review Focus\n- 권한 검사' }],
      personal: '- 마이그레이션 파일은 만들지 않는다\n',
    });
    expect(rules.used).toEqual([
      PERSONAL_RULES_LABEL,
      'AGENTS.md#Review Focus',
    ]);
    const personalAt = rules.block.indexOf(
      '- 마이그레이션 파일은 만들지 않는다',
    );
    expect(personalAt).toBeGreaterThan(-1);
    expect(personalAt).toBeLessThan(rules.block.indexOf('<untrusted-input>'));
  });

  it('레포 문서가 없어도 개인 규칙만으로 싣고, 비어 있으면 싣지 않는다', () => {
    expect(render({ sources: [], personal: '- A' }).used).toEqual([
      PERSONAL_RULES_LABEL,
    ]);
    expect(render({ sources: [], personal: '  \n' })).toEqual({
      block: '',
      used: [],
    });
  });

  it('개인 규칙이 예산을 먼저 쓰고, 남은 예산을 넘는 레포 절은 뺀다', () => {
    // 레포 절 하나는 혼자면 예산(12KB) 안이지만, 개인 규칙(약 6KB)을 뺀 나머지는 넘는다.
    const docs = `## Review Focus\n${'가'.repeat(2_000)}`;
    const small = '## Review Focus\n- 작은 절';
    const alone = render({ sources: [{ path: 'A.md', content: docs }] });
    expect(alone.used).toEqual(['A.md#Review Focus']);

    const rules = render({
      sources: [
        { path: 'A.md', content: docs },
        { path: 'B.md', content: small },
      ],
      personal: '나'.repeat(3_000),
    });
    expect(rules.used).toEqual([PERSONAL_RULES_LABEL, 'B.md#Review Focus']);
    expect(Buffer.byteLength(rules.block, 'utf-8')).toBeLessThan(
      TARGET_REPO_RULES_MAX_BYTES + 2_000,
    );
  });
});
