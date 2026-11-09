import { Injectable } from '@nestjs/common';
import { isMatching, P } from 'ts-pattern';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import {
  PlannerProposal,
  PlannerProposalInput,
  ReelFormatPlannerPort,
} from '../../../instagram/domain/port/reel-format-planner.port';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  buildPlannerOutputSchema,
  REELS_FORMAT_PLANNER_SYSTEM_PROMPT,
} from '../domain/prompt/reels-format-planner.prompt';

@Injectable()
export class ProposeReelsFormatUsecase implements ReelFormatPlannerPort {
  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly agentRunService: AgentRunService,
  ) {}

  async propose({
    statsSummary,
    candidateIds,
    reverseChallenge,
  }: PlannerProposalInput): Promise<PlannerProposal> {
    const prompt = `<experiment-data>\n${JSON.stringify({ statsSummary, candidateIds })}\n</experiment-data>`;
    const outcome = await this.agentRunService.execute<PlannerProposal>({
      agentType: AgentType.REELS_FORMAT_PLANNER,
      triggerType: TriggerType.REELS_FORMAT_DECISION,
      inputSnapshot: { statsSummary, candidateIds },
      run: async () => {
        const completion = await this.modelRouter.route({
          agentType: AgentType.REELS_FORMAT_PLANNER,
          request: {
            prompt,
            systemPrompt: REELS_FORMAT_PLANNER_SYSTEM_PROMPT,
            outputSchema: buildPlannerOutputSchema({
              candidateIds,
              reverseChallenge,
            }),
          },
          noContractPreamble: true,
        });
        const proposal = parsePlannerProposal(completion.text);
        return {
          result: proposal,
          modelUsed: completion.modelUsed,
          output: { interpretation: proposal.interpretation },
        };
      },
    });
    return outcome.result;
  }
}

const parsePlannerProposal = (raw: string): PlannerProposal => {
  const value: unknown = JSON.parse(raw);
  if (
    !isMatching(
      {
        candidateId: P.optional(P.string),
        hypothesis: P.string,
        interpretation: P.string,
      },
      value,
    )
  ) {
    throw new Error('릴스 형식 후보 제안의 JSON 형식이 올바르지 않습니다.');
  }
  const proposal: PlannerProposal = {
    hypothesis: value.hypothesis,
    interpretation: value.interpretation,
    raw,
  };
  if (value.candidateId !== undefined) {
    proposal.candidateId = value.candidateId;
  }
  return proposal;
};
