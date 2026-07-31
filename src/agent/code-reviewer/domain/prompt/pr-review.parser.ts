import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import { CodeReviewerException } from '../code-reviewer.exception';
import {
  ApprovalRecommendation,
  FindingCategory,
  FindingSeverity,
  PullRequestReview,
  ReviewCommentDraft,
  ReviewFinding,
  RiskLevel,
} from '../code-reviewer.type';
import { CodeReviewerErrorCode } from '../code-reviewer-error-code.enum';

const CODE_FENCE_PATTERN = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

const RISK_LEVELS: ReadonlySet<RiskLevel> = new Set(['low', 'medium', 'high']);
const APPROVAL_RECOMMENDATIONS: ReadonlySet<ApprovalRecommendation> = new Set([
  'approve',
  'request_changes',
  'comment',
]);

// LLM 응답을 PullRequestReview 구조로 파싱한다. 코드 펜스가 감싸 있어도 벗긴다.
export const parsePullRequestReview = (text: string): PullRequestReview => {
  const cleaned = stripCodeFence(text.trim());
  const parsed = parseJson(cleaned);

  if (!isPullRequestReviewShape(parsed)) {
    throw new CodeReviewerException({
      code: CodeReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답이 PullRequestReview 스키마와 맞지 않습니다.',
      status: DomainStatus.BAD_GATEWAY,
    });
  }

  const rawFindings = (parsed as unknown as Record<string, unknown>).findings;
  // 빈 findings([])는 "지적 없음"이 아니라 "모델이 새 필드를 안 채움"으로 취급한다 —
  // legacy 3배열(mustFix/niceToHave/missingTests)에 값이 있는데 findings 만 비어 있으면
  // 그 값이 조용히 유실되므로, 실제로 요소가 있을 때만 findings 를 정본으로 쓴다.
  // 정제 후에 판정한다 — 요소가 있어도 전부 탈락(body 누락·공백 등)하면 결과는 빈 배열이고,
  // 그 상태로 확정하면 legacy 3배열에 남은 머지 필수 지적이 카드·게시 경로에서 조용히 유실된다.
  const cleanedFindings = Array.isArray(rawFindings)
    ? rawFindings
        .map(toFinding)
        .filter((finding): finding is ReviewFinding => finding !== null)
    : [];
  const findings =
    cleanedFindings.length > 0
      ? cleanedFindings
      : findingsFromLegacyArrays(parsed);

  return { ...parsed, findings };
};

const stripCodeFence = (text: string): string => {
  const match = text.match(CODE_FENCE_PATTERN);
  return match ? match[1].trim() : text;
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new CodeReviewerException({
      code: CodeReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};

const isPullRequestReviewShape = (
  value: unknown,
): value is Omit<PullRequestReview, 'findings'> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.summary === 'string' &&
    typeof record.riskLevel === 'string' &&
    RISK_LEVELS.has(record.riskLevel as RiskLevel) &&
    isStringArray(record.mustFix) &&
    isStringArray(record.niceToHave) &&
    isStringArray(record.missingTests) &&
    isReviewCommentDraftArray(record.reviewCommentDrafts) &&
    typeof record.approvalRecommendation === 'string' &&
    APPROVAL_RECOMMENDATIONS.has(
      record.approvalRecommendation as ApprovalRecommendation,
    )
  );
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isReviewCommentDraftArray = (
  value: unknown,
): value is ReviewCommentDraft[] => {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(isReviewCommentDraft);
};

const isReviewCommentDraft = (value: unknown): value is ReviewCommentDraft => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.body !== 'string') {
    return false;
  }
  if (record.file !== undefined && typeof record.file !== 'string') {
    return false;
  }
  if (record.line !== undefined && typeof record.line !== 'number') {
    return false;
  }
  return true;
};

const FINDING_CATEGORIES: ReadonlySet<FindingCategory> = new Set([
  'CORRECTNESS',
  'SECURITY',
  'RELIABILITY',
  'TEST',
  'ARCHITECTURE',
  'READABILITY',
  'STYLE',
  'UNCLASSIFIED',
]);

const FINDING_SEVERITIES: ReadonlySet<FindingSeverity> = new Set([
  'MUST_FIX',
  'NICE_TO_HAVE',
  'MISSING_TEST',
]);

// 라벨이 틀렸다고 지적을 버리지 않는다 — 본문이 살아 있으면 가치가 있으므로 강등만 한다.
const toFinding = (value: unknown): ReviewFinding | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.body !== 'string') {
    return null;
  }
  const body = record.body.trim();
  if (body.length === 0) {
    return null;
  }
  const category = FINDING_CATEGORIES.has(record.category as FindingCategory)
    ? (record.category as FindingCategory)
    : 'UNCLASSIFIED';
  const severity = FINDING_SEVERITIES.has(record.severity as FindingSeverity)
    ? (record.severity as FindingSeverity)
    : 'NICE_TO_HAVE';
  const finding: ReviewFinding = { category, severity, body };
  if (typeof record.file === 'string') {
    finding.file = record.file;
  }
  // GitHub 는 diff 에 없는 줄 번호로 코멘트를 남기면 거부한다 — 정수·양수만 받는다.
  if (Number.isInteger(record.line) && (record.line as number) > 0) {
    finding.line = record.line as number;
  }
  return finding;
};

// 구버전 응답(findings 없음) 호환 — 3배열을 severity 로 매핑해 카드 원본을 만든다.
const findingsFromLegacyArrays = (
  review: Omit<PullRequestReview, 'findings'>,
): ReviewFinding[] => [
  ...review.mustFix.map((body) => legacyFinding(body, 'MUST_FIX')),
  ...review.niceToHave.map((body) => legacyFinding(body, 'NICE_TO_HAVE')),
  ...review.missingTests.map((body) => legacyFinding(body, 'MISSING_TEST')),
];

const legacyFinding = (
  body: string,
  severity: FindingSeverity,
): ReviewFinding => ({ category: 'UNCLASSIFIED', severity, body });
