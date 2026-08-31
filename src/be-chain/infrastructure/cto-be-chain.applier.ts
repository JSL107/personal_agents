import { Injectable, Logger } from '@nestjs/common';

import { Assignment, CtoBeChainPayload } from '../../agent/cto/domain/cto.type';
import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyResult } from '../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../preview-gate/domain/preview-action.type';
import { formatBeChainOutcomes } from '../../slack/format/be-chain.formatter';
import { RunBeChainUsecase } from '../application/run-be-chain.usecase';

// CTO 분배 확정 applier — 사용자가 분배 카드에 "응" 하면 여기로 온다.
// 슬래시(`/be plan|schema|test`)를 손으로 치던 실행 경로의 자연어 대체물.
//
// 멱등성은 PreviewAction 의 status 전이(PENDING → APPLIED)가 보장한다 — 같은 카드로
// 두 번 실행되지 않는다. 개별 worker 실패는 throw 하지 않고 건별 status 로 보고하므로
// 일부만 실패해도 카드는 APPLIED 로 닫힌다(재시도는 /retry-run 으로).
@Injectable()
export class CtoBeChainApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.CTO_BE_CHAIN;

  private readonly logger = new Logger(CtoBeChainApplier.name);

  constructor(
    private readonly runBeChain: RunBeChainUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = this.parsePayload(preview.payload);
    await this.assertLatestAssignment(payload);
    const outcomes = await this.runBeChain.execute({
      assignments: payload.assignments,
      slackUserId: payload.slackUserId,
      parentRunId: payload.ctoAgentRunId,
    });
    const okCount = outcomes.filter(
      (outcome) => outcome.status === 'OK',
    ).length;
    this.logger.log(
      `CTO BE chain 실행 완료 — ctoRunId=${payload.ctoAgentRunId} ok=${okCount}/${outcomes.length}`,
    );
    // 산출물이 문서(plan/proposal/spec)라 외부 재조회로 검증할 artifact 가 없다.
    return { message: formatBeChainOutcomes(outcomes), artifacts: [] };
  }

  // 이 카드가 사용자의 최신 분배인지 확인. 아니면 실행하지 않는다.
  //
  // 카드는 재분배 때마다 새로 열리고 이전 카드는 닫힌다. 그 정리는 best-effort 라
  // (실패해도 새 분배 자체는 보여줘야 한다) 옛 카드가 PENDING 으로 남을 수 있는데,
  // 사용자가 최신 카드를 취소하면 그 옛 카드가 다시 자연어 승인 대상이 된다. 그때
  // 이미 폐기한 분배가 실행되는 걸 여기서 끊는다 (/auto-flow 의 CTO run 대조와 같은 방식).
  private async assertLatestAssignment(
    payload: CtoBeChainPayload,
  ): Promise<void> {
    const latest = await this.agentRunService.findLatestSucceededRun({
      agentType: AgentType.CTO,
      slackUserId: payload.slackUserId,
    });
    if (!latest || latest.id === payload.ctoAgentRunId) {
      return;
    }
    throw new Error(
      `이 분배 카드(CTO run #${payload.ctoAgentRunId})는 최신 분배(#${latest.id})가 아닙니다. 최신 카드에서 실행해주세요.`,
    );
  }

  // payload narrowing — Prisma JSON 에서 unknown 으로 들어온다.
  private parsePayload(payload: unknown): CtoBeChainPayload {
    if (typeof payload !== 'object' || payload === null) {
      throw new Error('CtoBeChainPayload 가 객체가 아닙니다.');
    }
    const obj = payload as Record<string, unknown>;
    if (typeof obj.ctoAgentRunId !== 'number') {
      throw new Error('CtoBeChainPayload.ctoAgentRunId 가 number 가 아닙니다.');
    }
    if (typeof obj.slackUserId !== 'string' || obj.slackUserId.length === 0) {
      throw new Error('CtoBeChainPayload.slackUserId 가 string 이 아닙니다.');
    }
    if (!Array.isArray(obj.assignments)) {
      throw new Error('CtoBeChainPayload.assignments 가 array 가 아닙니다.');
    }
    if (obj.assignments.length === 0) {
      // 보류만 있는 카드도 열린다(담당 드롭다운을 그릴 자리가 필요하다). 그 카드에 실행
      // 버튼은 없지만 자연어 "응" 은 최근 PENDING preview 를 그대로 apply 로 넘기므로
      // 여기로 온다. 통과시키면 아무 일도 하지 않은 채 카드가 APPLIED 로 닫혀,
      // 사용자는 담당을 정할 기회를 잃고 실행됐다고 오해한다. 형식이 깨진 게 아니라
      // 아직 담당이 없는 정상 상태이므로 메시지도 사용자가 읽을 말로 낸다.
      throw new Error(
        '실행할 배정이 없습니다 — 보류 항목에서 담당을 먼저 정해주세요.',
      );
    }
    for (const assignment of obj.assignments) {
      this.assertAssignmentShape(assignment);
    }
    return obj as unknown as CtoBeChainPayload;
  }

  // worker 실행 입력으로 직행하는 필드들이라, 형식이 깨지면 usecase 안에서 TypeError 로
  // 터지기 전에 여기서 명시 에러로 끊는다.
  private assertAssignmentShape(assignment: unknown): void {
    if (typeof assignment !== 'object' || assignment === null) {
      throw new Error('CtoBeChainPayload.assignments 원소가 객체가 아닙니다.');
    }
    const row = assignment as Record<string, unknown>;
    if (typeof row.taskId !== 'string' || typeof row.taskTitle !== 'string') {
      throw new Error(
        'CtoBeChainPayload.assignments 원소에 taskId/taskTitle 이 없습니다.',
      );
    }
    const beAssignment = row.beAssignment as Assignment['beAssignment'];
    if (
      beAssignment !== 'BE' &&
      beAssignment !== 'BE_SCHEMA' &&
      beAssignment !== 'BE_TEST'
    ) {
      throw new Error(
        `CtoBeChainPayload.assignments 의 beAssignment 가 BE/BE_SCHEMA/BE_TEST 가 아닙니다: ${String(row.beAssignment)}`,
      );
    }
  }
}
