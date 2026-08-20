import { GithubPullRequestSummary } from '../../../github/domain/github.type';
import { DailyPlan, TaskItem } from '../../pm/domain/pm-agent.type';
import {
  buildPlanRealityFacts,
  hasPlanRealityMismatch,
  PlanRealityFact,
} from './plan-reality.diff';
import { PoShadowContext } from './po-shadow.type';

const buildTask = ({
  id,
  title,
  source = 'GITHUB',
}: Pick<TaskItem, 'id' | 'title'> &
  Partial<Pick<TaskItem, 'source'>>): TaskItem => ({
  id,
  title,
  source,
  subtasks: [],
  isCriticalPath: false,
});

const buildPlan = ({
  topPriority,
  morning = [],
  afternoon = [],
}: {
  topPriority: TaskItem;
  morning?: TaskItem[];
  afternoon?: TaskItem[];
}): DailyPlan => ({
  topPriority,
  morning,
  afternoon,
  varianceAnalysis: { rolledOverTasks: [], analysisReasoning: '' },
  blocker: null,
  estimatedHours: 8,
  reasoning: '',
});

const emptyContext = (): PoShadowContext => ({
  assignedTasks: { issues: [], pullRequests: [] },
  waitingItems: [],
  activePullRequests: [],
  newMentions: [],
  notionTasks: [],
  failedRunsToday: [],
  mergedPullRequests: [],
  degradedSources: [],
});

const buildMergedPullRequest = ({
  number,
  repo = 'acme/app',
}: {
  number: number;
  repo?: string;
}): GithubPullRequestSummary => ({
  number,
  title: '업로드 차단',
  body: '',
  repo,
  url: `https://github.com/${repo}/pull/${number}`,
  state: 'merged',
  mergedAt: '2026-08-19T02:10:00.000Z',
  updatedAt: '2026-08-19T02:10:00.000Z',
  additions: 1,
  deletions: 1,
  changedFilesCount: 1,
});

// 담당 목록은 open 만 돌려준다. 계획한 PR 을 오전에 머지하면 목록에서 사라지므로,
// 머지 확인이 없으면 "계획대로 끝낸 항목" 이 곧바로 미확인 지적으로 뒤집힌다.
describe('buildPlanRealityFacts — 계획대로 끝낸 항목', () => {
  it('담당 목록에 없어도 계획 이후 머지됐으면 완료로 본다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#264', title: '업로드 차단' }),
    });
    const context = emptyContext();
    context.mergedPullRequests = [buildMergedPullRequest({ number: 264 })];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts).toHaveLength(1);
    expect(facts[0].kind).toBe('PLANNED_MERGED');
    expect(facts[0].id).toBe('merged:acme/app#264');
    expect(hasPlanRealityMismatch(facts)).toBe(false);
  });

  it('repository 표기가 어긋나도 번호가 하나면 머지로 맞춘다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: '#264', title: '업로드 차단' }),
    });
    const context = emptyContext();
    context.mergedPullRequests = [buildMergedPullRequest({ number: 264 })];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts[0].kind).toBe('PLANNED_MERGED');
  });

  it('머지 목록에도 없으면 못 찾음으로 남긴다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#264', title: '업로드 차단' }),
    });
    const context = emptyContext();
    context.mergedPullRequests = [buildMergedPullRequest({ number: 999 })];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts[0].kind).toBe('PLANNED_NOT_FOUND');
    expect(hasPlanRealityMismatch(facts)).toBe(true);
  });

  it('담당 목록 조회가 실패한 회차에는 부재를 근거로 삼지 않는다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#264', title: '업로드 차단' }),
    });
    const context = emptyContext();
    context.assignedTasks = null;
    context.degradedSources = ['GitHub 담당 목록'];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts).toEqual([]);
    expect(hasPlanRealityMismatch(facts)).toBe(false);
  });
});

