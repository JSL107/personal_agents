import { AgentRunStatus } from '../../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { attributeDelay } from './attribute-delay';
import { DelayReportInput } from './delay-report.type';

const now = new Date('2026-09-04T03:00:00.000Z');

const preview = (overrides: Partial<PreviewAction> = {}): PreviewAction => ({
  id: 'preview-1',
  slackUserId: 'U1',
  kind: 'PM_WRITE_BACK',
  payload: {},
  status: 'PENDING',
  previewText: '대표 승인 카드',
  responseUrl: null,
  expiresAt: new Date('2026-09-04T04:00:00.000Z'),
  createdAt: new Date('2026-09-04T02:00:00.000Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
  ...overrides,
});

const activeRun = (startedAt: Date): ActiveRunSnapshot => ({
  id: 1,
  agentType: 'PM',
  status: AgentRunStatus.IN_PROGRESS,
  parentId: null,
  startedAt,
  endedAt: null,
  triggerType: 'SLACK_COMMAND_TODAY',
  inputSnapshot: null,
});

const failedRun = (reason: string): FailedRunDetail => ({
  agentType: 'PM',
  reason,
  endedAt: new Date('2026-09-04T02:50:00.000Z'),
});

const finishedFailure = (): RecentlyFinishedRun => ({
  agentType: 'PM',
  status: 'FAILED',
  runId: 3,
});

const input = (
  overrides: Partial<DelayReportInput> = {},
): DelayReportInput => ({
  openPreviews: [],
  activeRuns: [],
  failedRuns: [],
  recentlyFinished: [],
  integrations: { githubConfigured: true, notionConfigured: true },
  now,
  unavailableAxes: [],
  ...overrides,
});

describe('attributeDelay', () => {
  it('승인 대기를 진행 중 run과 실패보다 우선 귀속한다', () => {
    const verdict = attributeDelay(
      input({
        openPreviews: [preview()],
        activeRuns: [activeRun(new Date('2026-09-04T02:50:00.000Z'))],
        failedRuns: [failedRun('일반 실패')],
        recentlyFinished: [finishedFailure()],
      }),
    );

    expect(verdict.primaryCause).toBe('APPROVAL_WAIT');
    expect(verdict.detail).toContain('60분째');
  });

  it('29분 이내 run은 진행 중으로, 31분 run은 stale 보조 메모로만 처리한다', () => {
    const fresh = attributeDelay(
      input({ activeRuns: [activeRun(new Date('2026-09-04T02:31:00.000Z'))] }),
    );
    const stale = attributeDelay(
      input({ activeRuns: [activeRun(new Date('2026-09-04T02:29:00.000Z'))] }),
    );

    expect(fresh.primaryCause).toBe('RUN_IN_PROGRESS');
    expect(stale.primaryCause).toBe('NONE');
    expect(stale.secondaryNotes.join('\n')).toContain('멈췄을 가능성');
  });

  it('최신 종료가 실패한 agent의 quota 사유를 미해소 실패로 귀속한다', () => {
    const verdict = attributeDelay(
      input({
        failedRuns: [
          failedRun('사용량 한도 초과 — 2026-09-04 04:00 KST에 리셋'),
        ],
        recentlyFinished: [finishedFailure()],
      }),
    );

    expect(verdict.primaryCause).toBe('UNRESOLVED_FAILURE');
    expect(verdict.detail).toContain('사용량 한도 초과');
    expect(verdict.detail).toContain('04:00 KST');
  });

  it('실측된 GitHub 미연동 문구를 미연동 실패로 귀속하고 해결 행동을 안내한다', () => {
    const verdict = attributeDelay(
      input({
        failedRuns: [
          failedRun(
            'GITHUB_TOKEN 이 .env 에 설정되지 않아 GitHub API 를 호출할 수 없습니다.',
          ),
        ],
        recentlyFinished: [finishedFailure()],
      }),
    );

    expect(verdict.detail).toContain('미연동');
    expect(verdict.detail).toContain('.env에 해당 키를 설정한 뒤 재실행');
  });

  it('실측된 일반 설정 누락 문구도 미연동 실패로 귀속한다', () => {
    const verdict = attributeDelay(
      input({
        failedRuns: [
          failedRun('NOTION_TOKEN 이 .env 에 설정되지 않았습니다 (.env 확인).'),
        ],
        recentlyFinished: [finishedFailure()],
      }),
    );

    expect(verdict.detail).toContain('미연동');
    expect(verdict.detail).toContain('.env에 해당 키를 설정한 뒤 재실행');
  });

  it('미연동은 단독 원인이 아니고 보조 메모로만 알린다', () => {
    const verdict = attributeDelay(
      input({
        integrations: { githubConfigured: false, notionConfigured: false },
      }),
    );

    expect(verdict.primaryCause).toBe('NONE');
    expect(verdict.secondaryNotes.join('\n')).toContain('연동 전');
  });

  it('조회 결과가 모두 비어 있으면 NONE으로 닫는다', () => {
    expect(attributeDelay(input())).toEqual({
      primaryCause: 'NONE',
      detail: '',
      secondaryNotes: [],
      unavailableAxes: [],
    });
  });
});
