import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { HumanizeService } from './humanize.service';
import {
  humanizeDailyReview,
  humanizeImpactReport,
  humanizeMetaOutput,
} from './humanize-report.adapter';

// 입력 키에 '_H' 접미사를 붙여 돌려주는 가짜 윤문기 — 매핑이 키별로 정확한지 검증.
const fakeHumanizer = (): HumanizeService =>
  ({
    humanize: async (fields: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const key of Object.keys(fields)) {
        out[key] = `${fields[key]}_H`;
      }
      return out;
    },
  }) as unknown as HumanizeService;

describe('humanizeImpactReport', () => {
  const base: ImpactReport = {
    subject: 'PR #1',
    headline: '헤드라인',
    quantitative: ['PR 23건'],
    qualitative: '질적',
    affectedAreas: { users: ['u1', 'u2'], team: ['t1'], service: [] },
    beforeAfter: { before: '전', after: '후' },
    risks: ['r1'],
    reasoning: '근거',
  };

  it('서술 필드만 윤문하고 quantitative·subject·배열 구조는 보존한다', async () => {
    const result = await humanizeImpactReport(base, fakeHumanizer());
    expect(result.headline).toBe('헤드라인_H');
    expect(result.qualitative).toBe('질적_H');
    expect(result.reasoning).toBe('근거_H');
    expect(result.affectedAreas.users).toEqual(['u1_H', 'u2_H']);
    expect(result.affectedAreas.team).toEqual(['t1_H']);
    expect(result.affectedAreas.service).toEqual([]);
    expect(result.beforeAfter).toEqual({ before: '전_H', after: '후_H' });
    expect(result.risks).toEqual(['r1_H']);
    // 보존
    expect(result.quantitative).toEqual(['PR 23건']);
    expect(result.subject).toBe('PR #1');
  });

  it('beforeAfter 가 null 이면 null 을 유지한다', async () => {
    const result = await humanizeImpactReport(
      { ...base, beforeAfter: null },
      fakeHumanizer(),
    );
    expect(result.beforeAfter).toBeNull();
  });
});

describe('humanizeMetaOutput', () => {
  it('finalSummary·observations·findings 만 윤문한다', async () => {
    const result = await humanizeMetaOutput(
      {
        range: 'WEEK',
        sourcePhaseRuns: { poEvalRunId: 1 },
        contextDriftReport: { observations: ['o1', 'o2'] },
        docsQualityReport: { findings: ['f1'] },
        finalSummary: '요약',
        schemaVersion: 1,
      },
      fakeHumanizer(),
    );
    expect(result.finalSummary).toBe('요약_H');
    expect(result.contextDriftReport.observations).toEqual(['o1_H', 'o2_H']);
    expect(result.docsQualityReport.findings).toEqual(['f1_H']);
    expect(result.sourcePhaseRuns).toEqual({ poEvalRunId: 1 });
  });
});

describe('humanizeDailyReview', () => {
  it('summary·qualitative·oneLineAchievement·nextActions 만 윤문한다', async () => {
    const result = await humanizeDailyReview(
      {
        summary: '오늘',
        impact: { quantitative: ['-3건'], qualitative: '정성' },
        improvementBeforeAfter: { before: '전', after: '후' },
        nextActions: ['a1', 'a2'],
        oneLineAchievement: '성과',
      },
      fakeHumanizer(),
    );
    expect(result.summary).toBe('오늘_H');
    expect(result.impact.qualitative).toBe('정성_H');
    expect(result.oneLineAchievement).toBe('성과_H');
    expect(result.nextActions).toEqual(['a1_H', 'a2_H']);
    expect(result.improvementBeforeAfter).toEqual({
      before: '전_H',
      after: '후_H',
    });
    expect(result.impact.quantitative).toEqual(['-3건']);
  });
});
