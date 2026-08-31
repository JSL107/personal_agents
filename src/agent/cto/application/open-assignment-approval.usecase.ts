import { Injectable, Logger } from '@nestjs/common';

import { CancelPreviewUsecase } from '../../../preview-gate/application/cancel-preview.usecase';
import { CreatePreviewUsecase } from '../../../preview-gate/application/create-preview.usecase';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { PREVIEW_KIND } from '../../../preview-gate/domain/preview-action.type';
import { AssignmentOutput, CtoBeChainPayload } from '../domain/cto.type';

// 분배 결과가 나온 뒤 실행 승인 카드를 여는 단계.
// 카드가 열려 있어야 사용자가 "응" 한 마디로 BE worker 를 실행할 수 있다 (RouterMessageHandler
// 의 자연어 Y/N 인터셉트가 사용자의 최근 PENDING preview 를 집어 apply 로 넘긴다).
//
// TTL 1시간 — 분배를 보고 재배정 대화를 몇 번 주고받는 시간을 감안한 값. 만료 후 "응" 은
// ApplyPreviewUsecase 가 EXPIRED 로 거절하므로 오래된 분배가 뒤늦게 실행되지 않는다.
const APPROVAL_TTL_MS = 60 * 60 * 1000;

export interface OpenAssignmentApprovalInput {
  slackUserId: string;
  ctoAgentRunId: number;
  output: AssignmentOutput;
}

@Injectable()
export class OpenAssignmentApprovalUsecase {
  private readonly logger = new Logger(OpenAssignmentApprovalUsecase.name);

  constructor(
    private readonly createPreview: CreatePreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
  ) {}

  // 연 카드의 previewId. 보여줄 것이 하나도 없을 때만 열지 않고 null.
  // 호출자는 이 id 로 배정·보류 드롭다운과 실행 버튼이 달린 카드를 그린다.
  //
  // 배정 0건이어도 보류가 있으면 연다 — 카드가 없으면 보류 항목의 담당 드롭다운을 그릴
  // 자리가 없어, 정작 "전부 보류" 인 회차에만 사용자가 카드에서 결정할 수 없게 된다.
  // (CTO 는 8/23~8/31 아홉 회차 연속 배정 0건이었다.) 실행할 배정이 없는 카드에는
  // 실행 버튼을 그리지 않고, 자연어 "응" 으로 들어온 빈 실행은 applier 가 거절한다.
  async execute({
    slackUserId,
    ctoAgentRunId,
    output,
  }: OpenAssignmentApprovalInput): Promise<string | null> {
    if (
      output.assignments.length === 0 &&
      output.unassignedTasks.length === 0
    ) {
      return null;
    }
    await this.supersedePriorApprovals(slackUserId);
    const payload: CtoBeChainPayload = {
      ctoAgentRunId,
      slackUserId,
      assignments: output.assignments,
      // 카드 재렌더(드롭다운 변경) 시 CTO run 재조회 없이 같은 화면을 다시 그리기 위한 표시 정보.
      ctoSummary: output.ctoSummary,
      unassignedTasks: output.unassignedTasks,
    };
    const preview = await this.createPreview.execute({
      slackUserId,
      kind: PREVIEW_KIND.CTO_BE_CHAIN,
      payload,
      previewText:
        output.assignments.length > 0
          ? `CTO 분배 ${output.assignments.length}건 실행 대기 (CTO run #${ctoAgentRunId})`
          : `CTO 보류 ${output.unassignedTasks.length}건 담당 대기 (CTO run #${ctoAgentRunId})`,
      // 카드 메시지는 호출자가 직접 보낸다 (슬래시는 respond, 자연어는 say).
      responseUrl: null,
      ttlMs: APPROVAL_TTL_MS,
    });
    return preview.id;
  }

  // 재배정할 때마다 카드가 하나씩 쌓이면, 사용자가 최신 카드를 "아니" 로 닫는 순간 그 이전
  // 카드가 다시 최신 PENDING 이 된다. 그 상태에서 "응" 하면 사용자가 이미 버린 옛 분배가
  // 실행된다. 새 카드를 열기 전에 같은 사용자의 열린 분배 카드를 모두 닫아 그 경로를 막는다.
  private async supersedePriorApprovals(slackUserId: string): Promise<void> {
    try {
      const open = await this.findAllOpenPreviews.execute({});
      const stale = open.filter(
        (preview) =>
          preview.kind === PREVIEW_KIND.CTO_BE_CHAIN &&
          preview.slackUserId === slackUserId,
      );
      for (const preview of stale) {
        await this.cancelPreview.execute({
          previewId: preview.id,
          slackUserId,
        });
      }
      if (stale.length > 0) {
        this.logger.log(
          `CTO 재배정 — 이전 분배 승인 카드 ${stale.length}건 취소 (user=${slackUserId}).`,
        );
      }
    } catch (error: unknown) {
      // 정리 실패가 새 분배 자체를 막을 이유는 없다 — 새 카드가 최신이라 승인 흐름은 정상 동작한다.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `이전 분배 승인 카드 정리 실패(무시) user=${slackUserId}: ${message}`,
      );
    }
  }
}
