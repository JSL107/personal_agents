import {
  FindingCategory,
  FindingSeverity,
} from '../../agent/code-reviewer/domain/code-reviewer.type';

export const IDAERI_REVIEW_MARKER = '🤖 **이대리 자동 리뷰**';

export interface BuildFindingCommentBodyInput {
  category: FindingCategory;
  severity: FindingSeverity;
  body: string;
}

export const buildFindingCommentBody = ({
  category,
  severity,
  body,
}: BuildFindingCommentBodyInput): string =>
  `${IDAERI_REVIEW_MARKER} · ${category} / ${severity}\n\n${body.trim()}`;
