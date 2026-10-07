import { Injectable, Logger } from '@nestjs/common';

import { buildParsePromptWithContext } from '../../../fact-answer/domain/parse-context';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import {
  formatBalance,
  formatCanceled,
  formatRegistered,
  formatUsageList,
} from '../../../slack/format/vacation.formatter';
import { AnswerVacationQuestionUsecase } from '../application/answer-vacation-question.usecase';
import { CalculateBalanceUsecase } from '../application/calculate-balance.usecase';
import { CancelLeaveUsecase } from '../application/cancel-leave.usecase';
import { ListUsageUsecase } from '../application/list-usage.usecase';
import { RegisterLeaveUsecase } from '../application/register-leave.usecase';
import { PlainDate, plainDateToIso, todayInKst } from '../domain/plain-date';
import {
  NlVacationIntent,
  parseNlVacationIntent,
  VACATION_PARSE_SYSTEM_PROMPT,
} from '../domain/prompt/vacation-parse.prompt';

@Injectable()
export class VacationDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.VACATION;
  private readonly logger = new Logger(VacationDispatcher.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    private readonly calculateBalance: CalculateBalanceUsecase,
    private readonly registerLeave: RegisterLeaveUsecase,
    private readonly listUsage: ListUsageUsecase,
    private readonly cancelLeave: CancelLeaveUsecase,
    private readonly answerQuestion: AnswerVacationQuestionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const asOf = todayInKst(new Date());
    const slackUserId = input.slackUserId;
    const completion = await this.modelRouter.route({
      agentType: AgentType.VACATION,
      request: {
        prompt: buildParsePromptWithContext(plainDateToIso(asOf), input),
        systemPrompt: VACATION_PARSE_SYSTEM_PROMPT,
      },
    });
    const intent = parseNlVacationIntent(completion.text);

    // 등록·취소는 승인 게이트 없이 바로 기록된다 — 질문·가정형 원문이면 쓰지 않는다.
    if (intent.action === 'REGISTER' || intent.action === 'CANCEL') {
      const marker = findHypotheticalMarker(input.text ?? '');
      if (marker !== null) {
        this.logger.warn(
          `휴가 ${intent.action} 보류 — 질문·가정형 원문 (표지=${marker})`,
        );
        // 기록은 하지 않되 질문에는 답한다("3일 쓰면 며칠 남아?" → 잔여 계산) — 등록하려면 어떻게
        // 말하면 되는지도 함께 알린다.
        return this.answer(
          input,
          asOf,
          { action: 'UNKNOWN', heldWrite: { action: intent.action, marker } },
          this.formatHeldWrite(intent),
        );
      }
    }

    switch (intent.action) {
      case 'REGISTER': {
        const outcome = await this.registerLeave.execute({
          slackUserId,
          startDate: intent.startDate!,
          endDate: intent.endDate!,
          memo: intent.memo,
          fraction: intent.fraction,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatRegistered(outcome.result),
        );
      }
      case 'LIST': {
        const records = await this.listUsage.execute({ slackUserId });
        return this.toOutcome(0, records, formatUsageList(records));
      }
      case 'CANCEL': {
        const outcome = await this.cancelLeave.execute({
          slackUserId,
          usageId: intent.usageId!,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatCanceled(outcome.result),
        );
      }
      case 'BALANCE': {
        const outcome = await this.calculateBalance.execute({
          slackUserId,
          asOf,
        });
        return this.toOutcome(
          outcome.agentRunId,
          outcome.result,
          formatBalance(outcome.result),
        );
      }
      default:
        // 메뉴로 처리할 수 없는 질문 — 슬래시 사용법 대신 휴가 기록을 근거로 답한다.
        return this.answer(input, asOf, { action: 'UNKNOWN' });
    }
  }

  private async answer(
    input: DispatchInput,
    asOf: PlainDate,
    parsedIntent: Record<string, unknown>,
    notice?: string,
  ): Promise<DispatchOutcome> {
    const outcome = await this.answerQuestion.execute({
      slackUserId: input.slackUserId,
      asOf,
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

  // 다시 말할 문장에 파서가 읽은 날짜·번호를 넣는다 — 파서는 직전 턴을 보지 않아서
  // "휴가 등록해줘" 만 다시 보내면 날짜가 없어 사용법 안내로 빠진다.
  private formatHeldWrite(intent: NlVacationIntent): string {
    if (intent.action === 'CANCEL') {
      return formatHeldWrite(
        '휴가를 취소',
        `휴가 ${intent.usageId}번 취소해줘`,
      );
    }
    const start = plainDateToIso(intent.startDate!);
    const end = plainDateToIso(intent.endDate!);
    const period = start === end ? start : `${start}~${end}`;
    // 반차를 빼면 안내대로 다시 말한 요청이 종일 휴가로 기록된다.
    const kind = intent.fraction === 0.5 ? '반차' : '휴가';
    return formatHeldWrite('휴가를 기록', `${period} ${kind} 등록해줘`);
  }

  private toOutcome(
    agentRunId: number,
    output: unknown,
    formattedText: string,
  ): DispatchOutcome {
    return { agentRunId, output, modelUsed: 'deterministic', formattedText };
  }
}
