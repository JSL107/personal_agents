import { WorkSessionDigest } from '../../../local-sessions/domain/work-session-digest';
import { DailyPlanContext } from './daily-plan-context.collector';
import { DailyPlanEvidenceBuilder } from './daily-plan-evidence.builder';

const buildContext = (workSessions: WorkSessionDigest[]): DailyPlanContext => ({
  userText: '오늘 할 일',
  slackUserId: 'U1',
  githubTasks: null,
  previousPlan: null,
  previousWorklog: null,
  eveningRetro: null,
  slackMentions: [],
  notionTasks: [],
  recentPlanSummaries: [],
  inboxItems: [],
  inboxItemIds: [],
  similarPlans: [],
  waitingItems: [],
  workSessions,
  workSessionsSince: new Date('2026-10-14T00:00:00.000Z'),
});

describe('DailyPlanEvidenceBuilder — 로컬 작업 세션', () => {
  it('세션 0개면 기존 evidence 와 동일하다', () => {
    const evidence = new DailyPlanEvidenceBuilder().build(buildContext([]));

    expect(evidence).toEqual([
      {
        sourceType: 'SLACK_COMMAND_TODAY',
        sourceId: 'U1',
        payload: { tasksText: '오늘 할 일' },
      },
    ]);
  });

  it('세션이 있으면 발췌 본문 없이 metadata만 기록한다', () => {
    const session: WorkSessionDigest = {
      source: 'claude',
      sessionId: 'session-1',
      repo: 'personal_agents',
      branch: 'feat/test',
      title: '작업',
      pullRequests: ['JSL107/personal_agents#1'],
      firstPrompt: '민감한 요청',
      lastPrompt: null,
      lastReply: '민감한 응답',
      lastActivityAt: new Date('2026-10-14T09:00:00.000Z'),
    };
    const evidence = new DailyPlanEvidenceBuilder().build(
      buildContext([session]),
    );

    expect(evidence[1]).toEqual({
      sourceType: 'LOCAL_WORK_SESSIONS',
      sourceId: 'local',
      payload: {
        since: '2026-10-14T00:00:00.000Z',
        sessions: [
          {
            source: 'claude',
            sessionId: 'session-1',
            repo: 'personal_agents',
            branch: 'feat/test',
            title: '작업',
            pullRequests: ['JSL107/personal_agents#1'],
            lastActivityAt: '2026-10-14T09:00:00.000Z',
          },
        ],
      },
    });
    expect(JSON.stringify(evidence)).not.toContain('민감한');
  });
});
