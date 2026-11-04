import {
  normalizeGithubIssueUrl,
  normalizeGithubPullRequestUrl,
} from './github-source-url';
import {
  MatchPullRequestInput,
  MatchPullRequestResult,
} from './match-pull-request.type';
import { ScheduleItemRecord, ScheduleSource } from './schedule.type';

const issueReferences = (body: string, repo: string): Set<string> => {
  const references = new Set<string>();
  for (const found of body.matchAll(
    /https?:\/\/github\.com\/([^\s/#]+\/[^\s/#]+)\/issues\/(\d+)/gi,
  )) {
    references.add(
      normalizeGithubIssueUrl({
        repo: found[1],
        number: Number(found[2]),
      }).toLowerCase(),
    );
  }
  for (const found of body.matchAll(/\b([\w.-]+\/[\w.-]+)#(\d+)\b/g)) {
    references.add(
      normalizeGithubIssueUrl({
        repo: found[1],
        number: Number(found[2]),
      }).toLowerCase(),
    );
  }
  for (const found of body.matchAll(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi,
  )) {
    references.add(
      normalizeGithubIssueUrl({ repo, number: Number(found[1]) }).toLowerCase(),
    );
  }
  return references;
};

const resultFor = (items: ScheduleItemRecord[]): MatchPullRequestResult => {
  if (items.length > 1) {
    return { kind: 'AMBIGUOUS' };
  }
  return items.length === 1
    ? { kind: 'ONE', item: items[0] }
    : { kind: 'NONE' };
};

export const matchPullRequest = ({
  pullRequest,
  items,
}: MatchPullRequestInput): MatchPullRequestResult => {
  const candidates = items.filter(
    (item) => item.source !== ScheduleSource.GITHUB_PR,
  );
  const references = issueReferences(pullRequest.body, pullRequest.repo);
  const issueMatches = candidates.filter(
    (item) =>
      item.source === ScheduleSource.GITHUB_ISSUE &&
      item.sourceKey !== null &&
      item.sourceKey !== undefined &&
      references.has(item.sourceKey.toLowerCase()),
  );
  if (issueMatches.length > 0) {
    return resultFor(issueMatches);
  }

  const url = normalizeGithubPullRequestUrl({
    repo: pullRequest.repo,
    number: pullRequest.number,
  }).toLowerCase();
  const headRef = pullRequest.headRef?.trim();
  const branchPattern = headRef
    ? new RegExp(
        `(^|[^\\w/.-])${headRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\w/.-])`,
        'i',
      )
    : null;
  const matches = candidates.filter((item) => {
    const text = `${item.linkUrl ?? ''}\n${item.memo ?? ''}`;
    return (
      text.toLowerCase().includes(url) || (branchPattern?.test(text) ?? false)
    );
  });
  return resultFor(matches);
};
