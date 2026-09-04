import { formatKstDate } from '../../../../common/util/kst-date.util';
import { GithubPullRequestSummary } from '../../../../github/domain/github.type';
import { DailyPlan } from '../../../pm/domain/pm-agent.type';

export interface WorklogInputSource {
  periodLabel: string;
  plannedLines: string[];
  mergedPullRequests: GithubPullRequestSummary[];
  mergedPullRequestLimit: number;
  evidenceUnavailableReason: string | null;
}

// PM plan 한 건을 회고 입력의 계획 줄로 편다. 일일·주간 두 autopilot task 가 같은 규칙을 쓴다.
//
// blocker 를 반드시 함께 넘긴다 — PM 이 이미 "이게 막고 있다" 고 지목한 유일한 신호라
// 회고의 risks 를 세울 근거가 된다. task 제목만 넘기면 차단 요소가 버젓이 있는 날에도
// 입력에 근거가 없어 회고가 "식별된 위험 없음" 으로 닫힌다.
export const formatPlanLines = (plan: DailyPlan): string[] => {
  const lines = [plan.topPriority, ...plan.morning, ...plan.afternoon].map(
    (task) => `- ${task.title}`,
  );
  if (plan.blocker) {
    lines.push(`- (PM 이 식별한 차단 요소) ${plan.blocker}`);
  }
  return lines;
};

const formatMergedPullRequest = (
  pullRequest: GithubPullRequestSummary,
): string => {
  const mergedDate = pullRequest.mergedAt
    ? (formatKstDate(pullRequest.mergedAt) ?? '날짜 미상')
    : '날짜 미상';
  return `- ${pullRequest.repo}#${pullRequest.number} ${pullRequest.title} (+${pullRequest.additions}/-${pullRequest.deletions}, ${pullRequest.changedFilesCount}파일, merged ${mergedDate})`;
};

const buildEvidenceSection = ({
  mergedPullRequests,
  mergedPullRequestLimit,
  evidenceUnavailableReason,
}: WorklogInputSource): string => {
  if (evidenceUnavailableReason) {
    return [
      '## 실적 조회 불가',
      `- ${evidenceUnavailableReason}`,
      '- 계획만으로 회고하며, 완료·정량 근거를 단정하지 않는다.',
    ].join('\n');
  }

  if (mergedPullRequests.length === 0) {
    return [
      '## 실적 (머지된 PR 0건)',
      '- 이 기간에 머지된 PR 이 없다. 계획 항목의 완료를 단정할 근거가 없다.',
    ].join('\n');
  }

  const visiblePullRequests = mergedPullRequests.slice(
    0,
    mergedPullRequestLimit,
  );
  const evidenceLines = visiblePullRequests.map(formatMergedPullRequest);
  const omittedCount = mergedPullRequests.length - visiblePullRequests.length;
  if (omittedCount > 0) {
    evidenceLines.push(`- (이하 ${omittedCount}건 생략)`);
  } else if (mergedPullRequests.length === mergedPullRequestLimit) {
    // GithubClientPort 는 total_count 를 노출하지 않는다. 조회 limit에 닿으면 추가 결과가
    // 존재할 가능성을 숨기지 않고, 알 수 없는 건수를 임의로 단정하지 않는다.
    evidenceLines.push(
      `- (조회 한도 ${mergedPullRequestLimit}건 도달 — 추가 머지 PR 이 생략되었을 수 있음)`,
    );
  }

  return [
    `## 실적 (머지된 PR ${mergedPullRequests.length}건)`,
    ...evidenceLines,
  ].join('\n');
};

export const buildWorklogInput = (source: WorklogInputSource): string => {
  const plannedLines =
    source.plannedLines.length > 0
      ? source.plannedLines
      : ['- (plan 파싱 불가)'];

  return [
    `[기간] ${source.periodLabel}`,
    '',
    '## 계획 (PM plan — 의도이지 실적이 아니다)',
    ...plannedLines,
    '',
    buildEvidenceSection(source),
  ].join('\n');
};
