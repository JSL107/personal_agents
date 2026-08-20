import { calculateStallThresholdDays, isStalled } from './stall';

describe('isStalled', () => {
  it.each([
    {
      name: 'OPS_SUPERVISOR',
      activeDays: 1,
      ageDays: 19,
      idleDays: 19,
      expected: true,
    },
    {
      name: 'CEO',
      activeDays: 13,
      ageDays: 52,
      idleDays: 4,
      expected: false,
    },
    {
      name: 'PM',
      activeDays: 54,
      ageDays: 59,
      idleDays: 1,
      expected: false,
    },
    {
      name: 'CODE_REVIEWER',
      activeDays: 18,
      ageDays: 20,
      idleDays: 0,
      expected: false,
    },
  ])(
    '$name 실데이터 검산 결과가 $expected 이다',
    ({ activeDays, ageDays, idleDays, expected }) => {
      expect(
        isStalled({
          autonomy: 'AUTONOMOUS',
          activeDays,
          ageDays,
          idleDays,
        }),
      ).toBe(expected);
    },
  );

  it('활성일 2일은 주기 추정 없이 임계값 7일을 쓴다', () => {
    expect(calculateStallThresholdDays({ activeDays: 2, ageDays: 20 })).toBe(7);
  });

  it('활성일 3일부터 실행 주기를 추정한다', () => {
    expect(calculateStallThresholdDays({ activeDays: 3, ageDays: 20 })).toBe(
      20,
    );
  });

  it('idleDays가 임계값과 같으면 정지로 보지 않고 1일 초과하면 정지로 본다', () => {
    const input = {
      autonomy: 'AUTONOMOUS' as const,
      activeDays: 3,
      ageDays: 7,
    };

    expect(isStalled({ ...input, idleDays: 7 })).toBe(false);
    expect(isStalled({ ...input, idleDays: 8 })).toBe(true);
  });

  it('수요 기반 워커는 장기간 실행이 없어도 정지로 보지 않는다', () => {
    expect(
      isStalled({
        autonomy: 'ON_DEMAND',
        activeDays: 100,
        ageDays: 100,
        idleDays: 999,
      }),
    ).toBe(false);
  });
});
