import { BLOG_PROMPT_FILE, isSafeBlogLiteral } from './blog-editable-surface';
import {
  CollectedItem,
  HumanizeResearchProposal,
  HumanizeResearchSource,
  ProposalSkipReason,
  ProposalTarget,
} from './humanize-research.type';

export const PROTECTED_QUICK_RULE_MARKERS = [
  '**근거 등급과 강도:**',
  '**보존 신호 (지우지 말 것):**',
  '| B-1 |',
  '| B-2 |',
  '8. **보존 신호 유지**',
  '## 등급 기준',
];
export const QUICK_RULES_LINE_HEADROOM = 20;
const QUICK_RULE_ROW = /^\| [A-Z]-\d+ \|[^\n]*\|$/u;
export interface GateContext {
  included: readonly CollectedItem[];
  quickRules: string;
  blogEditableTexts: readonly string[];
}

export const gateProposal = ({
  proposal,
  context,
}: {
  proposal: HumanizeResearchProposal;
  context: GateContext;
}): ProposalSkipReason | null => {
  const canon = proposal.target === ProposalTarget.CANON;
  const allowedSources = canon
    ? [
        HumanizeResearchSource.UPSTREAM,
        HumanizeResearchSource.CANON_LOG,
        HumanizeResearchSource.ARXIV,
      ]
    : [HumanizeResearchSource.BLOG, HumanizeResearchSource.HUMANIZER];
  const sourceMatches = context.included.some(
    (item) =>
      proposal.evidence.includes(item.id) &&
      allowedSources.includes(item.source),
  );
  if (!sourceMatches) {
    return ProposalSkipReason.EVIDENCE_SOURCE_MISMATCH;
  }
  const allowedFile = canon ? 'references/quick-rules.md' : BLOG_PROMPT_FILE;
  if (proposal.file !== allowedFile) {
    return ProposalSkipReason.FILE_NOT_ALLOWED;
  }
  if (!canon) {
    const safeOldString = isSafeBlogLiteral(proposal.oldString);
    const safeNewString = isSafeBlogLiteral(proposal.newString);
    if (!safeOldString || !safeNewString) {
      return ProposalSkipReason.UNSAFE_BLOG_LITERAL;
    }
  }
  const surfaces = canon ? [context.quickRules] : context.blogEditableTexts;
  const matches = surfaces.reduce(
    (count, text) => count + countMatches({ text, search: proposal.oldString }),
    0,
  );
  if (!canon && matches === 0) {
    return ProposalSkipReason.OUTSIDE_EDITABLE_SURFACE;
  }
  if (matches !== 1) {
    return ProposalSkipReason.MATCH_NOT_UNIQUE;
  }
  const tableRow = isWholeRuleRow({
    quickRules: context.quickRules,
    oldString: proposal.oldString,
  });
  const replacement = proposal.newString.trim();
  const invalidDeletion = replacement === '' && (!canon || !tableRow);
  if (invalidDeletion) {
    return ProposalSkipReason.DELETE_NOT_ALLOWED;
  }
  // 보호 자산·줄 수 상한은 정본 quick-rules 에만 있는 제약이다.
  if (!canon) {
    return null;
  }
  const protectedAsset = overlapsProtectedLine({
    quickRules: context.quickRules,
    oldString: proposal.oldString,
  });
  if (protectedAsset) {
    return ProposalSkipReason.PROTECTED_ASSET;
  }
  const changed = context.quickRules.replace(
    proposal.oldString,
    () => proposal.newString,
  );
  const lineCount = changed.split('\n').length;
  const maxLines =
    context.quickRules.split('\n').length + QUICK_RULES_LINE_HEADROOM;
  if (lineCount > maxLines) {
    return ProposalSkipReason.RULEBOOK_TOO_LONG;
  }
  return null;
};

const countMatches = ({
  text,
  search,
}: {
  text: string;
  search: string;
}): number => {
  const positions = Array.from({ length: text.length }, (_, index) => index);
  const matches = positions.filter((index) => text.startsWith(search, index));
  return matches.length;
};

// 행 앞부분만 지우면 뒤 칸이 남으므로, quick-rules 의 한 줄 전체와 같은 규칙 행만 삭제로 인정한다.
const isWholeRuleRow = ({
  quickRules,
  oldString,
}: {
  quickRules: string;
  oldString: string;
}): boolean => {
  const target = oldString.trim();
  const isRuleRow = QUICK_RULE_ROW.test(target);
  const isWholeLine = quickRules
    .split('\n')
    .some((line) => line.trim() === target);
  const whole = isRuleRow && isWholeLine;
  return whole;
};

const overlapsProtectedLine = ({
  quickRules,
  oldString,
}: {
  quickRules: string;
  oldString: string;
}): boolean => {
  const start = quickRules.indexOf(oldString);
  const end = start + oldString.length;
  const startLine = quickRules.slice(0, start).split('\n').length - 1;
  const endLine = quickRules.slice(0, end - 1).split('\n').length - 1;
  const lines = quickRules.split('\n');
  for (const [index, line] of lines.entries()) {
    const precedingLines = lines.slice(0, index + 1).reverse();
    const sectionHeading = precedingLines.find((text) =>
      text.startsWith('## '),
    );
    const inGradeSection = sectionHeading?.startsWith('## 등급 기준') ?? false;
    const hasMarker = PROTECTED_QUICK_RULE_MARKERS.some((marker) =>
      line.includes(marker),
    );
    const overlaps = index >= startLine && index <= endLine;
    const protectedLine = inGradeSection || hasMarker;
    if (overlaps && protectedLine) {
      return true;
    }
  }
  return false;
};
