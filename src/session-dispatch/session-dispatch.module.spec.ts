import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { ConsoleEventBusModule } from '../console/console-event-bus.module';
import { LocalSessionsModule } from '../local-sessions/local-sessions.module';
import { PREVIEW_ACTION_REPOSITORY_PORT } from '../preview-gate/domain/port/preview-action.repository.port';
import {
  PREVIEW_APPLIERS,
  PreviewApplier,
} from '../preview-gate/domain/port/preview-applier.port';
import { PREVIEW_KIND } from '../preview-gate/domain/preview-action.type';
import { PreviewGateModule } from '../preview-gate/preview-gate.module';
import { SessionDispatchService } from './application/session-dispatch.service';
import { SessionInjectPreviewApplier } from './application/session-inject.applier';
import { SessionDispatchModule } from './session-dispatch.module';

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));

describe('SessionDispatchModule wiring', () => {
  it('실제 module 조합이 dispatch service와 SESSION_INJECT applier를 resolve한다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          isGlobal: true,
        }),
        ConsoleEventBusModule,
        PreviewGateModule.forRoot({
          appliers: [SessionInjectPreviewApplier],
          imports: [LocalSessionsModule],
        }),
        SessionDispatchModule,
      ],
    })
      .overrideProvider(PREVIEW_ACTION_REPOSITORY_PORT)
      .useValue({})
      .compile();

    try {
      expect(moduleRef.get(SessionDispatchService)).toBeInstanceOf(
        SessionDispatchService,
      );
      expect(moduleRef.get(SessionInjectPreviewApplier)).toBeInstanceOf(
        SessionInjectPreviewApplier,
      );
      const appliers = moduleRef.get<PreviewApplier[]>(PREVIEW_APPLIERS);
      expect(appliers.map((applier) => applier.kind)).toContain(
        PREVIEW_KIND.SESSION_INJECT,
      );
    } finally {
      await moduleRef.close();
    }
  });
});
