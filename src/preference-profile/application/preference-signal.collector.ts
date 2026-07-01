import { Inject, Injectable, Logger } from '@nestjs/common';

import { PreferenceSignal } from '../domain/preference-signal.type';
import {
  PREFERENCE_SIGNAL_SOURCES,
  PreferenceSignalSource,
} from '../domain/port/preference-signal-source.port';

@Injectable()
export class PreferenceSignalCollector {
  private readonly logger = new Logger(PreferenceSignalCollector.name);

  constructor(
    @Inject(PREFERENCE_SIGNAL_SOURCES)
    private readonly sources: PreferenceSignalSource[],
  ) {}

  async collect(
    ownerUserId: string,
    sinceMs: number,
    cap: number,
  ): Promise<PreferenceSignal[]> {
    const collected: PreferenceSignal[] = [];
    for (const source of this.sources) {
      try {
        const signals = await source.fetch(ownerUserId, sinceMs);
        collected.push(...signals);
      } catch (error) {
        this.logger.warn(
          `신호 소스 ${source.name} 수집 실패(skip): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return collected.slice(0, cap);
  }
}
