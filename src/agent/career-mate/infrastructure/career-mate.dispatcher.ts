import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { BuildCareerProfileUsecase } from '../application/build-career-profile.usecase';
import { RenderPortfolioUsecase } from '../application/render-portfolio.usecase';
import { RenderResumeUsecase } from '../application/render-resume.usecase';
import {
  CAREER_MATE_INTENT_SYSTEM_PROMPT,
  parseCareerMateIntent,
} from '../domain/prompt/career-mate-intent.prompt';
import {
  formatPortfolioLink,
  formatProfileSummary,
  formatResume,
  formatUnknownCareerMate,
} from './career-mate.formatter';

@Injectable()
export class CareerMateDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.CAREER_MATE;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly buildProfile: BuildCareerProfileUsecase,
    private readonly renderResume: RenderResumeUsecase,
    private readonly renderPortfolio: RenderPortfolioUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const completion = await this.modelRouter.route({
      agentType: AgentType.CAREER_MATE,
      request: {
        prompt: input.text ?? '',
        systemPrompt: CAREER_MATE_INTENT_SYSTEM_PROMPT,
      },
    });
    const intent = parseCareerMateIntent(completion.text);

    switch (intent.action) {
      case 'BUILD_PROFILE': {
        const outcome = await this.buildProfile.execute({
          slackUserId,
          windowMonths: intent.windowMonths,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatProfileSummary(outcome.result),
        );
      }
      case 'RENDER_RESUME': {
        const result = await this.renderResume.execute({ slackUserId });
        return this.toOutcome(
          result.agentRunId,
          result.profile,
          'deterministic',
          formatResume(result.profile),
        );
      }
      case 'RENDER_PORTFOLIO': {
        const result = await this.renderPortfolio.execute({ slackUserId });
        return this.toOutcome(
          result.agentRunId,
          result,
          'deterministic',
          formatPortfolioLink({ url: result.url }),
        );
      }
      default:
        return this.toOutcome(
          0,
          { action: 'UNKNOWN' },
          'deterministic',
          formatUnknownCareerMate(),
        );
    }
  }

  private toOutcome(
    agentRunId: number,
    output: unknown,
    modelUsed: string,
    formattedText: string,
  ): DispatchOutcome {
    return { agentRunId, output, modelUsed, formattedText };
  }
}
