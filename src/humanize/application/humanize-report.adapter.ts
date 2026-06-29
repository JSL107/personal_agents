import { MetaOutput } from '../../agent/ceo/domain/ceo.type';
import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
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
