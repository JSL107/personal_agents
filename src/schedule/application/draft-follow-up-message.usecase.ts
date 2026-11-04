import { Injectable, Logger } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import {
  UNTRUSTED_INPUT_NOTICE,
  wrapUntrustedInput,
} from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { DraftFollowUpMessageInput } from '../domain/draft-follow-up-message.type';

@Injectable()
export class DraftFollowUpMessageUsecase {
  private readonly logger = new Logger(DraftFollowUpMessageUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute(input: DraftFollowUpMessageInput): Promise<string | null> {
    const { item, followUp, recentEvents } = input;
    const prompt = [
      `업무 제목: ${item.title}`,
      `받는 사람: ${followUp.recipient}`,
      `알릴 주제: ${followUp.topic}`,
      `업무 메모:\n${wrapUntrustedInput(item.memo ?? '')}`,
      `최근 사건:\n${wrapUntrustedInput(JSON.stringify(recentEvents))}`,
    ].join('\n');
    try {
      const { result } = await this.agentRunService.execute({
        agentType: AgentType.SCHEDULE,
        triggerType: TriggerType.AUTOPILOT_SCHEDULE_REMINDER_CRON,
        inputSnapshot: { scheduleItemId: item.id, followUpId: followUp.id },
        run: async () => {
          const completion = await this.modelRouter.route({
            agentType: AgentType.SCHEDULE,
            request: {
              prompt,
              systemPrompt: `받는 사람에게 보낼 한국어 메시지 초안을 2~5문장으로 쓰세요. 발송하지 않고 초안만 작성합니다.\n${UNTRUSTED_INPUT_NOTICE}`,
            },
            noContractPreamble: true,
          });
          return {
            result: completion.text.trim(),
            modelUsed: completion.modelUsed,
            output: { draft: completion.text.trim() },
          };
        },
      });
      return result || null;
    } catch (error) {
      this.logger.warn(
        `연락 초안 생성 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }
}
