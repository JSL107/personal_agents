import { Injectable } from '@nestjs/common';

import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import {
  ConsoleAgent,
  ConsoleApproval,
  ConsoleRun,
  ConsoleSnapshot,
} from '../domain/console.type';
import { toConsoleApproval, toConsoleSession } from './console-mappers';
import { bubbleForState, deriveAgentState } from './derive-agent-state';

// 콘솔 관제 스냅샷 조립 — agent-registry(문서 메타) + 활성 런 + 열린 승인을 화면 뷰 타입으로 가공.
// 읽기 전용. 도메인 표현(number id, Date)을 여기서만 뷰 표현(string id, ISO 문자열)으로 변환한다.
@Injectable()
export class ConsoleReadService {
  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly localSessions: LocalSessionService,
  ) {}

  async getSnapshot(): Promise<ConsoleSnapshot> {
    const now = new Date();
    const [activeRuns, openPreviews] = await Promise.all([
      this.agentRunService.findActiveRuns(),
      this.findAllOpenPreviews.execute({ now }),
    ]);

    const activeAgentTypes = new Set(activeRuns.map((run) => run.agentType));

    // v1: PreviewAction 에 agentType 필드가 없어 특정 에이전트로 매핑하지 않는다(null).
    // 개별 카드 AWAITING_APPROVAL 파생은 kind→agentType 매핑 도입 시 활성화(Phase 2).
    const approvals: ConsoleApproval[] = openPreviews.map(toConsoleApproval);
    // approval.agentType 이 채워지는 미래를 대비한 구조 — v1 은 항상 null 이라 빈 집합.
    const openApprovalAgentTypes = new Set(
      approvals
        .map((approval) => approval.agentType)
        .filter((agentType): agentType is string => agentType !== null),
    );

    const agents: ConsoleAgent[] = AGENT_REGISTRY.map((entry) => {
      const state = deriveAgentState({
        hasOpenApproval: openApprovalAgentTypes.has(entry.agentType),
        hasActiveRun: activeAgentTypes.has(entry.agentType),
        // v1 은 활성 런만 조회한다 — 최근 종료/큐/연동 신호는 SSE 이벤트로 실시간 갱신(A7).
        latestFinishedStatus: null,
        isIntegrationBlocked: false,
        isQueuedWaiting: false,
      });
      return {
        agentType: entry.agentType,
        displayName: entry.displayName,
        slashCommands: entry.slashCommands,
        description: entry.description,
        state,
        bubble: bubbleForState(state),
      };
    });

    const runs: ConsoleRun[] = activeRuns.map((run) => ({
      id: String(run.id),
      agentType: run.agentType,
      status: run.status,
      parentId: run.parentId === null ? null : String(run.parentId),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.endedAt === null ? null : run.endedAt.toISOString(),
    }));

    const sessions = this.localSessions.list().map(toConsoleSession);

    return {
      agents,
      runs,
      approvals,
      sessions,
      serverTime: now.toISOString(),
    };
  }
}
