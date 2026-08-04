import { Injectable } from '@nestjs/common';

import {
  AGENT_CONTRACTS,
  DEPARTMENT_LABEL,
} from '../../agent-registry/agent-contract';
import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { STALE_RUN_THRESHOLD_MINUTES } from '../../agent-run/domain/agent-run.type';
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

// 재접속 스냅샷 복원 시 "최근 종료 결과"(완료/실패)로 되살릴 시간 창(분).
// SSE 라이브는 이 창과 무관하게 즉시 반영된다.
//
// 이 창은 재접속·재시작으로 방금 끝난 일이 "대기중" 으로 되살아나는 것을 막는 용도라 짧아야
// 한다. 6시간이었을 때는 하루 한 번 도는 에이전트의 그 한 번이 반나절을 완료로 칠하고,
// 5분 주기로 도는 리뷰 스윕은 창이 끊길 틈이 없어 사실상 상시 완료로 보였다.
const FINISHED_SNAPSHOT_WINDOW_MINUTES = 60;

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
    const [activeRuns, openPreviews, recentlyFinished] = await Promise.all([
      this.agentRunService.findActiveRuns(),
      this.findAllOpenPreviews.execute({ now }),
      this.agentRunService.findRecentlyFinishedRuns({
        withinMinutes: FINISHED_SNAPSHOT_WINDOW_MINUTES,
      }),
    ]);

    // run-sweeper(주 1회)가 정리하기 전이라도, 좀비 임계를 넘긴 IN_PROGRESS 는 활성에서 제외한다.
    // (앱 크래시로 고착된 런이 스윕 주기까지 최대 6일 "일하는 중" 으로 오표시되던 것을 즉시 교정.)
    const staleCutoffMs = now.getTime() - STALE_RUN_THRESHOLD_MINUTES * 60_000;
    const freshActiveRuns = activeRuns.filter(
      (run) => run.startedAt.getTime() >= staleCutoffMs,
    );

    const activeAgentTypes = new Set(
      freshActiveRuns.map((run) => run.agentType),
    );

    // kind→agentType 매핑으로 승인 카드를 담당 에이전트에 연결한다(Phase 4 보완).
    const approvals: ConsoleApproval[] = openPreviews.map(toConsoleApproval);
    // approval.agentType 이 kind→agentType 매핑으로 채워져 AWAITING_APPROVAL 파생에 사용된다.
    const openApprovalAgentTypes = new Set(
      approvals
        .map((approval) => approval.agentType)
        .filter((agentType): agentType is string => agentType !== null),
    );
    // agentType → 최신 종료 결과. 예전에는 실패 여부만 Set 으로 들고 있어 성공을 표현할
    // 방법이 없었고, 그래서 이 경로는 COMPLETED 를 한 번도 만들지 못했다(deriveAgentState 의
    // 완료 분기가 도달 불가였다). 결과적으로 앱을 껐다 켜면 방금 완료한 에이전트가
    // "대기중" 으로 되살아나고 요약의 완료 수가 늘 0 이었다 — SSE 로는 완료가 오는데
    // 스냅샷으로 덮이면 사라지던 불일치.
    const latestFinishedByAgentType = new Map(
      recentlyFinished.map((run) => [run.agentType, run] as const),
    );

    const agents: ConsoleAgent[] = AGENT_REGISTRY.map((entry) => {
      const latestFinished =
        latestFinishedByAgentType.get(entry.agentType) ?? null;
      const state = deriveAgentState({
        hasOpenApproval: openApprovalAgentTypes.has(entry.agentType),
        hasActiveRun: activeAgentTypes.has(entry.agentType),
        latestFinishedStatus: latestFinished?.status ?? null,
        isIntegrationBlocked: false,
        isQueuedWaiting: false,
      });
      const contract = AGENT_CONTRACTS[entry.agentType];
      return {
        agentType: entry.agentType,
        displayName: entry.displayName,
        slashCommands: entry.slashCommands,
        description: entry.description,
        state,
        bubble: bubbleForState(state),
        department: contract.department,
        departmentLabel: DEPARTMENT_LABEL[contract.department],
        job: contract.job,
        lastFinishedAt: latestFinished?.endedAt.toISOString() ?? null,
      };
    });

    const runs: ConsoleRun[] = freshActiveRuns.map((run) => ({
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
