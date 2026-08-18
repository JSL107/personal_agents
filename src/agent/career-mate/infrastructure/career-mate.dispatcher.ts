import { Injectable } from '@nestjs/common';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { AnalyzeJdGapUsecase } from '../application/analyze-jd-gap.usecase';
import { AuditResumeUsecase } from '../application/audit-resume.usecase';
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
  formatProfileSummary,
  formatPrRetro,
  formatResume,
  formatResumeAudit,
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
    private readonly auditResume: AuditResumeUsecase,
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
          // slash 는 사용자가 직접 요청 → 전체 리포트를 그대로 전달(단일 메시지).
          formatCalibrationReport(outcome.result).full,
        );
      }
      case 'AUDIT_RESUME': {
        const outcome = await this.auditResume.execute({
          slackUserId,
          triggerType: TriggerType.SLACK_MENTION_CAREER_MATE,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.modelUsed,
          formatResumeAudit(outcome.result).full,
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
