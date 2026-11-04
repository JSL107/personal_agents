import { GithubPullRequestSummary } from '../../github/domain/github.type';
import {
  normalizeGithubIssueUrl,
  normalizeGithubPullRequestUrl,
} from './github-source-url';
import { matchPullRequest } from './match-pull-request';
import {
  ScheduleItemRecord,
  ScheduleSource,
  ScheduleStatus,
} from './schedule.type';

const pullRequest = {
  number: 4,
  repo: 'Acme/API',
  url: 'https://github.com/Acme/API/pull/4',
  body: 'Closes #12',
  headRef: 'feat/payment-api',
  title: 'feat: payment',
  state: 'open',
  mergedAt: null,
  updatedAt: '2026-11-04T00:00:00Z',
  additions: 1,
  deletions: 0,
  changedFilesCount: 1,
} as GithubPullRequestSummary;
const issue = {
  id: 1,
  title: '결제 API',
  source: ScheduleSource.GITHUB_ISSUE,
  sourceKey: 'https://github.com/Acme/API/issues/12',
  status: ScheduleStatus.OPEN,
} as ScheduleItemRecord;

describe('GitHub PR 업무 연결', () => {
  it('이슈와 PR URL을 repo·번호 기준으로 정규화한다', () => {
    expect(normalizeGithubIssueUrl({ repo: 'Acme/API', number: 12 })).toBe(
      'https://github.com/Acme/API/issues/12',
    );
    expect(normalizeGithubPullRequestUrl({ repo: 'Acme/API', number: 4 })).toBe(
      'https://github.com/Acme/API/pull/4',
    );
  });

  it('본문 closes #12를 PR 레포 이슈로 해석해 한 업무에 연결한다', () => {
    expect(matchPullRequest({ pullRequest, items: [issue] })).toEqual({
      kind: 'ONE',
      item: issue,
    });
  });

  it('본문의 명시적 owner/repo# 번호를 다른 레포 이슈에 연결한다', () => {
    const other = {
      ...issue,
      sourceKey: 'https://github.com/Other/Core/issues/12',
    };
    expect(
      matchPullRequest({
        pullRequest: { ...pullRequest, body: 'fixes Other/Core#12' },
        items: [other],
      }),
    ).toEqual({ kind: 'ONE', item: other });
  });

  it('이슈 참조를 우선하고 PR URL 또는 브랜치명으로 메모·링크를 비교한다', () => {
    const linked = {
      ...issue,
      id: 2,
      source: ScheduleSource.MANUAL,
      sourceKey: null,
      linkUrl: pullRequest.url,
    };
    expect(matchPullRequest({ pullRequest, items: [linked] })).toEqual({
      kind: 'ONE',
      item: linked,
    });
    const branch = { ...linked, linkUrl: null, memo: 'feat/payment-api 작업' };
    expect(matchPullRequest({ pullRequest, items: [branch] })).toEqual({
      kind: 'ONE',
      item: branch,
    });
  });

  it('짝이 둘 이상이면 AMBIGUOUS이고 PR 자체 업무는 후보가 아니다', () => {
    expect(
      matchPullRequest({ pullRequest, items: [issue, { ...issue, id: 2 }] }),
    ).toEqual({ kind: 'AMBIGUOUS' });
    expect(
      matchPullRequest({
        pullRequest,
        items: [{ ...issue, source: ScheduleSource.GITHUB_PR }],
      }),
    ).toEqual({ kind: 'NONE' });
  });
});
