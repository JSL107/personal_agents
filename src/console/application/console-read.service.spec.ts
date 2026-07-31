import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { ConsoleReadService } from './console-read.service';

describe('ConsoleReadService', () => {
  let agentRunService: jest.Mocked<
    Pick<AgentRunService, 'findActiveRuns' | 'findRecentlyFailedRuns'>
  >;
  let findAllOpenPreviews: jest.Mocked<
    Pick<FindAllOpenPreviewsUsecase, 'execute'>
  >;
  let localSessions: jest.Mocked<Pick<LocalSessionService, 'list'>>;
  let service: ConsoleReadService;

  beforeEach(() => {
    agentRunService = {
      findActiveRuns: jest.fn().mockResolvedValue([]),
      findRecentlyFailedRuns: jest.fn().mockResolvedValue([]),
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
      },
    ]);

    const snapshot = await service.getSnapshot();

    const pm = snapshot.agents.find((agent) => agent.agentType === 'PM');
    expect(pm?.state).toBe('IN_PROGRESS');
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.runs[0]).toMatchObject({
      id: '7',
      agentType: 'PM',
      parentId: null,
      startedAt: startedAt.toISOString(),
      finishedAt: null,
    });
  });

  it('최근 실패한 에이전트는 FAILED 로 복원된다', async () => {
    agentRunService.findRecentlyFailedRuns.mockResolvedValue([
      { agentType: 'PM' },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('FAILED');
    expect(agentRunService.findRecentlyFailedRuns).toHaveBeenCalledWith({
      withinMinutes: 360,
    });
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
      },
    ]);
    agentRunService.findRecentlyFailedRuns.mockResolvedValue([
      { agentType: 'PM' },
    ]);

    const snapshot = await service.getSnapshot();

    expect(
      snapshot.agents.find((agent) => agent.agentType === 'PM')?.state,
    ).toBe('IN_PROGRESS');
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
