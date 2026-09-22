import { wrapUntrustedInput } from '../../../../common/llm/untrusted-input.util';
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
  // 라벨과 생략 안내는 우리가 만든 문구라 경계 밖에 둔다 — 안에 넣으면 이 섹션이
  // 무엇인지조차 외부 주장으로 읽힌다. 경계 안에는 남이 쓴 값만 넣는다.
  const header = '[GitHub 에서 자동 수집한 assigned 항목]';
  const lines: string[] = [];

  if (tasks.issues.length === 0 && tasks.pullRequests.length === 0) {
    return {
      content: [
        header,
        '(없음 — GitHub 호출은 성공했으나 assigned 항목이 없음)',
      ].join('\n'),
      truncatedCount: 0,
    };
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

  // issue·PR 의 title 과 label 은 레포 기여자가 정하는 값이다. 제목에 지시를 심어
  // 경계를 비껴가지 못하게 항목 전체를 감싼다 (code-reviewer 의 PR 메타와 같은 판단).
  const tail =
    truncatedCount > 0
      ? [`(+${truncatedCount}건 생략 — 총 ${total}건 중 ${maxItems}건만 표기)`]
      : [];

  return {
    content: [header, wrapUntrustedInput(lines.join('\n')), ...tail].join('\n'),
    truncatedCount,
  };
};
