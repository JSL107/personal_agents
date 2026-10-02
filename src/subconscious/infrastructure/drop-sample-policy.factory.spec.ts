import { ConfigService } from '@nestjs/config';

import { buildDropSamplePolicy } from './drop-sample-policy.factory';

const makeConfig = (values: Record<string, string | undefined>) =>
  ({
    get: jest.fn((key: string) => values[key]),
  }) as unknown as ConfigService;

describe('buildDropSamplePolicy', () => {
  it('미설정이면 기본 10% · 하루 3건', () => {
    const policy = buildDropSamplePolicy(makeConfig({}));
    expect(policy.rate).toBe(0.1);
    expect(policy.dailyCap).toBe(3);
  });

  it('빈 값은 미설정과 같다', () => {
    const policy = buildDropSamplePolicy(
      makeConfig({
        SUBCONSCIOUS_DROP_SAMPLE_RATE: '',
        SUBCONSCIOUS_DROP_SAMPLE_DAILY_CAP: '',
      }),
    );
    expect(policy.rate).toBe(0.1);
    expect(policy.dailyCap).toBe(3);
  });

  it('설정값을 읽는다 — 0.10 · 공백 포함 · 0 이면 끔', () => {
    expect(
      buildDropSamplePolicy(
        makeConfig({ SUBCONSCIOUS_DROP_SAMPLE_RATE: '0.10' }),
      ).rate,
    ).toBe(0.1);
    expect(
      buildDropSamplePolicy(
        makeConfig({
          SUBCONSCIOUS_DROP_SAMPLE_RATE: ' 0.2 ',
          SUBCONSCIOUS_DROP_SAMPLE_DAILY_CAP: ' 5 ',
        }),
      ),
    ).toEqual(expect.objectContaining({ rate: 0.2, dailyCap: 5 }));
    expect(
      buildDropSamplePolicy(makeConfig({ SUBCONSCIOUS_DROP_SAMPLE_RATE: '0' }))
        .rate,
    ).toBe(0);
  });

  it('hybrid 모드면 비율과 무관하게 끈다 (대소문자 무시)', () => {
    for (const mode of ['hybrid', ' HYBRID ']) {
      expect(
        buildDropSamplePolicy(
          makeConfig({
            SUBCONSCIOUS_GATE_MODE: mode,
            SUBCONSCIOUS_DROP_SAMPLE_RATE: '0.5',
          }),
        ).rate,
      ).toBe(0);
    }
    expect(
      buildDropSamplePolicy(makeConfig({ SUBCONSCIOUS_GATE_MODE: 'shadow' }))
        .rate,
    ).toBe(0.1);
  });

  it('범위 밖 비율은 끄는 쪽으로 접는다', () => {
    expect(
      buildDropSamplePolicy(
        makeConfig({ SUBCONSCIOUS_DROP_SAMPLE_RATE: '1.5' }),
      ).rate,
    ).toBe(0);
  });

  it('주입한 난수를 그대로 쓴다', () => {
    const random = () => 0.42;
    expect(buildDropSamplePolicy(makeConfig({}), random).random).toBe(random);
  });
});
