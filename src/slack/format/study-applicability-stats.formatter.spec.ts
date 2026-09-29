import { formatStudyApplicabilityStats } from './study-applicability-stats.formatter';

describe('formatStudyApplicabilityStats', () => {
  const stats = {
    apply: 2,
    reference: 5,
    notApplicable: 20,
    rawApply: 3,
    downgradeNoValidCitation: 1,
    downgradeNoProposal: 0,
    unjudgedExpired: 1,
  };

  it('분포·강등·미판정·결정 수와 재검토 기준을 한 섹션으로 낸다', () => {
    const text = formatStudyApplicabilityStats(stats, {
      adopted: 1,
      rejected: 1,
    });
    expect(text).toContain('적용 2 · 참고 5 · 해당 없음 20');
    expect(text).toContain('강등 1/3');
    expect(text).toContain('미판정 1');
    expect(text).toContain('채택 1 · 거절 1');
    expect(text).toContain('재검토 기준');
  });

  it('판정이 0건이면 빈 문자열', () => {
    expect(
      formatStudyApplicabilityStats(
        {
          apply: 0,
          reference: 0,
          notApplicable: 0,
          rawApply: 0,
          downgradeNoValidCitation: 0,
          downgradeNoProposal: 0,
          unjudgedExpired: 0,
        },
        { adopted: 0, rejected: 0 },
      ),
    ).toBe('');
  });
});
