import { AssignedTasks } from '../../../../github/domain/github.type';
import { formatGithubTasksAsPromptSection } from './github-task-formatter';

describe('formatGithubTasksAsPromptSection', () => {
  it('issue / PR 모두 markdown 으로 출력하고 라벨/draft 마크 포함', () => {
    const tasks: AssignedTasks = {
      issues: [
        {
          number: 12,
          title: '크롤러 timeout 버그',
          repo: 'foo/bar',
          url: 'https://github.com/foo/bar/issues/12',
          labels: ['bug', 'priority:high'],
          updatedAt: '2026-04-23T05:00:00Z',
        },
      ],
      pullRequests: [
        {
          number: 34,
          title: 'GitHub 커넥터 추가',
          repo: 'foo/bar',
          url: 'https://github.com/foo/bar/pull/34',
          draft: true,
          updatedAt: '2026-04-23T06:00:00Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    };

    const { content, truncatedCount } = formatGithubTasksAsPromptSection(tasks);

    expect(content).toContain('[GitHub 에서 자동 수집한 assigned 항목]');
    expect(content).toContain(
      '- Issue #12 (foo/bar) [bug, priority:high]: 크롤러 timeout 버그',
    );
    expect(content).toContain('- PR #34 (foo/bar) [draft]: GitHub 커넥터 추가');
    expect(truncatedCount).toBe(0);
  });

  it('빈 결과면 명시적 안내 문구를 출력 (model 에게 "GitHub 는 없다" 명시)', () => {
    const { content, truncatedCount } = formatGithubTasksAsPromptSection({
      issues: [],
      pullRequests: [],
    });

    expect(content).toContain('(없음');
    expect(content).toContain('GitHub 호출은 성공했으나');
    expect(truncatedCount).toBe(0);
  });

  it('label / draft 가 없으면 마크 미포함', () => {
    const { content } = formatGithubTasksAsPromptSection({
      issues: [
        {
          number: 1,
          title: 't',
          repo: 'a/b',
          url: 'u',
          labels: [],
          updatedAt: 'x',
        },
      ],
      pullRequests: [
        {
          number: 2,
          title: 't',
          repo: 'a/b',
          url: 'u',
          draft: false,
          updatedAt: 'x',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    });

    expect(content).toContain('- Issue #1 (a/b): t');
    expect(content).toContain('- PR #2 (a/b): t');
    expect(content).not.toContain('[draft]');
  });

  it('항목 합이 maxItems 초과 시 cap + "(+N건 생략)" 표기', () => {
    const issues = Array.from({ length: 25 }, (_, index) => ({
      number: index + 1,
      title: `i${index}`,
      repo: 'a/b',
      url: 'u',
      labels: [],
      updatedAt: 'x',
    }));
    const pullRequests = Array.from({ length: 15 }, (_, index) => ({
      number: 100 + index,
      title: `p${index}`,
      repo: 'a/b',
      url: 'u',
      draft: false,
      updatedAt: 'x',
      requestedReviewers: [],
      isApproved: false,
    }));

    const { content, truncatedCount } = formatGithubTasksAsPromptSection(
      { issues, pullRequests },
      { maxItems: 10 },
    );

    expect(truncatedCount).toBe(30);
    expect(content).toContain('(+30건 생략 — 총 40건 중 10건만 표기)');
    // 첫 10개 (issues 우선) 만 본문에 등장
    expect(content).toContain('- Issue #1 ');
    expect(content).toContain('- Issue #10 ');
    expect(content).not.toContain('- Issue #11 ');
    expect(content).not.toContain('- PR #100');
  });

  it('isApproved=true 인 PR 은 [APPROVED] 라벨이 붙는다 (LLM 후순위 판단용)', () => {
    const { content } = formatGithubTasksAsPromptSection({
      issues: [],
      pullRequests: [
        {
          number: 99,
          title: '머지 대기 PR',
          repo: 'a/b',
          url: 'u',
          draft: false,
          updatedAt: 'x',
          requestedReviewers: [],
          isApproved: true,
        },
      ],
    });

    expect(content).toContain('- PR #99 (a/b) [APPROVED]: 머지 대기 PR');
  });

  it('default maxItems = 30 적용, 30건 이하면 truncated 0', () => {
    const issues = Array.from({ length: 30 }, (_, index) => ({
      number: index + 1,
      title: `t`,
      repo: 'a/b',
      url: 'u',
      labels: [],
      updatedAt: 'x',
    }));

    const { truncatedCount } = formatGithubTasksAsPromptSection({
      issues,
      pullRequests: [],
    });

    expect(truncatedCount).toBe(0);
  });
});
