import { Injectable } from '@nestjs/common';

import {
  FillPendingOrdersResult,
  FillPendingOrdersUsecase,
} from '../../../paper-trading/application/fill-pending-orders.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

const formatResult = (result: FillPendingOrdersResult): AutopilotTaskResult => {
  if (result.window === 'BEFORE_OPEN') {
    return {
      skip: true,
      summaryText: '모의투자 체결 시간 창 이전 — 주문 미처리',
    };
  }
  return {
    skip: false,
    summaryText:
      `모의투자 체결 완료 — 시도 ${result.attempted}건, ` +
      `체결 ${result.filled}건, 만료 ${result.expired}건, ` +
      `조회 실패 ${result.lookupFailure}건, ` +
      `당일 봉 대기 ${result.notYetTraded}건`,
  };
};

@Injectable()
export class PaperOrderFillAutopilotTask implements AutopilotTask {
  readonly id = 'paper-order-fill';

  constructor(private readonly fillPendingOrders: FillPendingOrdersUsecase) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    void context;
    const result = await this.fillPendingOrders.execute();
    return formatResult(result);
  }
}
