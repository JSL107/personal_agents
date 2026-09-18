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
import { parseScheduleCommand } from '../domain/parse-schedule-command';

@Injectable()
export class ScheduleDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.SCHEDULE;

  constructor(private readonly registerSchedule: RegisterScheduleUsecase) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const today = todayInKst(new Date());
    const command = parseScheduleCommand(input.text ?? '', today);

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

  private toOutcome(output: unknown, formattedText: string): DispatchOutcome {
    return { agentRunId: 0, output, modelUsed: 'deterministic', formattedText };
  }
}
