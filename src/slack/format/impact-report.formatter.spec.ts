import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { formatImpactReport } from './impact-report.formatter';

const base: ImpactReport = {
  subject: 'PR #1',
  headline: '핵심 한 줄',
  quantitative: ['q1', 'q2', 'q3', 'q4'],
  qualitative: '질적 영향 문단',
  affectedAreas: { users: ['u1'], team: ['t1'], service: ['s1'] },
  beforeAfter: { before: '전', after: '후' },
  risks: ['r1'],
  reasoning: '판단 근거',
};

describe('formatImpactReport', () => {
  it('summary 에 헤드라인과 핵심 근거(최대 3개)만 담는다', () => {
    const { summary } = formatImpactReport(base);
    expect(summary).toContain('핵심 한 줄');
    expect(summary).toContain('q1');
    expect(summary).toContain('q3');
    expect(summary).not.toContain('q4'); // 상위 3개 cap
  });

  it('detail 에 질적 영향·판단 근거·리스크 전체를 담는다', () => {
    const { detail } = formatImpactReport(base);
    expect(detail).toContain('질적 영향 문단');
    expect(detail).toContain('판단 근거');
    expect(detail).toContain('r1');
  });
});
