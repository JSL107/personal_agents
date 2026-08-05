import { Injectable, Logger } from '@nestjs/common';

import {
  AgentRunOutcome,
  AgentRunService,
} from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { EvaluateStudyTopicInput, StudyTopicVerdict } from '../domain/cto.type';
import {
  buildStudyTopicPrompt,
  parseStudyVerdict,
  STUDY_CONCEPT_SYSTEM_PROMPT,
  STUDY_TOOL_SYSTEM_PROMPT,
} from '../domain/prompt/study-topic.prompt';

@Injectable()
export class EvaluateStudyTopicUsecase {
  private readonly logger = new Logger(EvaluateStudyTopicUsecase.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  execute(
    input: EvaluateStudyTopicInput,
  ): Promise<AgentRunOutcome<StudyTopicVerdict>> {
    const { slackUserId, research } = input;
    return this.agentRunService.execute({
      agentType: AgentType.CTO_STUDY,
      triggerType: TriggerType.STUDY_BRIEF_CRON,
      inputSnapshot: {
        slackUserId,
        kind: research.kind,
        topic: research.topic,
      },
      evidence: [
        {
          sourceType: 'HERMES_RESEARCH',
          sourceId: research.topic,
          payload: { sourceUrls: research.sourceUrls },
        },
      ],
      run: async () => {
        const systemPrompt =
          research.kind === 'CONCEPT'
            ? STUDY_CONCEPT_SYSTEM_PROMPT
            : STUDY_TOOL_SYSTEM_PROMPT;
        const completion = await this.modelRouter.route({
          agentType: AgentType.CTO_STUDY,
          request: {
            prompt: buildStudyTopicPrompt(input),
            systemPrompt,
          },
        });
        const output = parseStudyVerdict(completion.text, research.kind);
        this.logger.log(
          `CTO 학습 판정 완료 — kind=${research.kind} topic=${research.topic}`,
        );
        return { result: output, modelUsed: completion.modelUsed, output };
      },
    });
  }
}
