import { Injectable } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { DomainStatus } from '../../../common/exception/domain-status.enum';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { PoExpandException } from '../domain/po-expand.exception';
import { GeneratePoOutlineInput, PoOutline } from '../domain/po-expand.type';
import { PoExpandErrorCode } from '../domain/po-expand-error-code.enum';
import { parsePoOutline } from '../domain/prompt/po-expand.parser';
import { PO_EXPAND_OUTLINE_SYSTEM_PROMPT } from '../domain/prompt/po-expand-system.prompt';

@Injectable()
export class GeneratePoOutlineUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    subject,
    slackUserId,
  }: GeneratePoOutlineInput): Promise<AgentRunOutcome<PoOutline>> {
    const trimmed = subject.trim();
    if (trimmed.length === 0) {
      throw new PoExpandException({
        code: PoExpandErrorCode.EMPTY_SUBJECT,
        message:
          '아이디어 한 줄이 비어 있습니다. `/po-expand <아이디어>` 형식으로 입력해주세요.',
        status: DomainStatus.BAD_REQUEST,
      });
    }

    return this.agentRunService.execute({
      agentType: AgentType.PO_EXPAND,
      triggerType: TriggerType.SLACK_COMMAND_PO_EXPAND,
      inputSnapshot: { subject: trimmed, slackUserId },
      evidence: [
        {
          sourceType: 'SLACK_COMMAND_PO_EXPAND',
          sourceId: slackUserId,
          payload: { subject: trimmed },
        },
      ],
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.PO_EXPAND,
          request: {
            prompt: trimmed,
            systemPrompt: PO_EXPAND_OUTLINE_SYSTEM_PROMPT,
          },
        });
        const outline = parsePoOutline(trimmed, completion.text);
        return {
          result: outline,
          modelUsed: completion.modelUsed,
          output: outline,
        };
      },
    });
  }
}
