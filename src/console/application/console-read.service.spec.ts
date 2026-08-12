import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { getKstDayStartAsUtc } from '../../common/util/kst-date.util';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { ConsoleReadService } from './console-read.service';

describe('ConsoleReadService', () => {
  let agentRunService: jest.Mocked<
    Pick<
      AgentRunService,
      'findActiveRuns' | 'findRecentlyFinishedRuns' | 'countSucceededSince'
    >
  >;
  let findAllOpenPreviews: jest.Mocked<
    Pick<FindAllOpenPreviewsUsecase, 'execute'>
  >;
  let localSessions: jest.Mocked<Pick<LocalSessionService, 'list'>>;
  let service: ConsoleReadService;
  // 최근 종료 창(60분) 안에 끝난 런의 id. 콘솔이 "이 완료는 확인했다" 를 식별하는 키로
  // 실려 나간다. 종료 시각이 아닌 이유 — DB 기록과 SSE 발행이 시각을 각각 생성해 어긋난다.
  const finishedRunId = 77;

  beforeEach(() => {
    agentRunService = {
      findActiveRuns: jest.fn().mockResolvedValue([]),
      findRecentlyFinishedRuns: jest.fn().mockResolvedValue([]),
      countSucceededSince: jest.fn().mockResolvedValue([]),
    };
    findAllOpenPreviews = { execute: jest.fn().mockResolvedValue([]) };
    localSessions = { list: jest.fn().mockReturnValue([]) };
    service = new ConsoleReadService(
      agentRunService as unknown as AgentRunService,
      findAllOpenPreviews as unknown as FindAllOpenPreviewsUsecase,
      localSessions as unknown as LocalSessionService,
    );
  });

  it('스냅샷은 레지스트리 전원 + 파생 상태·bubble·serverTime 을 담는다', async () => {
    const snapshot = await service.getSnapshot();

    expect(snapshot.agents).toHaveLength(AGENT_REGISTRY.length);
    expect(snapshot.agents.every((agent) => agent.bubble.length > 0)).toBe(
      true,
    );
    expect(typeof snapshot.serverTime).toBe('string');
    expect(snapshot.runs).toEqual([]);
    expect(snapshot.approvals).toEqual([]);
    expect(snapshot.sessions).toEqual([]);
  });

  it('활성 런이 있는 에이전트는 IN_PROGRESS, 런은 뷰 형태(string id/ISO)로 매핑된다', async () => {
    const startedAt = new Date(Date.now() - 60_000); // 1분 전 — 좀비 임계(30분) 이내
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 7,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'MORNING_BRIEFING_CRON',
        inputSnapshot: null,
      },
    ]);

    const snapshot = await service.getSnapshot();

    const pm = snapshot.agents.find((agent) => agent.agentType === 'PM');
    expect(pm?.state).toBe('IN_PROGRESS');
    expect(pm?.bubble).toBe('아침 계획 짜는 중');
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      id: '7',
      agentType: 'PM',
      parentId: null,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
    });
  });

  it('활성 PR 리뷰의 inputSnapshot 번호를 에이전트 bubble에 반영한다', async () => {
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 273,
        agentType: 'CODE_REVIEWER',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
        triggerType: 'PR_REVIEW_SWEEP',
        inputSnapshot: {
          pullNumber: 273,
          prRef: 'JSL107/personal_agents#273',
        },
      },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'CODE_REVIEWER')
        ?.bubble,
    ).toBe('#273 리뷰 중');
  });

  it('활성 PR 리뷰에 pullNumber가 없으면 기존 진행 상태 문구로 폴백한다', async () => {
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 273,
        agentType: 'CODE_REVIEWER',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
        triggerType: 'PR_REVIEW_SWEEP',
        inputSnapshot: { prRef: 'JSL107/personal_agents#273' },
      },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'CODE_REVIEWER')
        ?.bubble,
    ).toBe('일하는 중…');
  });

  it('같은 에이전트의 활성 런이 여러 개면 startedAt이 가장 최신인 문구를 쓴다', async () => {
    const olderStartedAt = new Date(Date.now() - 2 * 60_000);
    const newerStartedAt = new Date(Date.now() - 60_000);
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 7,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: olderStartedAt,
        endedAt: null,
        triggerType: 'MORNING_BRIEFING_CRON',
        inputSnapshot: null,
      },
      {
        id: 8,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: newerStartedAt,
        endedAt: null,
        triggerType: 'SLACK_COMMAND_TODAY',
        inputSnapshot: null,
      },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.bubble,
    ).toBe('오늘 계획 짜는 중');
  });

  it('최근 실패한 에이전트는 FAILED 로 복원된다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'FAILED', runId: finishedRunId },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('FAILED');
    expect(agentRunService.findRecentlyFinishedRuns).toHaveBeenCalledWith({
      withinMinutes: 60,
    });
  });

  // 이 경로가 예전에는 COMPLETED 를 한 번도 만들지 못했다(조회가 실패만 줘서
  // latestFinishedStatus 에 'SUCCEEDED' 를 넘길 방법이 없었다). 그래서 SSE 로 완료를 받은
  // 뒤 앱을 껐다 켜면 그 에이전트가 "대기중" 으로 되살아났고 요약의 완료 수는 늘 0 이었다.
  it('최근 완료한 에이전트는 COMPLETED 로 복원되고, 런 id 를 함께 실어 보낸다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'SUCCEEDED', runId: finishedRunId },
    ]);

    const snapshot = await service.getSnapshot();

    const pm = snapshot.agents.find((agent) => agent.agentType === 'PM');
    expect(pm?.state).toBe('COMPLETED');
    // 앱이 확인 여부를 판정하려면 "어떤 완료인지" 를 알아야 한다 — 활성 런 목록에는
    // 종료된 런이 없으므로 이 필드가 유일한 식별 수단이다. SSE 의 run.finished 가 싣는
    // run id 와 같은 값이라, 라이브로 확인한 완료가 스냅샷에서 되살아나지 않는다.
    expect(pm?.lastFinishedRunId).toBe(String(finishedRunId));
  });

  it('창 안에 종료 기록이 없으면 lastFinishedRunId 는 null 이다', async () => {
    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')
        ?.lastFinishedRunId,
    ).toBeNull();
  });

  it('같은 창 안에서 성공·실패가 섞여도 각자 자기 결과로 복원된다', async () => {
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'SUCCEEDED', runId: finishedRunId },
      { agentType: 'BE', status: 'FAILED', runId: finishedRunId },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('COMPLETED');
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'BE')?.state,
    ).toBe('FAILED');
    // 창 안에 종료 기록이 없는 에이전트는 대기로 남는다(과표시 방지).
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'CTO')?.state,
    ).toBe('WAITING');
  });

  it('실패 복원보다 활성 런(IN_PROGRESS)이 우선한다', async () => {
    const startedAt = new Date(Date.now() - 60_000);
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 1,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'UNKNOWN_TRIGGER',
        inputSnapshot: null,
      },
    ]);
    agentRunService.findRecentlyFinishedRuns.mockResolvedValue([
      { agentType: 'PM', status: 'FAILED', runId: finishedRunId },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('IN_PROGRESS');
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.bubble,
    ).toBe('일하는 중…');
  });

  it('좀비 임계(30분) 초과 IN_PROGRESS 런은 활성에서 제외한다 (오표시/목록 제거)', async () => {
    const startedAt = new Date(Date.now() - 40 * 60_000); // 40분 전 — 임계 초과(좀비)
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 9,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt,
        endedAt: null,
        triggerType: 'MORNING_BRIEFING_CRON',
        inputSnapshot: null,
      },
    ]);

    const snapshot = await service.getSnapshot();

    const pm = snapshot.agents.find((agent) => agent.agentType === 'PM');
    // 죽은 런을 "일하는 중" 으로 오표시하지 않는다.
    expect(pm?.state).not.toBe('IN_PROGRESS');
    // 좀비 런은 runs 목록에서도 제외된다.
    expect(snapshot.runs).toEqual([]);
  });

  it('열린 승인은 approvals 로 매핑되고 담당 에이전트는 AWAITING_APPROVAL 이 된다', async () => {
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 10,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date(Date.now() - 60_000),
        endedAt: null,
        triggerType: 'MORNING_BRIEFING_CRON',
        inputSnapshot: null,
      },
    ]);
    findAllOpenPreviews.execute.mockResolvedValue([
      {
        id: 'prev-1',
        kind: PREVIEW_KIND.PM_WRITE_BACK,
        previewText: 'PM 계획을 GitHub 에 반영할까요?',
        createdAt: new Date('2026-07-27T01:00:00Z'),
      } as never,
    ]);

    const snapshot = await service.getSnapshot();

    expect(snapshot.approvals).toEqual([
      {
        id: 'prev-1',
        agentType: 'PM',
        title: 'PM 계획을 GitHub 에 반영할까요?',
        createdAt: '2026-07-27T01:00:00.000Z',
      },
    ]);
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('AWAITING_APPROVAL');
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.bubble,
    ).toBe('확인해주세요');
  });

  // 오피스 책상의 서류 더미 높이가 이 값에서 나온다. 창의 시작이 자정이어야 하는 이유는
  // 화면이 하루 단위로 읽히게 하기 위함이다 — 롤링 24시간이면 날이 바뀌어도 어제 새벽
  // 실행이 계속 남아 아침에도 책상이 비지 않는다.
  it('오늘 성공 건수를 doneToday 로 싣고, 창은 자정부터다', async () => {
    agentRunService.countSucceededSince.mockResolvedValue([
      { agentType: 'CODE_REVIEWER', succeeded: 22 },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'CODE_REVIEWER')
        ?.doneToday,
    ).toBe(22);
    // 집계에 없는 사람은 오늘 한 건도 못 끝냈다는 뜻이라 0 이다(undefined 가 아니다 —
    // 앱이 옵셔널로 받으므로 undefined 면 "구버전 서버" 와 구별되지 않는다).
    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.doneToday,
    ).toBe(0);

    // **KST 자정이어야 한다.** 로컬 시각 필드(getHours 등)로 확인하면 안 된다 — 그러면 TZ 가
    // KST 인 개발 기계에서만 통과하고, TZ 가 UTC 인 환경에서는 KST 00:00~08:59 에 끝난 실행이
    // 오늘 집계에서 빠지는 것을 못 잡는다. 경계 자체를 KST 유틸과 대조한다.
    const [call] = agentRunService.countSucceededSince.mock.calls;
    expect(call[0].since.getTime()).toBe(getKstDayStartAsUtc().getTime());
  });

  // 서류 더미는 장식이고 진행 중인 런·승인 대기는 관제 정보다. Promise.all 은 하나가 reject 하면
  // 전체가 reject 하므로, 이 집계를 그냥 끼워 넣으면 장식용 쿼리 한 번의 실패가 관제 화면을
  // 통째로 못 쓰게 만든다(앱은 스냅샷 실패를 nil 로 받아 화면을 갱신하지 않는다).
  it('오늘 성공 집계가 실패해도 스냅샷은 나오고 doneToday 는 0 이 된다', async () => {
    agentRunService.countSucceededSince.mockRejectedValue(
      new Error('DB 연결 끊김'),
    );

    const snapshot = await service.getSnapshot();

    expect(snapshot.agents).toHaveLength(AGENT_REGISTRY.length);
    expect(snapshot.agents.every((agent) => agent.doneToday === 0)).toBe(true);
    // 관제 정보는 집계 실패와 무관하게 그대로 실려야 한다.
    expect(snapshot.serverTime.length).toBeGreaterThan(0);
    expect(snapshot.approvals).toEqual([]);
  });

  it('로컬 세션을 뷰 형태(ISO)로 스냅샷에 담는다', async () => {
    localSessions.list.mockReturnValue([
      {
        sessionId: 's1',
        pid: 42,
        source: 'claude',
        name: 'repo-1',
        cwd: '/repo',
        state: 'active',
        startedAt: new Date('2026-07-27T00:00:00Z'),
        lastActivityAt: null,
      },
    ]);

    const snapshot = await service.getSnapshot();

    expect(snapshot.sessions).toEqual([
      {
        sessionId: 's1',
        pid: 42,
        source: 'claude',
        name: 'repo-1',
        cwd: '/repo',
        state: 'active',
        startedAt: '2026-07-27T00:00:00.000Z',
        lastActivityAt: null,
      },
    ]);
  });
});
