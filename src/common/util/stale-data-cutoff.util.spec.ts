import { ConfigService } from '@nestjs/config';

import {
  DEFAULT_STALE_DATA_CUTOFF_DAYS,
  resolveStaleDataCutoff,
} from './stale-data-cutoff.util';

const buildConfig = (env: Record<string, string | undefined>): ConfigService =>
  ({
    get: jest.fn((key: string) => env[key]),
  }) as unknown as ConfigService;

describe('resolveStaleDataCutoff', () => {
  const fixedNow = new Date('2026-04-27T00:00:00.000Z');

  it('env 미설정 시 default 60 일 cutoff', () => {
    const { days, isoDate, isoDateTime } = resolveStaleDataCutoff({
      configService: buildConfig({}),
      now: fixedNow,
    });

    expect(days).toBe(DEFAULT_STALE_DATA_CUTOFF_DAYS);
    expect(isoDate).toBe('2026-02-26');
    expect(isoDateTime).toBe('2026-02-26T00:00:00.000Z');
  });

  it('env 가 양의 정수 문자열이면 그 값을 사용', () => {
    const { days, isoDate } = resolveStaleDataCutoff({
      configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: '14' }),
      now: fixedNow,
    });

    expect(days).toBe(14);
    expect(isoDate).toBe('2026-04-13');
  });

  it('env 가 빈 문자열이면 default fallback', () => {
    const { days } = resolveStaleDataCutoff({
      configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: '   ' }),
      now: fixedNow,
    });
    expect(days).toBe(DEFAULT_STALE_DATA_CUTOFF_DAYS);
  });

  it('env 가 0 / 음수 / 비숫자면 default fallback (방어)', () => {
    expect(
      resolveStaleDataCutoff({
        configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: '0' }),
        now: fixedNow,
      }).days,
    ).toBe(DEFAULT_STALE_DATA_CUTOFF_DAYS);

    expect(
      resolveStaleDataCutoff({
        configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: '-5' }),
        now: fixedNow,
      }).days,
    ).toBe(DEFAULT_STALE_DATA_CUTOFF_DAYS);

    expect(
      resolveStaleDataCutoff({
        configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: 'abc' }),
        now: fixedNow,
      }).days,
    ).toBe(DEFAULT_STALE_DATA_CUTOFF_DAYS);
  });

  it('isoDate 는 YYYY-MM-DD, isoDateTime 은 ISO 8601 UTC 형식', () => {
    const cutoff = resolveStaleDataCutoff({
      configService: buildConfig({ STALE_DATA_CUTOFF_DAYS: '30' }),
      now: new Date('2026-04-27T15:30:00.000Z'),
    });

    expect(cutoff.isoDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cutoff.isoDateTime).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(cutoff.isoDateTime.slice(0, 10)).toBe(cutoff.isoDate);
  });
});
