import { MetaOutput } from '../../agent/ceo/domain/ceo.type';
import { formatCeoMetaOutput } from './ceo-meta.formatter';

const base: MetaOutput = {
  range: 'WEEK',
  sourcePhaseRuns: { poEvalRunId: 1, pmRunId: 2, ctoRunId: 3 },
  contextDriftReport: { observations: ['drift 신호 1건', 'drift 신호 2건'] },
  docsQualityReport: { findings: ['CLAUDE.md 갱신 필요', '문서 품질 개선'] },
  finalSummary: '본 주는 phase 흐름 정상.',
  schemaVersion: 1,
};

describe('formatCeoMetaOutput', () => {
  it('summary 에 finalSummary 와 드리프트 헤더가 포함된다', () => {
    const { summary } = formatCeoMetaOutput(base);
    expect(summary).toContain('본 주는 phase 흐름 정상.');
    expect(summary).toContain('CEO 메타 review');
  });

  it('detail 에 observations 와 findings 전체가 담긴다', () => {
    const { detail } = formatCeoMetaOutput(base);
    expect(detail).toContain('drift 신호 1건');
    expect(detail).toContain('drift 신호 2건');
    expect(detail).toContain('CLAUDE.md 갱신 필요');
    expect(detail).toContain('문서 품질 개선');
  });

  it('detail 에 source footer 가 포함된다', () => {
    const { detail } = formatCeoMetaOutput(base);
    expect(detail).toContain('poEval=#1');
    expect(detail).toContain('pm=#2');
    expect(detail).toContain('cto=#3');
  });
});
