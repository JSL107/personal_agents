import { Injectable } from '@nestjs/common';

import { AgentRunService } from '../../agent-run/application/agent-run.service';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { wrapUntrustedInput } from '../../common/llm/untrusted-input.util';
import { ModelRouterUsecase } from '../../model-router/application/model-router.usecase';
import { AgentType } from '../../model-router/domain/model-router.type';
import { parseIdeaTriageOutput } from '../domain/idea-triage.parser';
import { IDEA_TRIAGE_OUTPUT_SCHEMA } from '../domain/idea-triage.schema';
import { IdeaJudgement } from '../domain/idea-triage.type';
import { validateIdeaTriageOutput } from '../domain/idea-triage.validator';
import { IDEA_TRIAGE_SYSTEM_PROMPT } from '../domain/prompt/idea-triage-system.prompt';

export interface JudgeIdeaInput {
  channelId: string;
  messageTs: string;
  ideaText: string;
}

export interface IdeaJudgeResult {
  judgement: IdeaJudgement;
  agentRunId: number;
}

const MAX_IDEA_TEXT_CHARS = 4_000;

@Injectable()
export class JudgeIdeaUsecase {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async execute({
    channelId,
    messageTs,
    ideaText,
  }: JudgeIdeaInput): Promise<IdeaJudgeResult> {
    const outcome = await this.agentRunService.execute<IdeaJudgement>({
      agentType: AgentType.IDEA_TRIAGE,
      triggerType: TriggerType.AUTOPILOT_IDEA_TRIAGE_CRON,
      inputSnapshot: { channelId, messageTs },
      run: async ({ recordModelResponse }) => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.IDEA_TRIAGE,
          request: {
            prompt: wrapUntrustedInput(ideaText.slice(0, MAX_IDEA_TEXT_CHARS)),
            systemPrompt: IDEA_TRIAGE_SYSTEM_PROMPT,
            outputSchema: IDEA_TRIAGE_OUTPUT_SCHEMA,
          },
        });
        await recordModelResponse(completion.text);
        const judgement = validateIdeaTriageOutput(
          parseIdeaTriageOutput(completion.text),
        );
        return {
          result: judgement,
          modelUsed: completion.modelUsed,
          output: judgement,
        };
      },
    });
    return { judgement: outcome.result, agentRunId: outcome.agentRunId };
  }
}
