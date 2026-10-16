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
      run: async ({ recordModelResponse }) => {
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
        // 파싱 전에 남겨야 형식 위반으로 실패한 회차에도 원문이 남는다(2026-10-16 run 9130 은 원문이 없어 원인을 못 확정했다).
        await recordModelResponse(completion.text);
        const output = parseStudyVerdict(completion.text, research.kind);
        this.logger.log(
          `CTO 학습 판정 완료 — kind=${research.kind} topic=${research.topic}`,
        );
        return { result: output, modelUsed: completion.modelUsed, output };
      },
    });
  }
}
