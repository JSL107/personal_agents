import { ReviewFinding } from '../../agent/code-reviewer/domain/code-reviewer.type';
import { isRepoAllowed, planPublication } from './publish-policy';

const finding = (
  severity: ReviewFinding['severity'],
  body: string,
): ReviewFinding => ({ category: 'STYLE', severity, body });

describe('isRepoAllowed', () => {
  it('allowlist 에 있으면 허용', () => {
    expect(
      isRepoAllowed('JSL107/personal_agents', 'JSL107/personal_agents,a/b'),
    ).toBe(true);
  });

  it('공백이 섞여도 매칭한다', () => {
    expect(
      isRepoAllowed('JSL107/personal_agents', ' a/b , JSL107/personal_agents '),
    ).toBe(true);
  });

  it('allowlist 밖이면 거부', () => {
    expect(isRepoAllowed('other/repo', 'JSL107/personal_agents')).toBe(false);
  });

  it('allowlist 미설정이면 거부 — 게시는 명시적 옵트인만', () => {
    expect(isRepoAllowed('JSL107/personal_agents', undefined)).toBe(false);
    expect(isRepoAllowed('JSL107/personal_agents', '')).toBe(false);
    expect(isRepoAllowed('JSL107/personal_agents', '   ')).toBe(false);
  });
});

describe('planPublication', () => {
  it('MUST_FIX → MISSING_TEST → NICE_TO_HAVE 순으로 정렬한다', () => {
    const plan = planPublication({
      findings: [
        finding('NICE_TO_HAVE', 'n'),
        finding('MUST_FIX', 'm'),
        finding('MISSING_TEST', 't'),
      ],
      max: 3,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['m', 't', 'n']);
    expect(plan.dropped).toEqual([]);
  });

  it('상한을 넘으면 뒤쪽을 dropped 로 분리한다', () => {
    const plan = planPublication({
      findings: [
        finding('NICE_TO_HAVE', 'n1'),
        finding('MUST_FIX', 'm1'),
        finding('NICE_TO_HAVE', 'n2'),
      ],
      max: 2,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['m1', 'n1']);
    expect(plan.dropped.map((item) => item.body)).toEqual(['n2']);
  });

  it('같은 심각도 안에서는 입력 순서를 지킨다', () => {
    const plan = planPublication({
      findings: [finding('MUST_FIX', 'a'), finding('MUST_FIX', 'b')],
      max: 2,
    });

    expect(plan.toPost.map((item) => item.body)).toEqual(['a', 'b']);
  });

  it('max 가 0 이면 전부 dropped', () => {
    const plan = planPublication({
      findings: [finding('MUST_FIX', 'a')],
      max: 0,
    });

    expect(plan.toPost).toEqual([]);
    expect(plan.dropped).toHaveLength(1);
  });
});
