import {
  assignArm,
  FormatPolicy,
  parseIsoDate,
  policyProblem,
  serializePolicy,
} from './format-policy';

const policy: FormatPolicy = {
  version: 1,
  frozen: false,
  champion: { early_card: false },
  experiment: {
    id: 'early_card-2026-11-10',
    knob: 'early_card',
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
    expect(policyProblem({ ...policy, champion: { early_card: 0 } })).toBe(
      'champion',
    );
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
      values: { early_card: false },
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
