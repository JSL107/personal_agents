import { ConfigService } from '@nestjs/config';

import { DropSamplePolicy } from '../domain/port/drop-sample-policy.port';

// 사용자 결정(2026-10-02): 버린 변경의 10% · 하루 3건.
const DEFAULT_DROP_SAMPLE_RATE = 0.1;
const DEFAULT_DROP_SAMPLE_DAILY_CAP = 3;

export const buildDropSamplePolicy = (
  configService: ConfigService,
  random: () => number = Math.random,
): DropSamplePolicy => {
  // hybrid 모드의 drop 은 legacy 가 아니라 Jev 혼합 판정이라 "legacy 가 버린 건" 표본이 아니다.
  const gateMode = configService
    .get<string>('SUBCONSCIOUS_GATE_MODE')
    ?.trim()
    .toLowerCase();
  const rawRate = configService
    .get<string>('SUBCONSCIOUS_DROP_SAMPLE_RATE')
    ?.trim();
  const rate = rawRate ? Number(rawRate) : DEFAULT_DROP_SAMPLE_RATE;
  const rawCap = configService
    .get<string>('SUBCONSCIOUS_DROP_SAMPLE_DAILY_CAP')
    ?.trim();
  const dailyCap =
    rawCap && /^\d+$/.test(rawCap)
      ? parseInt(rawCap, 10)
      : DEFAULT_DROP_SAMPLE_DAILY_CAP;
  // 부팅 검증(app.config.ts)이 범위 밖 값을 먼저 막는다. 여기까지 오면 끄는 쪽으로 접는다.
  const validRate = Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0;
  return {
    rate: gateMode === 'hybrid' ? 0 : validRate,
    dailyCap,
    random,
  };
};
