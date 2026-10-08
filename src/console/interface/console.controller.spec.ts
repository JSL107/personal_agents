import { BuildActivityUsecase } from '../application/build-activity.usecase';
import { BuildDeliverySummaryUsecase } from '../application/build-delivery-summary.usecase';
import { BuildLedgerUsecase } from '../application/build-ledger.usecase';
import { BuildPresidentBriefingUsecase } from '../application/build-president-briefing.usecase';
import { ConsoleReadService } from '../application/console-read.service';
import { ListDeliveriesUsecase } from '../application/list-deliveries.usecase';
import { ConsoleLedger } from '../domain/ledger.type';
import { ConsoleController } from './console.controller';

describe('ConsoleController.getLedger', () => {
  it('원장 usecase 결과를 그대로 반환한다', async () => {
    const expected: ConsoleLedger = {
      agents: [],
      company: {
        foundedDate: null,
        ageDays: 0,
        totalRuns: 0,
        failedRuns: 0,
        thisWeekRuns: 0,
        lastWeekRunsToSameWeekday: 0,
      },
      serverTime: '2026-08-20T03:00:00.000Z',
    };
    const buildLedger: jest.Mocked<Pick<BuildLedgerUsecase, 'execute'>> = {
      execute: jest.fn().mockResolvedValue(expected),
    };
    const controller = new ConsoleController(
      {} as ConsoleReadService,
      {} as BuildPresidentBriefingUsecase,
      buildLedger as unknown as BuildLedgerUsecase,
      {} as BuildActivityUsecase,
      {} as BuildDeliverySummaryUsecase,
      {} as ListDeliveriesUsecase,
    );

    const result = await controller.getLedger();

    expect(result).toBe(expected);
    expect(buildLedger.execute).toHaveBeenCalledTimes(1);
  });
});

describe('ConsoleController deliveries', () => {
  it('요약 요청의 파싱된 기간을 usecase에 넘긴다', async () => {
    const expected = { days: 14, totals: { sent: 0 } };
    const buildSummary = { execute: jest.fn().mockResolvedValue(expected) };
    const controller = new ConsoleController(
      {} as ConsoleReadService,
      {} as BuildPresidentBriefingUsecase,
      {} as BuildLedgerUsecase,
      {} as BuildActivityUsecase,
      buildSummary as unknown as BuildDeliverySummaryUsecase,
      {} as ListDeliveriesUsecase,
    );

    expect(await controller.getDeliverySummary(14)).toBe(expected);
    expect(buildSummary.execute).toHaveBeenCalledWith(14);
  });

  it('목록 요청의 파싱된 상태·기간·제한을 usecase에 넘긴다', async () => {
    const expected = { status: 'SENT', days: 7, limit: 20, items: [] };
    const listDeliveries = { execute: jest.fn().mockResolvedValue(expected) };
    const controller = new ConsoleController(
      {} as ConsoleReadService,
      {} as BuildPresidentBriefingUsecase,
      {} as BuildLedgerUsecase,
      {} as BuildActivityUsecase,
      {} as BuildDeliverySummaryUsecase,
      listDeliveries as unknown as ListDeliveriesUsecase,
    );

    expect(await controller.getDeliveries('SENT', 7, 20)).toBe(expected);
    expect(listDeliveries.execute).toHaveBeenCalledWith({
      status: 'SENT',
      days: 7,
      limit: 20,
    });
  });
});
