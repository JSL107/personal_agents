import { Injectable, Logger } from '@nestjs/common';

import { buildParsePromptWithContext } from '../../../fact-answer/domain/parse-context';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { findHypotheticalMarker } from '../../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import {
  PlainDate,
  plainDateToIso,
  todayInKst,
} from '../../vacation/domain/plain-date';
import { AddApplicationUsecase } from '../application/add-application.usecase';
import { AnswerJobQuestionUsecase } from '../application/answer-job-question.usecase';
import { ListApplicationsUsecase } from '../application/list-applications.usecase';
import { UpdateApplicationUsecase } from '../application/update-application.usecase';
import {
  JOB_APPLICATION_PARSE_SYSTEM_PROMPT,
  parseJobApplicationIntent,
} from '../domain/prompt/job-application-parse.prompt';
import {
  formatAdded,
  formatApplicationList,
  formatHeldJobApplicationWrite,
  formatUpdated,
} from './job-application.formatter';

@Injectable()
export class JobApplicationDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.JOB_APPLICATION;
  private readonly logger = new Logger(JobApplicationDispatcher.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly addApplication: AddApplicationUsecase,
    private readonly updateApplication: UpdateApplicationUsecase,
    private readonly listApplications: ListApplicationsUsecase,
    private readonly answerQuestion: AnswerJobQuestionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const slackUserId = input.slackUserId;
    const today = todayInKst(new Date());
    const completion = await this.modelRouter.route({
      agentType: AgentType.JOB_APPLICATION,
      request: {
        prompt: buildParsePromptWithContext(plainDateToIso(today), input),
        systemPrompt: JOB_APPLICATION_PARSE_SYSTEM_PROMPT,
      },
    });
    const intent = parseJobApplicationIntent(completion.text);

    // 추가·상태 변경은 승인 게이트 없이 바로 기록된다 — 질문·가정형 원문이면 쓰지 않는다.
    if (intent.action === 'ADD' || intent.action === 'UPDATE_STATUS') {
      const marker = findHypotheticalMarker(input.text ?? '');
      if (marker !== null) {
        this.logger.warn(
          `지원 ${intent.action} 보류 — 질문·가정형 원문 (표지=${marker})`,
        );
        // 기록은 하지 않되 질문에는 지원 기록으로 답하고, 기록하려면 할 말을 함께 알린다.
        return this.answer(
          input,
          today,
          { action: 'UNKNOWN', heldWrite: { action: intent.action, marker } },
          formatHeldJobApplicationWrite({ ...intent, action: intent.action }),
        );
      }
    }

    switch (intent.action) {
      case 'ADD': {
        const outcome = await this.addApplication.execute({
          slackUserId,
          company: intent.company!,
          role: intent.role!,
          jdUrl: intent.jdUrl,
          status: intent.status ?? 'APPLIED',
          appliedAt: today,
          deadline: intent.deadline,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatAdded(outcome.result),
        );
      }
      case 'UPDATE_STATUS': {
        const outcome = await this.updateApplication.execute({
          slackUserId,
          ref: intent.ref!,
          status: intent.status!,
          today,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatUpdated(outcome.result),
        );
      }
      case 'LIST': {
        const records = await this.listApplications.execute({ slackUserId });
        return this.toOutcome(0, records, formatApplicationList(records));
      }
      default:
        // 메뉴로 처리할 수 없는 질문 — 고정 예시 문구 대신 지원 기록을 근거로 답한다.
        return this.answer(input, today, { action: 'UNKNOWN' });
    }
  }

  private async answer(
    input: DispatchInput,
    today: PlainDate,
    parsedIntent: Record<string, unknown>,
    notice?: string,
  ): Promise<DispatchOutcome> {
    const outcome = await this.answerQuestion.execute({
      slackUserId: input.slackUserId,
      today,
      text: input.text ?? '',
      priorTurns: input.priorTurns ?? [],
      parsedIntent,
    });
    return {
      agentRunId: outcome.agentRunId,
      output: { ...parsedIntent, usedFallback: outcome.result.usedFallback },
      modelUsed: outcome.modelUsed,
      formattedText:
        notice === undefined
          ? outcome.result.text
          : `${outcome.result.text}\n\n${notice}`,
    };
  }

  private toOutcome(
    agentRunId: number,
    output: unknown,
    formattedText: string,
  ): DispatchOutcome {
    return { agentRunId, output, modelUsed: 'deterministic', formattedText };
  }
}
