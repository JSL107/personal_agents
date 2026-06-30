import { CalibrationResultData } from '../../agent/career-mate/domain/career-mate.type';
import { MetaOutput } from '../../agent/ceo/domain/ceo.type';
import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { DailyReview } from '../../agent/work-reviewer/domain/work-reviewer.type';
import { HumanizeService } from './humanize.service';

// 배열을 인덱스 키로 평탄화 / 재조립 (예: ['a','b'] → {risks.0:'a', risks.1:'b'}).
const flattenArray = (
  target: Record<string, string>,
  prefix: string,
  items: string[],
): void => {
  items.forEach((item, index) => {
    target[`${prefix}.${index}`] = item;
  });
};

const rebuildArray = (
  humanized: Record<string, string>,
  prefix: string,
  original: string[],
): string[] => original.map((_, index) => humanized[`${prefix}.${index}`]);

export const humanizeImpactReport = async (
  report: ImpactReport,
  humanizer: HumanizeService,
): Promise<ImpactReport> => {
  const fields: Record<string, string> = {
    headline: report.headline,
    qualitative: report.qualitative,
    reasoning: report.reasoning,
  };
  flattenArray(fields, 'users', report.affectedAreas.users);
  flattenArray(fields, 'team', report.affectedAreas.team);
  flattenArray(fields, 'service', report.affectedAreas.service);
  flattenArray(fields, 'risks', report.risks);
  if (report.beforeAfter) {
    fields['beforeAfter.before'] = report.beforeAfter.before;
    fields['beforeAfter.after'] = report.beforeAfter.after;
  }

  const humanized = await humanizer.humanize(fields);

  return {
    ...report,
    headline: humanized.headline,
    qualitative: humanized.qualitative,
    reasoning: humanized.reasoning,
    affectedAreas: {
      users: rebuildArray(humanized, 'users', report.affectedAreas.users),
      team: rebuildArray(humanized, 'team', report.affectedAreas.team),
      service: rebuildArray(humanized, 'service', report.affectedAreas.service),
    },
    risks: rebuildArray(humanized, 'risks', report.risks),
    beforeAfter: report.beforeAfter
      ? {
          before: humanized['beforeAfter.before'],
          after: humanized['beforeAfter.after'],
        }
      : null,
  };
};

export const humanizeMetaOutput = async (
  output: MetaOutput,
  humanizer: HumanizeService,
): Promise<MetaOutput> => {
  const fields: Record<string, string> = { finalSummary: output.finalSummary };
  flattenArray(fields, 'observations', output.contextDriftReport.observations);
  flattenArray(fields, 'findings', output.docsQualityReport.findings);

  const humanized = await humanizer.humanize(fields);

  return {
    ...output,
    finalSummary: humanized.finalSummary,
    contextDriftReport: {
      observations: rebuildArray(
        humanized,
        'observations',
        output.contextDriftReport.observations,
      ),
    },
    docsQualityReport: {
      findings: rebuildArray(
        humanized,
        'findings',
        output.docsQualityReport.findings,
      ),
    },
  };
};

export const humanizeDailyReview = async (
  review: DailyReview,
  humanizer: HumanizeService,
): Promise<DailyReview> => {
  const fields: Record<string, string> = {
    summary: review.summary,
    qualitative: review.impact.qualitative,
    oneLineAchievement: review.oneLineAchievement,
  };
  flattenArray(fields, 'nextActions', review.nextActions);
  if (review.improvementBeforeAfter) {
    fields['improvement.before'] = review.improvementBeforeAfter.before;
    fields['improvement.after'] = review.improvementBeforeAfter.after;
  }

  const humanized = await humanizer.humanize(fields);

  return {
    ...review,
    summary: humanized.summary,
    oneLineAchievement: humanized.oneLineAchievement,
    impact: { ...review.impact, qualitative: humanized.qualitative },
    nextActions: rebuildArray(humanized, 'nextActions', review.nextActions),
    improvementBeforeAfter: review.improvementBeforeAfter
      ? {
          before: humanized['improvement.before'],
          after: humanized['improvement.after'],
        }
      : null,
  };
};

// PM 데일리플랜의 서술 문장만 윤문. TaskItem 제목·수치·lineage 등은 보존.
// blocker 는 null 이면 humanize 입력에서 제외(명시적으로).
export const humanizeDailyPlan = async (
  plan: DailyPlan,
  humanizer: HumanizeService,
): Promise<DailyPlan> => {
  const fields: Record<string, string> = {
    reasoning: plan.reasoning,
    analysisReasoning: plan.varianceAnalysis.analysisReasoning,
  };
  if (plan.blocker) {
    fields.blocker = plan.blocker;
  }

  const humanized = await humanizer.humanize(fields);

  return {
    ...plan,
    reasoning: humanized.reasoning,
    varianceAnalysis: {
      ...plan.varianceAnalysis,
      analysisReasoning: humanized.analysisReasoning,
    },
    blocker: plan.blocker ? humanized.blocker : plan.blocker,
  };
};

// 이력서 보정 점검(CalibrationResultData)의 서술 필드만 윤문한다.
// verdict + aiSlopRisks/underQuantified/actionItems(문장형 진단·액션)는 윤문 대상.
// missingKeywords(채용 키워드 목록)·outdatedPhrasing(구식 표현 원문 인용)은 보존 — 윤문 시
// 키워드/인용 구절이 훼손될 수 있어 입력에서 제외한다.
// humanizer 가 비활성/실패 시 입력을 그대로 반환하므로(best-effort) 보정 결과도 원본과 동일하게 재조립된다.
export const humanizeCalibrationReport = async (
  data: CalibrationResultData,
  humanizer: HumanizeService,
): Promise<CalibrationResultData> => {
  const fields: Record<string, string> = { verdict: data.verdict };
  flattenArray(fields, 'aiSlopRisks', data.aiSlopRisks);
  flattenArray(fields, 'underQuantified', data.underQuantified);
  flattenArray(fields, 'actionItems', data.actionItems);

  const humanized = await humanizer.humanize(fields);

  return {
    ...data,
    verdict: humanized.verdict ?? data.verdict,
    aiSlopRisks: rebuildArray(humanized, 'aiSlopRisks', data.aiSlopRisks),
    underQuantified: rebuildArray(
      humanized,
      'underQuantified',
      data.underQuantified,
    ),
    actionItems: rebuildArray(humanized, 'actionItems', data.actionItems),
  };
};
