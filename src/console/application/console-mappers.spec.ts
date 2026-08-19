import { LocalSession } from '../../local-sessions/domain/local-session.type';
import { AgentType } from '../../model-router/domain/model-router.type';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import {
  PREVIEW_KIND_TO_AGENT,
  toConsoleApproval,
  toConsoleSession,
} from './console-mappers';

describe('toConsoleSession', () => {
  it('Date 를 ISO 문자열로, null 활동을 null 로 매핑한다', () => {
    const local: LocalSession = {
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: new Date('2026-07-27T00:00:00.000Z'),
      lastActivityAt: new Date('2026-07-27T00:00:30.000Z'),
    };

    expect(toConsoleSession(local)).toEqual({
      sessionId: 's1',
      pid: 42,
      source: 'claude',
      name: 'repo-1',
      cwd: '/repo',
      state: 'active',
      startedAt: '2026-07-27T00:00:00.000Z',
      lastActivityAt: '2026-07-27T00:00:30.000Z',
    });
    expect(
      toConsoleSession({ ...local, lastActivityAt: null }).lastActivityAt,
    ).toBeNull();
  });
});

describe('PREVIEW_KIND_TO_AGENT', () => {
  it('모든 PreviewKind 가 매핑을 가진다(누락 없음)', () => {
    for (const kind of Object.values(PREVIEW_KIND)) {
      expect(PREVIEW_KIND_TO_AGENT[kind]).toBeDefined();
    }
  });

  it('대표 매핑이 담당 에이전트를 가리킨다', () => {
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.PM_WRITE_BACK]).toBe(
      AgentType.PM,
    );
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.DOCS_AUDIT_PR]).toBe(
      AgentType.DOCS_AUDIT_OPTIMIZER,
    );
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.EVENING_BLOG_PUBLISH]).toBe(
      AgentType.EVENING_RETRO,
    );
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.BLOG_GITHUB_PUBLISH]).toBe(
      AgentType.BLOG_PUBLISH,
    );
  });

  it('세션 주입 등 에이전트 무관 kind 는 null (오피스 집결 대상 아님)', () => {
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.SESSION_INJECT]).toBeNull();
  });

  it('AI CLI 환경 복원 승인은 특정 에이전트에 귀속하지 않는다', () => {
    expect(PREVIEW_KIND_TO_AGENT[PREVIEW_KIND.AI_CLI_ENV_APPLY]).toBeNull();
  });

  it('toConsoleApproval 이 kind 로 agentType 을 채운다(더 이상 null 아님)', () => {
    const preview = {
      id: 'p1',
      kind: PREVIEW_KIND.PM_WRITE_BACK,
      previewText: 'PR write-back',
      createdAt: new Date('2026-07-30T00:00:00Z'),
      expiresAt: new Date('2026-07-30T01:00:00Z'),
    } as unknown as PreviewAction;

    const approval = toConsoleApproval(preview);

    expect(approval.agentType).toBe(AgentType.PM);
  });
});

describe('toConsoleApproval', () => {
  it('만료 시각을 ISO 문자열로 내려준다', () => {
    const approval = toConsoleApproval({
      id: 'preview-1',
      slackUserId: 'U1',
      kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
      payload: {},
      status: 'PENDING',
      responseUrl: null,
      previewText: '초안 발행',
      expiresAt: new Date('2026-08-19T12:00:00.000Z'),
      createdAt: new Date('2026-08-19T11:00:00.000Z'),
      appliedAt: null,
      cancelledAt: null,
      slackChannelId: null,
      slackMessageTs: null,
    });

    // 화면은 이 두 값의 간격으로 방치 압력을 계산한다. 하나라도 빠지면 TTL 을 알 수 없어
    // 가장 급한 카드(TTL 1시간)에서 신호가 가장 늦게 나온다.
    expect(approval.createdAt).toBe('2026-08-19T11:00:00.000Z');
    expect(approval.expiresAt).toBe('2026-08-19T12:00:00.000Z');
  });
});
