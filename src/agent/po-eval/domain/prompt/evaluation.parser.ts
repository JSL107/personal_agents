import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { PoEvalException } from '../po-eval.exception';
import { EvaluationOutput } from '../po-eval.type';
import { PoEvalErrorCode } from '../po-eval-error-code.enum';

// LLM 이 반환하는 부분 — qualitative + careerLog. range / sourceAgentRuns 는 manager 가 채움.
export type EvaluationLlmOutput = Pick<
  EvaluationOutput,
  'qualitative' | 'careerLog'
>;

export const parseEvaluationOutput = (raw: string): EvaluationLlmOutput => {
  const cleaned = stripCodeFence(raw.trim());
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    throw new PoEvalException({
      code: PoEvalErrorCode.PARSE_FAILED,
      message: `PO_EVAL 응답 JSON parse 실패 — ${describeUnparsable(cleaned, error)}`,
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
  };
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

// 파싱 실패 진단 — AgentRun.output.error 에는 error.message 만 보관되므로(agent-run.service),
// 사후 원인 규명에 필요한 최소 정보를 메시지 자체에 담는다.
// head 만 남기면 "응답이 중간에 잘렸는지" 를 알 수 없다 — 잘림은 tail 에서만 드러난다.
// (2026-07-23 AgentRun #247 이 앞 120자만 남겨 원인 판별 불가였던 사례.)
const DIAGNOSTIC_EXCERPT_LENGTH = 200;
const DIAGNOSTIC_CAUSE_LENGTH = 200;

const describeUnparsable = (cleaned: string, cause: unknown): string => {
  const causeText = cause instanceof Error ? cause.message : String(cause);
  const causeMessage = causeText.slice(0, DIAGNOSTIC_CAUSE_LENGTH);
  const prefix = `len=${cleaned.length} cause=${causeMessage}`;
  if (cleaned.length <= DIAGNOSTIC_EXCERPT_LENGTH * 2) {
    return `${prefix} body=${cleaned}`;
  }
  const head = cleaned.slice(0, DIAGNOSTIC_EXCERPT_LENGTH);
  const tail = cleaned.slice(-DIAGNOSTIC_EXCERPT_LENGTH);
  return `${prefix} head=${head} …(생략)… tail=${tail}`;
};
