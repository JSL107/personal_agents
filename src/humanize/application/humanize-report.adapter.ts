import { EveningRetroResult } from '../../agent/blog/domain/prompt/evening-retro.prompt';
import { CalibrationResultData } from '../../agent/career-mate/domain/career-mate.type';
import { MetaOutput } from '../../agent/ceo/domain/ceo.type';
import { ImpactReport } from '../../agent/impact-reporter/domain/impact-reporter.type';
import { DailyPlan } from '../../agent/pm/domain/pm-agent.type';
import { EvaluationOutput } from '../../agent/po-eval/domain/po-eval.type';
import { PoShadowReport } from '../../agent/po-shadow/domain/po-shadow.type';
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
): string[] =>
  original.map((item, index) => humanized[`${prefix}.${index}`] ?? item);

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
  // 미검토(undefined)는 윤문 대상이 아니다 — 넣으면 없는 축이 빈 배열로 되살아난다.
  flattenArray(fields, 'decisions', review.decisions ?? []);
  flattenArray(fields, 'risks', review.risks ?? []);
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
    decisions: review.decisions
      ? rebuildArray(humanized, 'decisions', review.decisions)
      : undefined,
    risks: review.risks
      ? rebuildArray(humanized, 'risks', review.risks)
      : undefined,
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

export const humanizeEvaluationOutput = async (
  output: EvaluationOutput,
  humanizer: HumanizeService,
): Promise<EvaluationOutput> => {
  const fields: Record<string, string> = {
    'qualitative.summary': output.qualitative.summary,
    'careerLog.impact': output.careerLog.impact,
  };
  flattenArray(fields, 'qualitative.blockers', output.qualitative.blockers);
  flattenArray(fields, 'qualitative.wins', output.qualitative.wins);
  flattenArray(
    fields,
    'careerLog.achievements.qualitative',
    output.careerLog.achievements.qualitative,
  );

  const humanized = await humanizer.humanize(fields);

  return {
    ...output,
    qualitative: {
      ...output.qualitative,
      summary: humanized['qualitative.summary'] ?? output.qualitative.summary,
      blockers: rebuildArray(
        humanized,
        'qualitative.blockers',
        output.qualitative.blockers,
      ),
      wins: rebuildArray(
        humanized,
        'qualitative.wins',
        output.qualitative.wins,
      ),
    },
    careerLog: {
      ...output.careerLog,
      achievements: {
        ...output.careerLog.achievements,
        qualitative: rebuildArray(
          humanized,
          'careerLog.achievements.qualitative',
          output.careerLog.achievements.qualitative,
        ),
      },
      impact: humanized['careerLog.impact'] ?? output.careerLog.impact,
    },
  };
};

// PO Shadow의 코드 생성 사실과 식별자는 보존하고, 모델이 작성한 서술 필드만 윤문한다.
export const humanizePoShadowReport = async (
  report: PoShadowReport,
  humanizer: HumanizeService,
): Promise<PoShadowReport> => {
  const fields: Record<string, string> = {
    headline: report.headline,
  };
  flattenArray(
    fields,
    'findings.point',
    report.findings.map((finding) => finding.point),
  );
  flattenArray(
    fields,
    'findings.suggestion',
    report.findings.map((finding) => finding.suggestion),
  );
  if (report.purposeConflict !== null) {
    fields.purposeConflict = report.purposeConflict;
  }

  const humanized = await humanizer.humanize(fields);

  return {
    ...report,
    headline: humanized.headline ?? report.headline,
    findings: report.findings.map((finding, index) => ({
      ...finding,
      point: humanized[`findings.point.${index}`] ?? finding.point,
      suggestion:
        humanized[`findings.suggestion.${index}`] ?? finding.suggestion,
    })),
    purposeConflict:
      report.purposeConflict === null
        ? null
        : (humanized.purposeConflict ?? report.purposeConflict),
  };
};

// 저녁 회고의 서술 필드만 윤문한다.
//
// 이 산출물은 매일 저녁 Slack 으로 그대로 나가는데 윤문 경로에 연결돼 있지 않아, codex 가
// 쓴 원문(명사 나열·만연체·한 문장 세 갈래)이 사람 눈에 닿는 유일한 자동 보고였다.
//
// keywords 와 sourceRefs 는 입력에서 뺀다 — 전자는 고유명사·영문 약어 나열이라 윤문할 문장이
// 아니고, 후자는 훼손되면 `resolveSourcePrs()` 의 PR 매칭이 조용히 빗나가 근거가 사라진다.
// outline 은 승인 카드 안쪽 뼈대 불릿이라 지금은 제외한다(필요해지면 같은 방식으로 추가).
export const humanizeEveningRetro = async (
  result: EveningRetroResult,
  humanizer: HumanizeService,
): Promise<EveningRetroResult> => {
  const fields: Record<string, string> = {
    retrospective: result.retrospective,
  };
  flattenArray(
    fields,
    'candidates.title',
    result.candidates.map((candidate) => candidate.title),
  );
  flattenArray(
    fields,
    'candidates.reason',
    result.candidates.map((candidate) => candidate.reason),
  );
  flattenArray(
    fields,
    'prNotes.note',
    result.prNotes.map((prNote) => prNote.note),
  );

  const humanized = await humanizer.humanize(fields);

  return {
    ...result,
    retrospective: humanized.retrospective ?? result.retrospective,
    candidates: result.candidates.map((candidate, index) => ({
      ...candidate,
      title: humanized[`candidates.title.${index}`] ?? candidate.title,
      reason: humanized[`candidates.reason.${index}`] ?? candidate.reason,
    })),
    prNotes: result.prNotes.map((prNote, index) => ({
      ...prNote,
      note: humanized[`prNotes.note.${index}`] ?? prNote.note,
    })),
  };
};
