import { calculateStallThresholdDays, isStalled } from './stall';

describe('isStalled', () => {
  it.each([
    {
      name: 'OPS_SUPERVISOR',
      activeDays: 1,
      spanDays: 0,
      idleDays: 19,
      expected: true,
    },
    {
      name: 'CEO',
      activeDays: 13,
      spanDays: 48,
      idleDays: 4,
      expected: false,
    },
    {
      name: 'IMPACT_REPORTER',
      activeDays: 8,
      spanDays: 47,
      idleDays: 5,
      expected: false,
    },
    {
      name: 'CODE_REVIEWER',
      activeDays: 18,
      spanDays: 20,
      idleDays: 0,
      expected: false,
    },
    {
      name: 'PM',
      activeDays: 54,
      spanDays: 58,
      idleDays: 0,
      expected: false,
    },
  ])(
    '$name 실데이터 검산 결과가 $expected 이다',
    ({ activeDays, spanDays, idleDays, expected }) => {
      expect(
        isStalled({
          autonomy: 'AUTONOMOUS',
          activeDays,
          spanDays,
          idleDays,
        }),
      ).toBe(expected);
    },
  );

  it('활성일 2일은 주기 추정 없이 임계값 7일을 쓴다', () => {
    expect(calculateStallThresholdDays({ activeDays: 2, spanDays: 20 })).toBe(
      7,
    );
  });

  it('활성일 3일부터 관측 간격 수로 실행 주기를 추정한다', () => {
    expect(calculateStallThresholdDays({ activeDays: 3, spanDays: 20 })).toBe(
      30,
    );
  });

  it('활성일 3일인 자율 워커도 오래 멈추면 정지로 판정한다', () => {
    expect(
      isStalled({
        autonomy: 'AUTONOMOUS',
        activeDays: 3,
        spanDays: 4,
        idleDays: 40,
      }),
    ).toBe(true);
  });

  it('idleDays가 임계값과 같으면 정지로 보지 않고 1일 초과하면 정지로 본다', () => {
    const input = {
      autonomy: 'AUTONOMOUS' as const,
      activeDays: 4,
      spanDays: 7,
    };

    expect(isStalled({ ...input, idleDays: 7 })).toBe(false);
    expect(isStalled({ ...input, idleDays: 8 })).toBe(true);
  });

  it('수요 기반 워커는 장기간 실행이 없어도 정지로 보지 않는다', () => {
    expect(
      isStalled({
        autonomy: 'ON_DEMAND',
        activeDays: 100,
        spanDays: 100,
        idleDays: 999,
      }),
    ).toBe(false);
  });
});
