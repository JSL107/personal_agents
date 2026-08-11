import { GithubPullRequestSummary } from '../../../../github/domain/github.type';

export interface WorklogInputSource {
  periodLabel: string;
  plannedLines: string[];
  mergedPullRequests: GithubPullRequestSummary[];
  mergedPullRequestLimit: number;
  evidenceUnavailableReason: string | null;
}

const formatMergedPullRequest = (
  pullRequest: GithubPullRequestSummary,
): string => {
  const mergedDate = pullRequest.mergedAt?.slice(0, 10) ?? '날짜 미상';
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
