import { BuildLedgerUsecase } from '../application/build-ledger.usecase';
import { BuildPresidentBriefingUsecase } from '../application/build-president-briefing.usecase';
import { ConsoleReadService } from '../application/console-read.service';
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
    );

    const result = await controller.getLedger();

    expect(result).toBe(expected);
    expect(buildLedger.execute).toHaveBeenCalledTimes(1);
  });
});
