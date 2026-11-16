import {
  extractTargetRepoRuleSection,
  renderTargetRepoRules,
  TARGET_REPO_RULES_MAX_BYTES,
} from './target-repo-rules';

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
      renderTargetRepoRules([{ path: 'AGENTS.md', content: '# 안내\n없음' }]),
    ).toEqual({ block: '', used: [] });
  });

  it('출처와 절 제목을 남기고, 본문은 신뢰 경계 안에 둔다', () => {
    const rules = renderTargetRepoRules([
      { path: 'AGENTS.md', content: '## Review Focus\n- 권한 검사' },
      { path: 'CLAUDE.md', content: '## 컨벤션\n- DTO' },
    ]);
    expect(rules.used).toEqual(['AGENTS.md#Review Focus', 'CLAUDE.md#컨벤션']);
    const inside = rules.block.slice(rules.block.indexOf('<untrusted-input>'));
    expect(inside).toContain('### AGENTS.md — Review Focus\n- 권한 검사');
    expect(inside).toContain('### CLAUDE.md — 컨벤션\n- DTO');
  });

  it('합계 상한을 넘는 절은 뺀다', () => {
    const huge = `## Review Focus\n${'가'.repeat(5_000)}`;
    const rules = renderTargetRepoRules([
      { path: 'A.md', content: huge },
      { path: 'B.md', content: huge },
      { path: 'C.md', content: huge },
    ]);
    expect(rules.used.length).toBeLessThan(3);
    expect(Buffer.byteLength(rules.block, 'utf-8')).toBeLessThan(
      TARGET_REPO_RULES_MAX_BYTES + 2_000,
    );
  });
});
