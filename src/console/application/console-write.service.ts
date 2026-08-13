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
    if (pendingTurn?.kind === 'SUGGESTIONS') {
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

  async applyApproval(previewId: string): Promise<void> {
    const slackUserId = this.requireOwner();
    await this.applyPreview.execute({ previewId, slackUserId });
  }

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
