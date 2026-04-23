import { HttpStatus } from '@nestjs/common';

import { CodeReviewerErrorCode } from '../code-reviewer-error-code.enum';
import { CodeReviewerException } from '../code-reviewer.exception';
import {
  ApprovalRecommendation,
  PullRequestReview,
  ReviewCommentDraft,
  RiskLevel,
} from '../code-reviewer.type';

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
      status: HttpStatus.BAD_GATEWAY,
    });
  }

  return parsed;
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
      status: HttpStatus.BAD_GATEWAY,
      cause: error,
    });
  }
};

const isPullRequestReviewShape = (
  value: unknown,
): value is PullRequestReview => {
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
