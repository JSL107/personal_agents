import { CalibrationResultData } from '../../agent/career-mate/domain/career-mate.type';
import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';
import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
import { HumanizeService } from './humanize.service';
import {
  humanizeCalibrationReport,
  humanizeDailyPlan,
  humanizeDailyReview,
  humanizeEvaluationOutput,
  humanizeImpactReport,
  humanizeMetaOutput,
  humanizePoShadowReport,
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

const identityHumanizer = (): HumanizeService =>
  ({
    humanize: async (fields: Record<string, string>) => fields,
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
        decisions: [],
        risks: [],
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

describe('humanizeEvaluationOutput', () => {
  const base: EvaluationOutput = {
    range: 'WEEK',
    sourceAgentRuns: {
      workReviewerRunId: 10,
      poShadowRunId: 11,
      impactReporterRunId: 12,
    },
    qualitative: {
      summary: '이번 주 핵심 결과를 정리함',
      blockers: ['배포 권한 확인이 지연됨'],
      wins: ['결제 검증 흐름을 완료함'],
    },
    careerLog: {
      schemaVersion: 1,
      period: '2026-W31',
      achievements: {
        quantitative: ['PR 3건 머지'],
        qualitative: ['결제 검증 API를 출시함'],
      },
      technologies: ['NestJS', 'Prisma'],
      impact: '결제 오류 대응 시간을 줄임',
    },
  };

  it('PO 서사 필드만 윤문하고 기간·run 참조·정량 성과·기술을 보존한다', async () => {
    const result = await humanizeEvaluationOutput(base, fakeHumanizer());

    expect(result.qualitative).toEqual({
      summary: '이번 주 핵심 결과를 정리함_H',
      blockers: ['배포 권한 확인이 지연됨_H'],
      wins: ['결제 검증 흐름을 완료함_H'],
    });
    expect(result.careerLog.achievements.qualitative).toEqual([
      '결제 검증 API를 출시함_H',
    ]);
    expect(result.careerLog.impact).toBe('결제 오류 대응 시간을 줄임_H');
    expect(result.range).toBe('WEEK');
    expect(result.sourceAgentRuns).toEqual(base.sourceAgentRuns);
    expect(result.careerLog.achievements.quantitative).toEqual(['PR 3건 머지']);
    expect(result.careerLog.technologies).toEqual(['NestJS', 'Prisma']);
    expect(result.careerLog.period).toBe('2026-W31');
    expect(result.careerLog.schemaVersion).toBe(1);
  });

  it('비활성 또는 실패 처리된 humanizer가 입력을 반환하면 원본을 유지한다', async () => {
    const result = await humanizeEvaluationOutput(base, identityHumanizer());

    expect(result).toEqual(base);
  });
});

describe('humanizePoShadowReport', () => {
  const base: PoShadowReport = {
    schemaVersion: 2,
    quiet: false,
    headline: '원문 헤드라인',
    findings: [
      {
        factIds: ['stalled:acme/app#264'],
        point: '원문 지적 1',
        suggestion: '원문 제안 1',
      },
      {
        factIds: ['mention:C123:100'],
        point: '원문 지적 2',
        suggestion: '원문 제안 2',
      },
    ],
    purposeConflict: '원문 목적 충돌',
    factSummary: ['#264 리뷰 0건', '새 멘션 1건'],
    droppedFindingCount: 2,
    degradedSources: [],
  };

  it('headline·finding 서술·purposeConflict만 인덱스 키로 윤문한다', async () => {
    const humanizer = {
      humanize: jest.fn().mockResolvedValue({
        headline: '윤문 헤드라인',
        'findings.point.0': '윤문 지적 1',
        'findings.suggestion.0': '윤문 제안 1',
        'findings.point.1': '윤문 지적 2',
        'findings.suggestion.1': '윤문 제안 2',
        purposeConflict: '윤문 목적 충돌',
      }),
    } as unknown as HumanizeService;

    const result = await humanizePoShadowReport(base, humanizer);

    expect(humanizer.humanize).toHaveBeenCalledWith({
      headline: '원문 헤드라인',
      'findings.point.0': '원문 지적 1',
      'findings.point.1': '원문 지적 2',
      'findings.suggestion.0': '원문 제안 1',
      'findings.suggestion.1': '원문 제안 2',
      purposeConflict: '원문 목적 충돌',
    });
    expect(result).toEqual({
      ...base,
      headline: '윤문 헤드라인',
      findings: [
        {
          factIds: ['stalled:acme/app#264'],
          point: '윤문 지적 1',
          suggestion: '윤문 제안 1',
        },
        {
          factIds: ['mention:C123:100'],
          point: '윤문 지적 2',
          suggestion: '윤문 제안 2',
        },
      ],
      purposeConflict: '윤문 목적 충돌',
    });
  });

  it('purposeConflict가 null이면 윤문 입력에서 제외하고 bookkeeping을 그대로 보존한다', async () => {
    const report: PoShadowReport = { ...base, purposeConflict: null };
    const humanizer = {
      humanize: jest.fn().mockResolvedValue({}),
    } as unknown as HumanizeService;

    const result = await humanizePoShadowReport(report, humanizer);
    const fields = (humanizer.humanize as jest.Mock).mock.calls[0][0];

    expect(fields).not.toHaveProperty('purposeConflict');
    expect(result.schemaVersion).toBe(2);
    expect(result.quiet).toBe(false);
    expect(result.findings.map((finding) => finding.factIds)).toEqual(
      report.findings.map((finding) => finding.factIds),
    );
    expect(result.factSummary).toEqual(report.factSummary);
    expect(result.droppedFindingCount).toBe(2);
    expect(result.purposeConflict).toBeNull();
  });
});
