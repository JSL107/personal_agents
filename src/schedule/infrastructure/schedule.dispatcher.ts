import { Injectable } from '@nestjs/common';

import { AgentType } from '../../model-router/domain/model-router.type';
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
import { RegisterScheduleUsecase } from '../application/register-schedule.usecase';
import { todayInKst } from '../domain/parse-due-date';
import {
  mergeScheduleCommands,
  parseScheduleCommand,
  ScheduleCommand,
} from '../domain/parse-schedule-command';
import { PlainDate } from '../domain/schedule.type';

@Injectable()
export class ScheduleDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.SCHEDULE;

  constructor(private readonly registerSchedule: RegisterScheduleUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const today = todayInKst(new Date());
    const command = this.withPriorTurn(
      parseScheduleCommand(input.text ?? '', today),
      input,
      today,
    );

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

  /**
   * 되묻기 후속 발화에는 빠졌던 쪽만 담겨 온다("9월 30일"). Router 의 multi-turn 메모리가 그
   * 발화를 이 워커로 이어 주지만 **본문은 새 발화뿐**이라, 직전 SCHEDULE 턴을 다시 읽어 합치지
   * 않으면 제목과 날짜를 번갈아 되물으며 대화가 끝나지 않는다.
   *
   * 현재 발화는 아직 메모리에 없다 — `router-message.handler` 가 dispatch 뒤에 `appendTurn`
   * 하므로, 마지막 SCHEDULE user 턴이 곧 직전 되묻기 턴이다.
   */
  private withPriorTurn(
    command: ScheduleCommand,
    input: DispatchInput,
    today: PlainDate,
  ): ScheduleCommand {
    if (command.kind === 'REGISTER') {
      return command;
    }
    const prior = [...(input.priorTurns ?? [])]
      .reverse()
      .find(
        (turn) =>
          turn.agentType === AgentType.SCHEDULE &&
          (turn.role ?? 'user') === 'user' &&
          turn.text.trim().length > 0,
      );
    if (!prior) {
      return command;
    }
    return mergeScheduleCommands(
      parseScheduleCommand(prior.text, today),
      command,
    );
  }

  private toOutcome(output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId: 0, output, modelUsed: 'deterministic', formattedText };
  }
}
