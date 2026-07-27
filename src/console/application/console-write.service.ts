import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentType } from '../../model-router/domain/model-router.type';
import { ApplyPreviewUsecase } from '../../preview-gate/application/apply-preview.usecase';
import { CancelPreviewUsecase } from '../../preview-gate/application/cancel-preview.usecase';
import {
  IDAERI_ROUTER_PORT,
  IdaeriRouterPort,
} from '../../router/domain/idaeri-router.port';
import { ConsoleEventBus } from './console-event-bus.service';

interface ConsoleCommandInput {
  text: string;
  agentTypeHint?: AgentType;
  commandId?: string;
}

// 콘솔 리모컨 write 위임 서비스. 새 로직 없이 owner 를 주입해 기존 usecase 로 넘긴다.
// 지시는 codex 지연(10~40s) 때문에 await 하지 않고 백그라운드 실행 → 진행은 SSE 로 반영.
@Injectable()
export class ConsoleWriteService {
  private readonly logger = new Logger(ConsoleWriteService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(IDAERI_ROUTER_PORT)
    private readonly router: IdaeriRouterPort,
    private readonly applyPreview: ApplyPreviewUsecase,
    private readonly cancelPreview: CancelPreviewUsecase,
    private readonly consoleEvents: ConsoleEventBus,
  ) {}

  sendCommand(input: ConsoleCommandInput): void {
    const slackUserId = this.requireOwner();
    void this.router
      .dispatch({
        source: 'REMOTE_CONSOLE',
        slackUserId,
        text: input.text,
        agentTypeHint: input.agentTypeHint,
      })
      .then((result) => {
        if (input.commandId && result.autoResolvedNotice) {
          this.consoleEvents.publish({
            type: 'command.info',
            commandId: input.commandId,
            message: result.autoResolvedNotice,
          });
        }
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.error(`리모컨 지시 실패: ${reason}`);
        if (input.commandId) {
          this.consoleEvents.publish({
            type: 'command.rejected',
            commandId: input.commandId,
            reason,
          });
        }
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
