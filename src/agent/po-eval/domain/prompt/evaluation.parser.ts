import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { PoEvalException } from '../po-eval.exception';
import { EvaluationOutput } from '../po-eval.type';
import { PoEvalErrorCode } from '../po-eval-error-code.enum';

// LLM 은 prNumber + evaluation 만 생성 (ref/title/url/stat 메타는 usecase 가 prNumber 로 join).
export interface LlmMergedPrReview {
  overall: string;
  prs: { prNumber: number; evaluation: string }[];
}

// LLM 이 반환하는 부분 — qualitative + careerLog (+ 선택적 mergedPrReview).
// range / sourceAgentRuns / mergedPrReview 의 PR 메타는 manager(usecase) 가 채움.
export type EvaluationLlmOutput = Pick<
  EvaluationOutput,
  'qualitative' | 'careerLog'
> & { mergedPrReview?: LlmMergedPrReview };

export const parseEvaluationOutput = (raw: string): EvaluationLlmOutput => {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: `PO_EVAL 응답 JSON parse 실패: ${cleaned.slice(0, 120)}`,
      status: DomainStatus.INTERNAL,
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: `PO_EVAL 응답이 객체가 아님: ${typeof parsed}`,
      status: DomainStatus.INTERNAL,
    });
  }
  const root = parsed as Record<string, unknown>;
  return {
    qualitative: parseQualitative(root.qualitative),
    careerLog: parseCareerLog(root.careerLog),
    mergedPrReview: parseMergedPrReview(root.mergedPrReview),
  };
};

// 입력에 mergedPrReview 가 없으면(=WEEK / PR 0건) undefined. prNumber 가 number, evaluation 이
// string 인 항목만 통과 — LLM 이 잘못 만든 항목은 조용히 제외. overall·prs 둘 다 비면 undefined.
const parseMergedPrReview = (
  raw: unknown,
): LlmMergedPrReview | undefined => {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  const obj = raw as Record<string, unknown>;
  const overall = typeof obj.overall === 'string' ? obj.overall : '';
  const prsRaw = Array.isArray(obj.prs) ? obj.prs : [];
  const prs = prsRaw
    .filter(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null,
    )
    .filter(
      (item) =>
        typeof item.prNumber === 'number' &&
        typeof item.evaluation === 'string',
    )
    .map((item) => ({
      prNumber: item.prNumber as number,
      evaluation: item.evaluation as string,
    }));
  if (overall.length === 0 && prs.length === 0) {
    return undefined;
  }
  return { overall, prs };
};

const parseQualitative = (raw: unknown): EvaluationLlmOutput['qualitative'] => {
  if (typeof raw !== 'object' || raw === null) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: 'qualitative 필드가 객체가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  const obj = raw as Record<string, unknown>;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    blockers: parseStringArray(obj.blockers, 'qualitative.blockers'),
    wins: parseStringArray(obj.wins, 'qualitative.wins'),
  };
};

const parseCareerLog = (raw: unknown): EvaluationLlmOutput['careerLog'] => {
  if (typeof raw !== 'object' || raw === null) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: 'careerLog 필드가 객체가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  const obj = raw as Record<string, unknown>;
  const period = typeof obj.period === 'string' ? obj.period : '';
  const impact = typeof obj.impact === 'string' ? obj.impact : '';
  const technologies = parseStringArray(
    obj.technologies,
    'careerLog.technologies',
  );
  const achievementsRaw = obj.achievements;
  if (typeof achievementsRaw !== 'object' || achievementsRaw === null) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: 'careerLog.achievements 가 객체가 아님',
      status: DomainStatus.INTERNAL,
    });
  }
  const achievementsObj = achievementsRaw as Record<string, unknown>;
  return {
    schemaVersion: 1,
    period,
    achievements: {
      quantitative: parseStringArray(
        achievementsObj.quantitative,
        'careerLog.achievements.quantitative',
      ),
      qualitative: parseStringArray(
        achievementsObj.qualitative,
        'careerLog.achievements.qualitative',
      ),
    },
    technologies,
    impact,
  };
};

const parseStringArray = (raw: unknown, label: string): string[] => {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: `${label} 가 array 가 아님`,
      status: DomainStatus.INTERNAL,
    });
  }
  return raw.filter((item): item is string => typeof item === 'string');
};

const stripCodeFence = (text: string): string =>
  text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
