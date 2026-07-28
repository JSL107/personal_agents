import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import { ConsoleReadService } from './console-read.service';

describe('ConsoleReadService', () => {
  let agentRunService: jest.Mocked<Pick<AgentRunService, 'findActiveRuns'>>;
  let findAllOpenPreviews: jest.Mocked<
    Pick<FindAllOpenPreviewsUsecase, 'execute'>
  >;
  let localSessions: jest.Mocked<Pick<LocalSessionService, 'list'>>;
  let service: ConsoleReadService;

  beforeEach(() => {
    agentRunService = { findActiveRuns: jest.fn().mockResolvedValue([]) };
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
    agentRunService.findActiveRuns.mockResolvedValue([
      {
        id: 7,
        agentType: 'PM',
        status: 'IN_PROGRESS',
        parentId: null,
        startedAt: new Date('2026-07-27T00:00:00Z'),
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
      startedAt: '2026-07-27T00:00:00.000Z',
      finishedAt: null,
    });
  });

  it('열린 승인은 approvals 로 매핑된다(title=previewText, createdAt=ISO, agentType=null)', async () => {
    findAllOpenPreviews.execute.mockResolvedValue([
      {
        id: 'prev-1',
        previewText: 'PM 계획을 GitHub 에 반영할까요?',
        createdAt: new Date('2026-07-27T01:00:00Z'),
      } as never,
    ]);

    const snapshot = await service.getSnapshot();

    expect(snapshot.approvals).toEqual([
      {
        id: 'prev-1',
        agentType: null,
        title: 'PM 계획을 GitHub 에 반영할까요?',
        createdAt: '2026-07-27T01:00:00.000Z',
      },
    ]);
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
