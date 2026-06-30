import { CalibrationResultData } from '../../agent/career-mate/domain/career-mate.type';
import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { HumanizeService } from './humanize.service';
import {
  humanizeCalibrationReport,
  humanizeDailyPlan,
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

const samplePlan = (): DailyPlan => ({
  topPriority: {
    id: 'o/r#1',
    title: 'PR 리뷰',
    source: 'GITHUB',
    subtasks: [],
    isCriticalPath: true,
  },
  varianceAnalysis: {
    rolledOverTasks: ['x'],
    analysisReasoning: '이월 근거 원문',
  },
  morning: [],
  afternoon: [],
  blocker: '배너 PR 위치 확인 필요',
  estimatedHours: 4,
  reasoning: '판단 근거 원문',
});

describe('humanizeDailyPlan', () => {
  const makeHumanizer = (map: Record<string, string>) =>
    ({ humanize: jest.fn().mockResolvedValue(map) }) as any;

  it('서술 필드만 윤문본으로 교체, 나머지 불변', async () => {
    const plan = samplePlan();
    const humanizer = makeHumanizer({
      reasoning: '판단 근거 윤문',
      analysisReasoning: '이월 근거 윤문',
      blocker: '배너 PR 위치 확인 필요',
    });
    const out = await humanizeDailyPlan(plan, humanizer);
    expect(out.reasoning).toBe('판단 근거 윤문');
    expect(out.varianceAnalysis.analysisReasoning).toBe('이월 근거 윤문');
    expect(out.varianceAnalysis.rolledOverTasks).toEqual(['x']);
    expect(out.estimatedHours).toBe(4);
    expect(out.topPriority.title).toBe('PR 리뷰');
  });

  it('blocker 가 null 이면 humanize 입력에서 제외하고 null 유지', async () => {
    const plan = { ...samplePlan(), blocker: null };
    const humanizer = makeHumanizer({
      reasoning: 'r',
      analysisReasoning: 'a',
    });
    const out = await humanizeDailyPlan(plan, humanizer);
    const passedFields = (humanizer.humanize as jest.Mock).mock.calls[0][0];
    expect(passedFields).not.toHaveProperty('blocker');
    expect(out.blocker).toBeNull();
  });
});

describe('humanizeCalibrationReport', () => {
  const base: CalibrationResultData = {
    verdict: '판정 원문',
    aiSlopRisks: ['risk1', 'risk2'],
    underQuantified: ['uq1'],
    outdatedPhrasing: ['구식 표현 원문'],
    missingKeywords: ['Kafka', 'gRPC'],
    actionItems: ['action1'],
  };

  it('verdict·aiSlopRisks·underQuantified·actionItems 만 윤문하고 missingKeywords·outdatedPhrasing 은 보존', async () => {
    const result = await humanizeCalibrationReport(base, fakeHumanizer());
    expect(result.verdict).toBe('판정 원문_H');
    expect(result.aiSlopRisks).toEqual(['risk1_H', 'risk2_H']);
    expect(result.underQuantified).toEqual(['uq1_H']);
    expect(result.actionItems).toEqual(['action1_H']);
    // 보존 — 키워드 목록·구식 표현 원문 인용은 윤문 입력에서 제외.
    expect(result.missingKeywords).toEqual(['Kafka', 'gRPC']);
    expect(result.outdatedPhrasing).toEqual(['구식 표현 원문']);
  });

  it('빈 배열 필드는 빈 배열로 보존한다', async () => {
    const empty: CalibrationResultData = {
      verdict: 'v',
      aiSlopRisks: [],
      underQuantified: [],
      outdatedPhrasing: [],
      missingKeywords: [],
      actionItems: [],
    };
    const result = await humanizeCalibrationReport(empty, fakeHumanizer());
    expect(result.verdict).toBe('v_H');
    expect(result.aiSlopRisks).toEqual([]);
    expect(result.actionItems).toEqual([]);
  });
});
