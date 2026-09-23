import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { parseTopicSelection } from '../../common/util/topic-selection.util';
import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import { PendingConsoleTurnStore } from './pending-console-turn.store';
import {
  ConsoleChainInput,
  PreconditionChainOrchestrator,
} from './precondition-chain.orchestrator';

interface ConsoleCommandInput {
  text: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

// 콘솔 리모컨 write 위임 서비스. owner 를 주입해 orchestrator 로 넘긴다.
// 지시는 codex 지연(10~40s) + 자동 체이닝 때문에 await 하지 않고 백그라운드 실행 → 진행은 SSE 로 반영.
@Injectable()
export class ConsoleWriteService {
  private readonly logger = new Logger(ConsoleWriteService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly chainOrchestrator: PreconditionChainOrchestrator,
    private readonly applyPreview: ApplyPreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
    private readonly pendingTurns: PendingConsoleTurnStore,
  ) {}

  sendCommand(input: ConsoleCommandInput): void {
    const slackUserId = this.requireOwner();
    const pendingTurn = this.pendingTurns.peek(slackUserId);
    if (pendingTurn?.kind === 'AWAITING_INPUT') {
      this.pendingTurns.consume(slackUserId);
      this.runChain({
        slackUserId,
        agentTypeHint: pendingTurn.agentType,
        text: input.text,
        commandId: input.commandId,
      });
      return;
    }
    if (
      pendingTurn?.kind === 'SUGGESTIONS' &&
      input.agentTypeHint === undefined
    ) {
      const selection = parseTopicSelection(
        input.text,
        pendingTurn.suggestions.length,
      );
      if (selection !== null) {
        const suggestion = pendingTurn.suggestions[selection - 1];
        this.pendingTurns.consume(slackUserId);
        this.runChain({
          slackUserId,
          agentTypeHint: suggestion.agentType,
          text: undefined,
          commandId: input.commandId,
        });
        return;
      }
    }
    this.runChain({
      slackUserId,
      text: input.text,
      agentTypeHint: input.agentTypeHint,
      commandId: input.commandId,
    });
  }

  private runChain(input: ConsoleChainInput): void {
    void this.chainOrchestrator.run(input).catch((error: unknown) => {
      // orchestrator 는 도메인 예외를 SSE 로 처리한다. 여기 도달하면 예기치 못한 내부 오류.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`리모컨 지시 처리 중 예기치 못한 오류: ${reason}`);
    });
  }

  // 승인은 **접수까지만** 기다린다. 실제 반영은 applier 가 도는 시간만큼 걸리는데 그게
  // 분 단위다 — 저녁 경력 반영은 PR 묶음마다 회고를 순차로 돌아 한 묶음에 7~14분, 묶음이
  // 넷이면 30분을 넘는다(2026-09-23 실측: agent_run duration_ms 833210 · 438837).
  // 그 시간을 HTTP 응답으로 기다리게 두면 어떤 타임아웃 값을 잡아도 클라이언트가 먼저 끊고,
  // 사용자는 정상으로 돌고 있는 승인을 실패로 본다. 지시(`sendCommand`)가 같은 이유로 이미
  // 접수형이다.
  //
  // 대신 **접수 전에 거절할 수 있는 것은 여기서 다 거절한다**(`assertApplicable`). 접수 뒤의
  // 실패는 지금 SSE 로 나가지 않으므로, 이 await 가 통과했다는 것이 사용자에게 "눌린 것은
  // 확실하다" 를 뜻해야 한다. 진행 결과는 `approval.resolved` 로 따라온다.
  //
  // **접수 판정은 락을 잡지 않는다.** 거의 동시에 들어온 두 요청이 둘 다 판정을 통과해 둘 다
  // 202 를 받을 수 있다. 그래도 실행은 하나뿐이다 — `execute` 가 락을 동기적으로 잡으므로
  // 뒤엣것은 그 안에서 ALREADY_APPLYING 으로 끊기고, 그 거절은 아래 catch 가 받는다.
  // 판정 단계에서 락까지 잡으려면 잠근 주체가 실행까지 책임져야 해서 `execute` 시그니처가
  // 바뀌고, 그러면 슬랙 경로 두 곳이 함께 흔들린다. 중복 실행은 이미 막히므로 그 값을 치르지
  // 않는다.
  async applyApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.applyPreview.assertApplicable({ previewId, slackUserId });
    void this.applyPreview
      .execute({ previewId, slackUserId })
      .catch((error: unknown) => {
        // 여기 도달하는 것은 applier 실패이거나 위의 동시 요청 거절이다. 사유는
        // `recordApplyFailure` 와 슬랙 카드에 남으므로, 이 로그는 콘솔에서 누른 건이 어디서
        // 죽었는지 잇기 위한 것이다.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `리모컨 승인 반영 실패 preview=${previewId}: ${reason}`,
        );
      });
  }

  // 거절은 그대로 기다린다 — 상태 전이와 카드 정리뿐이라 외부 작업을 돌지 않는다.
  async cancelApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.cancelPreview.execute({ previewId, slackUserId });
  }

  private requireOwner(): string {
    const owner = this.config.get<string>('CONSOLE_OWNER_SLACK_USER_ID');
    if (!owner) {
      throw new ServiceUnavailableException(
        'CONSOLE_OWNER_SLACK_USER_ID 가 설정되지 않아 콘솔 지시/승인을 처리할 수 없습니다.',
      );
    }
    return owner;
  }
}
