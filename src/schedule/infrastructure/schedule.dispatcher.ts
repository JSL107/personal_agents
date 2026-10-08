import { Injectable, Logger } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
import {
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../router/domain/hypothetical-utterance';
import { DispatchInput } from '../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import {
  formatNeedsDate,
  formatNeedsTitle,
  formatScheduleRegistered,
} from '../../slack/format/schedule.formatter';
import { AnswerScheduleQuestionUsecase } from '../application/answer-schedule-question.usecase';
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { todayInKst } from '../domain/parse-due-date';
import {
  mergeScheduleCommands,
  parseScheduleCommand,
  ScheduleCommand,
} from '../domain/parse-schedule-command';
import { PlainDate } from '../domain/schedule.type';
import { isScheduleLookup } from '../domain/schedule-lookup';

interface MergedScheduleCommand {
  command: ScheduleCommand;
  mergedPriorText?: string;
}

@Injectable()
export class ScheduleDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.SCHEDULE;
  private readonly logger = new Logger(ScheduleDispatcher.name);

  constructor(
    private readonly registerSchedule: RegisterScheduleUsecase,
    private readonly answerQuestion: AnswerScheduleQuestionUsecase,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const today = todayInKst(new Date());
    // 조회 문장은 등록 파서에 넣지 않는다 — 문장 전체가 제목으로 읽혀 날짜를 되묻거나("이번주 일정
    // 알려줘") 바로 등록된다("오늘 할 일"). 등록된 일정으로 답한다.
    if (isScheduleLookup(input.text ?? '')) {
      return this.answer(input, today, { kind: 'LOOKUP' });
    }
    const { command, mergedPriorText } = this.withPriorTurn(
      parseScheduleCommand(input.text ?? '', today),
      input,
      today,
    );

    // 되묻기보다 먼저, 합치는 데 쓴 직전 턴까지 본다. "자동차세 등록해도 돼?" 가 날짜 되묻기로
    // 빠진 뒤 다음 턴 "9월 30일" 과 합쳐지면, 이번 원문만 봐서는 질문이었다는 걸 모른다.
    const marker =
      findHypotheticalMarker(input.text ?? '') ??
      (mergedPriorText === undefined
        ? null
        : findHypotheticalMarker(mergedPriorText));
    if (marker !== null) {
      this.logger.warn(
        `일정 ${command.kind} 보류 — 질문·가정형 원문 (표지=${marker})`,
      );
      // 등록은 하지 않되 질문에는 등록된 일정으로 답한다. 제목은 질문 원문에서 뽑혀 "맞아?" 같은
      // 꼬리가 섞일 수 있어 등록 안내에는 예시 문장을 쓴다.
      return this.answer(
        input,
        today,
        { ...command, heldWrite: { action: 'REGISTER', marker } },
        formatHeldWrite('일정을 등록', '9월 30일 자동차세 등록해줘'),
      );
    }

    if (command.kind === 'NEEDS_TITLE') {
      return this.toOutcome(command, formatNeedsTitle());
    }
    if (command.kind === 'NEEDS_DATE') {
      // 되묻기는 Router 의 multi-turn 메모리(5턴·TTL 30분)가 다음 발화를 이 워커로 이어 준다.
      return this.toOutcome(command, formatNeedsDate(command.title));
    }

    const record = await this.registerSchedule.execute({
      slackUserId: input.slackUserId,
      title: command.title,
      dueDate: command.dueDate,
    });
    return this.toOutcome(record, formatScheduleRegistered(record));
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

  /**
   * 되묻기 후속 발화에는 빠졌던 쪽만 담겨 온다("9월 30일"). Router 의 multi-turn 메모리가 그
   * 발화를 이 워커로 이어 주지만 **본문은 새 발화뿐**이라, 직전 SCHEDULE 턴을 다시 읽어 합치지
   * 않으면 제목과 날짜를 번갈아 되물으며 대화가 끝나지 않는다.
   *
   * 현재 발화는 아직 메모리에 없다 — `router-message.handler` 가 dispatch 뒤에 `appendTurn`
   * 하므로, 마지막 SCHEDULE user 턴이 곧 직전 되묻기 턴이다. 합치는 데 쓴 그 턴의 원문도 함께
   * 돌려준다 — 쓰기 가드가 앞 턴이 질문이었는지 봐야 한다.
   */
  private withPriorTurn(
    command: ScheduleCommand,
    input: DispatchInput,
    today: PlainDate,
  ): MergedScheduleCommand {
    if (command.kind === 'REGISTER') {
      return { command };
    }
    const prior = [...(input.priorTurns ?? [])].reverse().find(
      (turn) =>
        turn.agentType === AgentType.SCHEDULE &&
        (turn.role ?? 'user') === 'user' &&
        turn.text.trim().length > 0 &&
        // 조회 질문은 등록의 앞 턴이 아니다 — 합치면 "이번주 일정 알려줘" 가 제목으로 등록된다.
        !isScheduleLookup(turn.text),
    );
    if (!prior) {
      return { command };
    }
    return {
      command: mergeScheduleCommands(
        parseScheduleCommand(prior.text, today),
        command,
      ),
      mergedPriorText: prior.text,
    };
  }

  private toOutcome(output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId: 0, output, modelUsed: 'deterministic', formattedText };
  }
}