describe('buildPlanRealityFacts — 카드 한 줄 길이', () => {
  it('긴 멘션 본문은 라벨에서 잘라낸다', () => {
    const plan = buildPlan({
      topPriority: buildTask({
        id: 'user-1',
        title: '성과 정리',
        source: 'USER_INPUT',
      }),
    });
    const context = emptyContext();
    context.newMentions = [
      {
        channelId: 'C123',
        channelName: 'release',
        channelType: 'public_channel',
        authorUserId: 'U456',
        ts: '1787072400.000100',
        text: '가'.repeat(120),
        permalink: 'https://slack.com/archives/C123/p1787072400000100',
      },
    ];

    const facts = buildPlanRealityFacts(plan, context);
    const mentionFact = facts.find((fact) => fact.kind === 'UNPLANNED_MENTION');

    expect(mentionFact).toBeDefined();
    expect(mentionFact!.label.length).toBeLessThanOrEqual(48);
    expect(mentionFact!.label).toContain('…');
  });
});

describe('buildPlanRealityFacts', () => {
  it('정확한 owner/repository#number 계획은 담당 GitHub 항목과 일치시킨다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#12', title: '검색 오류 수정' }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [
        {
          number: 12,
          title: '검색 오류 수정',
          repo: 'acme/app',
          url: 'https://github.com/acme/app/issues/12',
          labels: [],
          updatedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      pullRequests: [],
    };

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts).toEqual([]);
  });

  it('형식이 올바른 계획 ID는 exact key가 다르면 #number로 재매칭하지 않는다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#12', title: '검색 오류 수정' }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [
        {
          number: 12,
          title: '다른 저장소 이슈',
          repo: 'other/repo',
          url: 'https://github.com/other/repo/issues/12',
          labels: [],
          updatedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      pullRequests: [],
    };

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.map((fact) => fact.id)).toEqual([
      'not-found:acme/app#12',
      'unplanned:other/repo#12',
    ]);
  });

  it('형식이 어긋난 계획 ID의 #number가 유일하면 GitHub 항목과 일치시킨다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'issue #27', title: '결제 오류 수정' }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [],
      pullRequests: [
        {
          number: 27,
          title: '결제 오류 수정',
          repo: 'acme/pay',
          url: 'https://github.com/acme/pay/pull/27',
          draft: false,
          updatedAt: '2026-08-19T00:00:00.000Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    };

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts).toEqual([]);
  });

  it('같은 #number의 실제 항목이 여러 개면 추측하지 않고 계획 누락과 미계획 할당을 남긴다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'PR #9', title: '릴리즈 준비' }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [
        {
          number: 9,
          title: 'API 오류',
          repo: 'acme/api',
          url: 'https://github.com/acme/api/issues/9',
          labels: [],
          updatedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      pullRequests: [
        {
          number: 9,
          title: '웹 릴리즈',
          repo: 'acme/web',
          url: 'https://github.com/acme/web/pull/9',
          draft: false,
          updatedAt: '2026-08-19T00:00:00.000Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    };

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.map((fact) => fact.id)).toEqual([
      'not-found:PR #9',
      'unplanned:acme/api#9',
      'unplanned:acme/web#9',
    ]);
  });

  it('담당 실제 목록에 없는 GitHub 계획은 PLANNED_NOT_FOUND로 남긴다', () => {
    const task = buildTask({ id: 'acme/app#404', title: '사라진 이슈 확인' });
    task.url = 'https://github.com/acme/app/issues/404';
    const plan = buildPlan({ topPriority: task });

    const facts = buildPlanRealityFacts(plan, emptyContext());

    expect(facts).toEqual([
      {
        id: 'not-found:acme/app#404',
        kind: 'PLANNED_NOT_FOUND',
        label: '사라진 이슈 확인',
        detail: '담당 목록·머지 목록 어디에도 없음',
        url: 'https://github.com/acme/app/issues/404',
      },
    ]);
  });

  it('GitHub 외 계획은 PLANNED_UNVERIFIABLE로 남긴다', () => {
    const task = buildTask({
      id: 'notion-page-1',
      title: '정책 문서 정리',
      source: 'NOTION',
    });
    const plan = buildPlan({ topPriority: task });

    const facts = buildPlanRealityFacts(plan, emptyContext());

    expect(facts).toEqual([
      {
        id: 'unverifiable:notion-page-1',
        kind: 'PLANNED_UNVERIFIABLE',
        label: '정책 문서 정리',
        detail: '외부 상태로 자동 확인 불가',
      },
    ]);
  });

  it('대기 URL을 원본 담당 PR과 결합해 안정 키와 대기 이유를 남긴다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#31', title: '업로드 개선' }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [],
      pullRequests: [
        {
          number: 31,
          title: '업로드 개선',
          repo: 'acme/app',
          url: 'https://github.com/acme/app/pull/31',
          draft: false,
          updatedAt: '2026-08-19T00:00:00.000Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    };
    context.waitingItems = [
      {
        title: '업로드 개선',
        url: 'https://github.com/acme/app/pull/31',
        reason: '리뷰 0건 · 마지막 활동 3일 전',
      },
    ];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts).toEqual([
      {
        id: 'stalled:acme/app#31',
        kind: 'PLANNED_STALLED',
        label: '업로드 개선',
        detail: '리뷰 0건 · 마지막 활동 3일 전',
        url: 'https://github.com/acme/app/pull/31',
      },
    ]);
  });

  it('계획에 없는 담당 이슈와 PR을 UNPLANNED_ASSIGNED로 남긴다', () => {
    const plan = buildPlan({
      topPriority: buildTask({
        id: 'user-task',
        title: '사용자 인터뷰',
        source: 'USER_INPUT',
      }),
    });
    const context = emptyContext();
    context.assignedTasks = {
      issues: [
        {
          number: 4,
          title: 'API 문서 보완',
          repo: 'acme/api',
          url: 'https://github.com/acme/api/issues/4',
          labels: [],
          updatedAt: '2026-08-19T00:00:00.000Z',
        },
      ],
      pullRequests: [
        {
          number: 8,
          title: '로그 필드 추가',
          repo: 'acme/api',
          url: 'https://github.com/acme/api/pull/8',
          draft: false,
          updatedAt: '2026-08-19T00:00:00.000Z',
          requestedReviewers: [],
          isApproved: false,
        },
      ],
    };

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.filter((fact) => fact.kind === 'UNPLANNED_ASSIGNED')).toEqual([
      {
        id: 'unplanned:acme/api#4',
        kind: 'UNPLANNED_ASSIGNED',
        label: 'API 문서 보완',
        detail: '계획에 없는 담당 항목',
        url: 'https://github.com/acme/api/issues/4',
      },
      {
        id: 'unplanned:acme/api#8',
        kind: 'UNPLANNED_ASSIGNED',
        label: '로그 필드 추가',
        detail: '계획에 없는 담당 항목',
        url: 'https://github.com/acme/api/pull/8',
      },
    ]);
  });

  it('계획 이후 새 멘션은 channelId와 ts로 안정 키를 만든다', () => {
    const plan = buildPlan({
      topPriority: buildTask({
        id: 'user-task',
        title: '사용자 인터뷰',
        source: 'USER_INPUT',
      }),
    });
    const context = emptyContext();
    context.newMentions = [
      {
        channelId: 'C123',
        channelName: 'release',
        channelType: 'public_channel',
        authorUserId: 'U456',
        ts: '1787072400.000100',
        text: '배포 승인 부탁드립니다',
        permalink: 'https://slack.com/archives/C123/p1787072400000100',
      },
    ];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.find((fact) => fact.kind === 'UNPLANNED_MENTION')).toEqual({
      id: 'mention:C123:1787072400.000100',
      kind: 'UNPLANNED_MENTION',
      label: '배포 승인 부탁드립니다',
      detail: 'release에서 계획 이후 새 멘션',
      url: 'https://slack.com/archives/C123/p1787072400000100',
    });
  });

  it('실패 런은 agentType과 endedAt으로 안정 키를 만들고 이유를 남긴다', () => {
    const plan = buildPlan({
      topPriority: buildTask({
        id: 'user-task',
        title: '사용자 인터뷰',
        source: 'USER_INPUT',
      }),
    });
    const context = emptyContext();
    context.failedRunsToday = [
      {
        agentType: 'BE_TEST',
        reason: '테스트 타임아웃',
        endedAt: new Date('2026-08-19T04:30:00.000Z'),
      },
    ];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.find((fact) => fact.kind === 'WORKER_FAILED')).toEqual({
      id: 'failed:BE_TEST:2026-08-19T04:30:00.000Z',
      kind: 'WORKER_FAILED',
      label: 'BE_TEST 워커',
      detail: '실패 — 테스트 타임아웃',
    });
  });

  it('topPriority, morning, afternoon에 같은 ID가 반복돼도 계획 사실은 한 번만 만든다', () => {
    const duplicatedTask = buildTask({ id: 'acme/app#77', title: '중복 계획' });
    const plan = buildPlan({
      topPriority: duplicatedTask,
      morning: [duplicatedTask],
      afternoon: [duplicatedTask],
    });

    const facts = buildPlanRealityFacts(plan, emptyContext());

    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe('not-found:acme/app#77');
  });

  it('GitHub 수집 실패 시 GitHub 비교는 건너뛰고 독립 사실은 유지한다', () => {
    const plan = buildPlan({
      topPriority: buildTask({ id: 'acme/app#12', title: '검색 오류 수정' }),
      morning: [
        buildTask({
          id: 'notion-page-1',
          title: '정책 문서 정리',
          source: 'NOTION',
        }),
      ],
    });
    const context = emptyContext();
    context.assignedTasks = null;
    context.newMentions = [
      {
        channelId: 'C123',
        channelName: 'release',
        channelType: 'public_channel',
        authorUserId: 'U456',
        ts: '1787072400.000100',
        text: '배포 승인 부탁드립니다',
        permalink: undefined,
      },
    ];
    context.failedRunsToday = [
      {
        agentType: 'BE_TEST',
        reason: '테스트 타임아웃',
        endedAt: new Date('2026-08-19T04:30:00.000Z'),
      },
    ];

    const facts = buildPlanRealityFacts(plan, context);

    expect(facts.map((fact) => fact.id)).toEqual([
      'unverifiable:notion-page-1',
      'mention:C123:1787072400.000100',
      'failed:BE_TEST:2026-08-19T04:30:00.000Z',
    ]);
  });
});

describe('hasPlanRealityMismatch', () => {
  it('완료와 확인 불가 사실만 있으면 어긋남이 아니고 정의된 이상 종류는 어긋남이다', () => {
    const quietFacts: PlanRealityFact[] = [
      {
        id: 'merged:acme/app#1',
        kind: 'PLANNED_MERGED',
        label: '배포 PR 완료',
        detail: '명시적 완료 신호 확인',
      },
      {
        id: 'unverifiable:user-task',
        kind: 'PLANNED_UNVERIFIABLE',
        label: '사용자 인터뷰 확인 불가',
        detail: '외부 상태로 자동 확인 불가',
      },
    ];
    const mismatchFacts: PlanRealityFact[] = [
      {
        id: 'stalled:acme/app#2',
        kind: 'PLANNED_STALLED',
        label: '배포 대기',
        detail: '리뷰 대기',
      },
    ];

    expect(hasPlanRealityMismatch(quietFacts)).toBe(false);
    expect(hasPlanRealityMismatch(mismatchFacts)).toBe(true);
  });
});
