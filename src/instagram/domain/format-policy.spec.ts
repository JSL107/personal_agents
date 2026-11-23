import {
  assignArm,
  DEFAULT_FORMAT_VALUES,
  fillMissingKnobs,
  FormatKnob,
  FormatPolicy,
  parseIsoDate,
  policyProblem,
  serializePolicy,
} from './format-policy';

const policy: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { ...DEFAULT_FORMAT_VALUES, early_card: false },
  experiment: {
    id: 'early_card-2026-11-10',
    knob: FormatKnob.EARLY_CARD,
    challenger: true,
    start: '2026-11-10',
  },
};

describe('format-policy', () => {
  it('정상 정책을 허용하고 잘못된 날짜를 거부한다', () => {
    expect(policyProblem(policy)).toBe('');
    expect(parseIsoDate('2028-02-29')).not.toBeNull();
    expect(parseIsoDate('2026-02-30')).toBeNull();
    expect(parseIsoDate('2026-2-3')).toBeNull();
    expect(parseIsoDate('20261110')).toBeNull();
  });

  it('정책 키와 타입 및 실험 모양 오류를 구분한다', () => {
    expect(policyProblem({ ...policy, extra: true })).toBe('keys');
    expect(policyProblem({ ...policy, version: true })).toBe('types');
    expect(
      policyProblem({
        ...policy,
        champion: { ...DEFAULT_FORMAT_VALUES, early_card: 0 },
      }),
    ).toBe('champion');
    expect(
      policyProblem({
        ...policy,
        experiment: { ...policy.experiment, start: '2026-02-30' },
      }),
    ).toBe('experiment');
  });

  it('시작 전과 frozen 정책에서는 champion이고 실험 중 두 날짜는 양 군으로 갈린다', () => {
    expect(assignArm({ policy: policy, day: '2026-11-09' })).toEqual({
      arm: 'champion',
      values: { ...DEFAULT_FORMAT_VALUES, early_card: false },
      inExperiment: false,
    });
    const arms = [
      assignArm({ policy: policy, day: '2026-11-10' }).arm,
      assignArm({ policy: policy, day: '2026-11-11' }).arm,
    ];
    expect(arms.sort()).toEqual(['challenger', 'champion']);
    expect(
      assignArm({ policy: { ...policy, frozen: true }, day: '2026-11-10' })
        .inExperiment,
    ).toBe(false);
  });

  it('정책을 고정 키 순서와 개행으로 직렬화한다', () => {
    expect(serializePolicy(policy)).toBe(`${JSON.stringify(policy)}\n`);
  });
});

describe('fillMissingKnobs', () => {
  it('아는 손잡이만 있으면 빠진 것을 기본값으로 채우고 기존 값과 실험은 그대로 둔다', () => {
    const old = {
      version: 1,
      frozen: false,
      champion: { early_card: true },
      experiment: null,
    };
    const filled = fillMissingKnobs(old);
    expect(filled).toEqual({
      ...old,
      champion: { ...DEFAULT_FORMAT_VALUES, early_card: true },
    });
    expect(policyProblem(filled)).toBe('');
    expect(old.champion).toEqual({ early_card: true });
  });
  it('모르는 손잡이가 섞였거나 모양이 다르면 손대지 않아 거부되게 둔다', () => {
    const unknown = {
      ...policy,
      champion: { early_card: false, color: 'red' },
    };
    expect(fillMissingKnobs(unknown)).toBe(unknown);
    expect(policyProblem(fillMissingKnobs(unknown))).toBe('champion');
    for (const value of [null, [], 'broken', { ...policy, champion: [] }]) {
      expect(fillMissingKnobs(value)).toBe(value);
    }
  });
  it('처음부터 있던 early_card 가 없으면 손상으로 보고 채우지 않는다', () => {
    for (const champion of [{}, { segments: 2 }]) {
      const damaged = { ...policy, champion };
      expect(fillMissingKnobs(damaged)).toBe(damaged);
      expect(policyProblem(fillMissingKnobs(damaged))).toBe('champion');
    }
  });
});
