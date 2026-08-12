import { Injectable, Logger } from '@nestjs/common';

import {
  AGENT_CONTRACTS,
  DEPARTMENT_LABEL,
} from '../../agent-registry/agent-contract';
import { AGENT_REGISTRY } from '../../agent-registry/agent-registry';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { STALE_RUN_THRESHOLD_MINUTES } from '../../agent-run/domain/agent-run.type';
import { AgentSucceededCountRow } from '../../agent-run/domain/port/agent-run.repository.port';
import { getKstDayStartAsUtc } from '../../common/util/kst-date.util';
import { LocalSessionService } from '../../local-sessions/application/local-session.service';
import { FindAllOpenPreviewsUsecase } from '../../preview-gate/application/find-all-open-previews.usecase';
import {
  ConsoleAgent,
  ConsoleAgentState,
  ConsoleApproval,
  ConsoleRun,
  ConsoleSnapshot,
} from '../domain/console.type';
import { activityBubble } from './agent-activity-bubble';
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
  private readonly logger = new Logger(ConsoleReadService.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly localSessions: LocalSessionService,
  ) {}

  async getSnapshot(): Promise<ConsoleSnapshot> {
    const now = new Date();
    const [activeRuns, openPreviews, recentlyFinished, succeededToday] =
      await Promise.all([
        this.agentRunService.findActiveRuns(),
        this.findAllOpenPreviews.execute({ now }),
        this.agentRunService.findRecentlyFinishedRuns({
          withinMinutes: FINISHED_SNAPSHOT_WINDOW_MINUTES,
        }),
        this.countDoneToday(),
      ]);

    // run-sweeper(주 1회)가 정리하기 전이라도, 좀비 임계를 넘긴 IN_PROGRESS 는 활성에서 제외한다.
    // (앱 크래시로 고착된 런이 스윕 주기까지 최대 6일 "일하는 중" 으로 오표시되던 것을 즉시 교정.)
    const staleCutoffMs = now.getTime() - STALE_RUN_THRESHOLD_MINUTES * 60_000;
    const freshActiveRuns = activeRuns.filter(
      (run) => run.startedAt.getTime() >= staleCutoffMs,
    );

    const latestActiveRunByAgentType = new Map<
      string,
      (typeof freshActiveRuns)[number]
    >();
    for (const run of freshActiveRuns) {
      const latestRun = latestActiveRunByAgentType.get(run.agentType);
      if (latestRun === undefined || run.startedAt > latestRun.startedAt) {
        latestActiveRunByAgentType.set(run.agentType, run);
      }
    }
    const activeAgentTypes = new Set(latestActiveRunByAgentType.keys());

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
    // 오늘 성공 건수. 집계에 없는 agentType 은 오늘 한 건도 못 끝냈다는 뜻이라 0 이다.
    const succeededTodayByAgentType = new Map(
      succeededToday.map((row) => [row.agentType, row.succeeded] as const),
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
      const activeRun = latestActiveRunByAgentType.get(entry.agentType);
      const bubble =
        state === ConsoleAgentState.IN_PROGRESS && activeRun !== undefined
          ? (activityBubble(activeRun) ?? bubbleForState(state))
          : bubbleForState(state);
      return {
        agentType: entry.agentType,
        displayName: entry.displayName,
        slashCommands: entry.slashCommands,
        description: entry.description,
        state,
        bubble,
        department: contract.department,
        departmentLabel: DEPARTMENT_LABEL[contract.department],
        job: contract.job,
        lastFinishedRunId:
          latestFinished === null ? null : String(latestFinished.runId),
        doneToday: succeededTodayByAgentType.get(entry.agentType) ?? 0,
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

  // 오늘(KST 자정 이후) 성공으로 끝낸 실행을 agentType 별로 센다. 책상 위 서류 더미의 재료다.
  //
  // **KST 경계를 서버 timezone 과 무관하게 만든다.** setHours(0,0,0,0) 은 프로세스 로컬
  // timezone 기준이라, TZ 가 UTC 인 환경에서는 KST 00:00~08:59 에 끝난 실행이 오늘 집계에서
  // 빠지고 전날 것이 책상에 남는다. 같은 리포지토리의 다른 집계도 이 유틸을 쓴다.
  //
  // **실패해도 스냅샷을 죽이지 않는다.** Promise.all 은 하나가 reject 하면 전체가 reject 하는데,
  // 이 집계는 장식(서류 더미)을 위한 것이다. 그 쿼리 하나가 실패해서 진행 중인 런·승인 대기까지
  // 못 보게 되면 장식이 관제를 죽이는 셈이다. 앱이 doneToday 를 옵셔널로 받는 것과 같은 이유다.
  //
  // 빈 배열로 떨어질 때 반드시 로그를 남긴다 — 조용히 0장이 되면 "오늘 아무도 일을 안 했다" 와
  // 구별되지 않아 집계가 고장 난 것을 아무도 모른다.
  private async countDoneToday(): Promise<AgentSucceededCountRow[]> {
    try {
      return await this.agentRunService.countSucceededSince({
        since: getKstDayStartAsUtc(),
      });
    } catch (error) {
      this.logger.warn(
        `오늘 처리량 집계 실패 — 서류 더미 없이 스냅샷을 낸다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }
}
