import { Injectable } from '@nestjs/common';

import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { buildParsePromptWithContext } from '../../../fact-answer/domain/parse-context';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { plainDateToIso, todayInKst } from '../../vacation/domain/plain-date';
import { AnalyzeJdGapUsecase } from '../application/analyze-jd-gap.usecase';
import { AnswerCareerQuestionUsecase } from '../application/answer-career-question.usecase';
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
    private readonly answerQuestion: AnswerCareerQuestionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const completion = await this.modelRouter.route({
      agentType: AgentType.CAREER_MATE,
      request: {
        prompt: buildParsePromptWithContext(
          plainDateToIso(todayInKst(new Date())),
          input,
        ),
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
        return {
          ...this.toOutcome(
            result.agentRunId,
            result.profile,
            'deterministic',
            formatResume(result.profile),
          ),
          reusedAgentRun: result.reusedAgentRun,
        };
      }
      case 'RENDER_PORTFOLIO': {
        const result = await this.renderPortfolio.execute({ slackUserId });
        return {
          ...this.toOutcome(
            result.agentRunId,
            result,
            'deterministic',
            formatPortfolioLink({ url: result.url }),
          ),
          reusedAgentRun: result.reusedAgentRun,
        };
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
          // 사람이 Slack 에서 답을 기다리는 경로 — 포트폴리오 본문 반영은 링크를 준 뒤
          // 백그라운드로 마저 한다. 응답 문구(formatPrRetro)도 "갱신 중" 으로 맞춰 뒀다.
          portfolioSync: 'defer',
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          outcome.result.modelUsed,
          formatPrRetro(outcome.result),
        );
      }
      default: {
        // 메뉴로 처리할 수 없는 질문 — 고정 안내 대신 저장된 프로필을 근거로 답한다.
        const outcome = await this.answerQuestion.execute({
          slackUserId,
          text: input.text ?? '',
          priorTurns: input.priorTurns ?? [],
          parsedIntent: { action: 'UNKNOWN' },
        });
        return this.toOutcome(
          outcome.agentRunId,
          { action: 'UNKNOWN', usedFallback: outcome.result.usedFallback },
          outcome.modelUsed,
          outcome.result.text,
        );
      }
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
