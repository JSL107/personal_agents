import { Injectable } from '@nestjs/common';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { AnalyzeJdGapUsecase } from '../application/analyze-jd-gap.usecase';
import { BuildCareerProfileUsecase } from '../application/build-career-profile.usecase';
import { CalibrateResumeUsecase } from '../application/calibrate-resume.usecase';
import { ReflectPrUsecase } from '../application/reflect-pr.usecase';
import { RenderPortfolioUsecase } from '../application/render-portfolio.usecase';
import { RenderResumeUsecase } from '../application/render-resume.usecase';
import {
  CAREER_MATE_INTENT_SYSTEM_PROMPT,
  parseCareerMateIntent,
} from '../domain/prompt/career-mate-intent.prompt';
import {
  formatCalibrationReport,
  formatGapReport,
  formatPortfolioLink,
  formatPrRetro,
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
    private readonly analyzeJdGap: AnalyzeJdGapUsecase,
    private readonly calibrateResume: CalibrateResumeUsecase,
    private readonly reflectPr: ReflectPrUsecase,
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
      case 'ANALYZE_JD_GAP': {
        const outcome = await this.analyzeJdGap.execute({
          slackUserId,
          jdText: input.text ?? '',
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatGapReport(outcome.result),
        );
      }
      case 'CALIBRATE_RESUME': {
        const outcome = await this.calibrateResume.execute({ slackUserId });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatCalibrationReport(outcome.result),
        );
      }
      case 'REFLECT_PR': {
        const outcome = await this.reflectPr.execute({
          slackUserId,
          prText: input.text ?? '',
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.result.modelUsed,
          formatPrRetro(outcome.result),
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
