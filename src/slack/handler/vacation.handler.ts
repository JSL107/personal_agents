import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { CalculateBalanceUsecase } from '../../agent/vacation/application/calculate-balance.usecase';
import { CancelLeaveUsecase } from '../../agent/vacation/application/cancel-leave.usecase';
import { ListUsageUsecase } from '../../agent/vacation/application/list-usage.usecase';
import { RegisterLeaveUsecase } from '../../agent/vacation/application/register-leave.usecase';
import {
  parseVacationCommand,
  VacationCommand,
} from '../../agent/vacation/domain/command-parser';
import { PlainDate, todayInKst } from '../../agent/vacation/domain/plain-date';
import { VacationException } from '../../agent/vacation/domain/vacation.exception';
import { SlackHandler } from '../domain/port/slack-handler.port';
import {
  formatBalance,
  formatCanceled,
  formatInvalidCommand,
  formatRegistered,
  formatUsageList,
} from '../format/vacation.formatter';

// /휴가 — 결정론 계산 슬래시. 3초 ack 후 결과로 replace_original.
@Injectable()
export class VacationHandler implements SlackHandler {
  private readonly logger = new Logger(VacationHandler.name);

  constructor(
    private readonly calculateBalance: CalculateBalanceUsecase,
    private readonly registerLeave: RegisterLeaveUsecase,
    private readonly listUsage: ListUsageUsecase,
    private readonly cancelLeave: CancelLeaveUsecase,
  ) {}

  register(app: App): void {
    app.command('/휴가', async ({ ack, command, respond }) => {
      await ack();
      const asOf = todayInKst(new Date());
      const slackUserId = command.user_id;
      const parsed = parseVacationCommand(command.text ?? '');

      try {
        const text = await this.run(parsed, slackUserId, asOf);
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text,
        });
      } catch (error) {
        const message =
          error instanceof VacationException
            ? error.message
            : '휴가 처리 중 오류가 발생했습니다.';
        this.logger.error(`/휴가 실패: ${String(error)}`);
        await respond({
          response_type: 'ephemeral',
          replace_original: true,
          text: message,
        });
      }
    });
  }

  private async run(
    parsed: VacationCommand,
    slackUserId: string,
    asOf: PlainDate,
  ): Promise<string> {
    switch (parsed.action) {
      case 'BALANCE': {
        const outcome = await this.calculateBalance.execute({
          slackUserId,
          asOf,
        });
        return formatBalance(outcome.result);
      }
      case 'REGISTER': {
        const outcome = await this.registerLeave.execute({
          slackUserId,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          memo: parsed.memo,
          asOf,
        });
        return formatRegistered(outcome.result);
      }
      case 'LIST': {
        const records = await this.listUsage.execute({ slackUserId });
        return formatUsageList(records);
      }
      case 'CANCEL': {
        const outcome = await this.cancelLeave.execute({
          slackUserId,
          usageId: parsed.usageId,
          asOf,
        });
        return formatCanceled(outcome.result);
      }
      default:
        return formatInvalidCommand();
    }
  }
}
