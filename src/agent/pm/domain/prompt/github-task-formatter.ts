import { AssignedTasks } from '../../../../github/domain/github.type';

export const MAX_GITHUB_ITEMS = 30;

export interface GithubFormatResult {
  content: string;
  truncatedCount: number;
}

// PM Agent 프롬프트에 끼워 넣을 GitHub assigned task 섹션을 markdown 으로 변환한다.
// 빈 결과(GitHub 호출은 성공했으나 할당 없음)도 명시적으로 표기해 모델이 "GitHub 데이터는 없다" 는 사실을 알 수 있게 한다.
// 항목 총합이 maxItems 초과 시 issues → PR 순서로 채우고 나머지는 "(+N건 생략)" 으로 cap (prompt context overflow 방어).
export const formatGithubTasksAsPromptSection = (
  tasks: AssignedTasks,
  options: { maxItems?: number } = {},
): GithubFormatResult => {
  const maxItems = options.maxItems ?? MAX_GITHUB_ITEMS;
  const lines: string[] = ['[GitHub 에서 자동 수집한 assigned 항목]'];

  if (tasks.issues.length === 0 && tasks.pullRequests.length === 0) {
    lines.push('(없음 — GitHub 호출은 성공했으나 assigned 항목이 없음)');
    return { content: lines.join('\n'), truncatedCount: 0 };
  }

  const total = tasks.issues.length + tasks.pullRequests.length;
  let remaining = maxItems;
  let truncatedCount = 0;

  for (const issue of tasks.issues) {
    if (remaining <= 0) {
      truncatedCount += 1;
      continue;
    }
    const labels =
      issue.labels.length > 0 ? ` [${issue.labels.join(', ')}]` : '';
    lines.push(
      `- Issue #${issue.number} (${issue.repo})${labels}: ${issue.title}`,
    );
    remaining -= 1;
  }

  for (const pr of tasks.pullRequests) {
    if (remaining <= 0) {
      truncatedCount += 1;
      continue;
    }
    const draft = pr.draft ? ' [draft]' : '';
    // 리뷰 끝나 머지만 남은 PR — LLM 이 plan 우선순위에서 후순위로 두도록 라벨 노출.
    const approved = pr.isApproved ? ' [APPROVED]' : '';
    lines.push(
      `- PR #${pr.number} (${pr.repo})${draft}${approved}: ${pr.title}`,
    );
    remaining -= 1;
  }

  if (truncatedCount > 0) {
    lines.push(
      `(+${truncatedCount}건 생략 — 총 ${total}건 중 ${maxItems}건만 표기)`,
    );
  }

  return { content: lines.join('\n'), truncatedCount };
};
