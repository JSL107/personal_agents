import { AgentRunStatus } from '../../../agent-run/domain/agent-run.type';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { attributeDelay } from './attribute-delay';
import {
  AXIS_APPROVAL,
  AXIS_FAILED_RUN,
  DelayReportInput,
} from './delay-report.type';

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
    // `/retry-run` 은 id 가 필수라, 재시도를 안내하려면 실패 run id 가 실려야 한다.
    expect(verdict.retryRunId).toBe(3);
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
    // 조치 문구는 formatter 가 유형(failureKind)별로 쓴다 — 여기서는 유형 판정만 확인한다.
    expect(verdict.failureKind).toBe('INTEGRATION');
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
    // 조치 문구는 formatter 가 유형(failureKind)별로 쓴다 — 여기서는 유형 판정만 확인한다.
    expect(verdict.failureKind).toBe('INTEGRATION');
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
      unverifiedHigherPriority: [],
      inconclusiveNotes: [],
    });
  });

  it('선택된 원인보다 앞선 축이 확인 불가면 그 사실을 함께 싣는다', () => {
    const verdict = attributeDelay(
      input({
        activeRuns: [activeRun(new Date('2026-09-04T02:57:00.000Z'))],
        unavailableAxes: [AXIS_APPROVAL],
      }),
    );

    expect(verdict.primaryCause).toBe('RUN_IN_PROGRESS');
    expect(verdict.unverifiedHigherPriority).toEqual([AXIS_APPROVAL]);
  });

  it('선택된 원인보다 뒤인 축의 확인 불가는 단정을 막지 않는다', () => {
    const verdict = attributeDelay(
      input({
        openPreviews: [preview()],
        unavailableAxes: [AXIS_FAILED_RUN],
      }),
    );

    expect(verdict.primaryCause).toBe('APPROVAL_WAIT');
    expect(verdict.unverifiedHigherPriority).toEqual([]);
  });

  it('멈춤 의심 run은 결론을 흔드는 신호로 따로 싣는다', () => {
    const verdict = attributeDelay(
      input({ activeRuns: [activeRun(new Date('2026-09-04T02:00:00.000Z'))] }),
    );

    expect(verdict.primaryCause).toBe('NONE');
    expect(verdict.inconclusiveNotes).toHaveLength(1);
  });

  it('일반 실패는 연동·쿼터가 아닌 유형으로 판정한다', () => {
    const verdict = attributeDelay(
      input({
        failedRuns: [failedRun('알 수 없는 오류로 중단됐습니다.')],
        recentlyFinished: [finishedFailure()],
      }),
    );

    expect(verdict.failureKind).toBe('OTHER');
  });
});
