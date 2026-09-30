import { DomainStatus } from '../../../../common/exception/domain-status.enum';
import {
  buildJsonParseCauseMessage,
  extractJsonObjectText,
} from '../../../../common/util/llm-json-extract.util';
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

const RISK_LEVELS: ReadonlySet<RiskLevel> = new Set([
  'low',
  'medium',
  'high',
  'unknown',
]);
const APPROVAL_RECOMMENDATIONS: ReadonlySet<ApprovalRecommendation> = new Set([
  'approve',
  'request_changes',
  'comment',
  'undetermined',
]);

// LLM 응답을 PullRequestReview 구조로 파싱한다. 코드 펜스·앞뒤 설명문은 extractJsonObjectText 가 벗긴다.
// 모델 출력을 코드가 보정했을 때 알릴 곳. domain 계층이라 로거를 직접 두지 않고 호출부가 받는다.
export type VerdictCorrectionListener = (message: string) => void;

export const parsePullRequestReview = (
  text: string,
  onCorrection?: VerdictCorrectionListener,
): PullRequestReview => {
  const cleaned = extractJsonObjectText(text);
  const parsed = parseJson(cleaned, text);

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

  return enforceVerdictConsistency({ ...parsed, findings }, onCorrection);
};

// 판단 보류와 등급의 짝을 코드가 강제한다. 프롬프트 설명만으로는 모델이 보류라고 쓰고도 등급을
// 채우는 회차가 남는다 — 그 등급이 Slack 카드에 "위험도 중간" 으로 그대로 찍혀 나갔다.
//
// 짝이 틀린 응답은 예외로 끊지 않고 보정한다. 끊으면 같은 응답의 지적(findings)까지 통째로 잃는데,
// 새 값을 들인 직후라 모델이 짝을 틀리는 회차가 나올 수 있다 — 억지 등급 하나를 막으려다 리뷰
// 전체를 버리는 쪽이 손실이 크다. 보정했다는 사실은 onCorrection 으로 남긴다.
export const UNDETERMINED_REASON_MISSING = '사유 미기재(모델 응답에 없음)';
export const UNDETERMINED_REASON_UNKNOWN_RISK = '등급을 정하지 못함(모델 응답)';

const enforceVerdictConsistency = (
  review: PullRequestReview,
  onCorrection?: VerdictCorrectionListener,
): PullRequestReview => {
  const { undeterminedReason, ...rest } = review;
  const hasBlockingFinding =
    rest.mustFix.length > 0 ||
    rest.findings.some(({ severity }) => severity === 'MUST_FIX');
  const claimsUndetermined =
    rest.approvalRecommendation === 'undetermined' ||
    rest.riskLevel === 'unknown';

  if (!claimsUndetermined) {
    // 보류가 아닌 리뷰의 이유 필드는 버린다 — 소비자가 "이유가 있으면 보류" 로 읽지 않게.
    return rest;
  }

  // 보이는 범위에서 막을 결함을 찾았다면 그것이 결론이다 — 판단 보류로 덮으면 머지 필수 지적이
  // "판단 보류" 뒤에 묻힌다. 프롬프트 규칙(mustFix → high)에 맞춰 등급도 올린다.
  if (hasBlockingFinding) {
    onCorrection?.(
      `판단 보류 응답(${rest.approvalRecommendation}/${rest.riskLevel})에 머지 필수 지적이 있어 request_changes/high 로 보정했다.`,
    );
    return {
      ...rest,
      approvalRecommendation: 'request_changes',
      riskLevel: 'high',
    };
  }

  if (rest.approvalRecommendation !== 'undetermined') {
    // riskLevel 'unknown' 은 보류 전용이다. 등급을 모른다면서 판정을 낸 응답은 판정 쪽을 믿지 않는다.
    onCorrection?.(
      `riskLevel "unknown" 인데 권고가 ${rest.approvalRecommendation} 이라 판단 보류로 보정했다.`,
    );
    return {
      ...rest,
      approvalRecommendation: 'undetermined',
      riskLevel: 'unknown',
      undeterminedReason: UNDETERMINED_REASON_UNKNOWN_RISK,
    };
  }

  const reason =
    typeof undeterminedReason === 'string' ? undeterminedReason.trim() : '';
  if (reason.length === 0) {
    onCorrection?.('판단 보류 응답에 이유가 없어 사유 미기재로 채웠다.');
  }
  if (rest.riskLevel !== 'unknown') {
    // 모델이 medium 등을 적어도 저장하지 않는다 — 판단하지 못한 리뷰의 등급은 모른다.
    onCorrection?.(
      `판단 보류 응답의 riskLevel "${rest.riskLevel}" 을 unknown 으로 보정했다.`,
    );
  }
  return {
    ...rest,
    riskLevel: 'unknown',
    undeterminedReason:
      reason.length > 0 ? reason : UNDETERMINED_REASON_MISSING,
  };
};

const parseJson = (text: string, rawText: string): unknown => {
  try {
    return JSON.parse(text);
  } catch (error: unknown) {
    throw new CodeReviewerException({
      code: CodeReviewerErrorCode.INVALID_MODEL_OUTPUT,
      message: '모델 응답을 JSON 으로 파싱하지 못했습니다.',
      status: DomainStatus.BAD_GATEWAY,
      // raw 앞부분을 남겨야 원장·로그만으로 어디서 깨졌는지 본다 — 없으면 재현 불가.
      cause: new Error(buildJsonParseCauseMessage(error, rawText)),
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
    ) &&
    (record.undeterminedReason === undefined ||
      typeof record.undeterminedReason === 'string')
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
