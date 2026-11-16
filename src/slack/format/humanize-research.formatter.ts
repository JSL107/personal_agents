import {
  CollectionStatus,
  HumanizeResearchOutput,
  HumanizeResearchSource,
  ProposalSkipReason,
  ProposalTarget,
} from '../../agent/humanize-research/domain/humanize-research.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const EDIT_PREVIEW_LENGTH = 120;

const SOURCE_LABELS: Record<HumanizeResearchSource, string> = {
  [HumanizeResearchSource.HUMANIZER]: '윤문 지표',
  [HumanizeResearchSource.BLOG]: '블로그 수정',
  [HumanizeResearchSource.UPSTREAM]: '상위 규칙 변경',
  [HumanizeResearchSource.ARXIV]: 'arXiv 초록',
  [HumanizeResearchSource.CANON_LOG]: '정본 커밋',
};

const TARGET_LABELS: Record<ProposalTarget, string> = {
  [ProposalTarget.CANON]: '정본',
  [ProposalTarget.BLOG]: '블로그',
};

const STATUS_LABELS: Record<CollectionStatus, string> = {
  [CollectionStatus.OK]: '수집 완료',
  [CollectionStatus.EMPTY]: '새 항목 없음',
  [CollectionStatus.FAILED]: '수집 실패',
};

const SKIP_LABELS: Record<ProposalSkipReason, string> = {
  [ProposalSkipReason.INVALID_SHAPE]: '형태 오류',
  [ProposalSkipReason.NO_EVIDENCE]: '근거 불일치',
  [ProposalSkipReason.OVER_LIMIT]: '제안 상한 초과',
  [ProposalSkipReason.EVIDENCE_SOURCE_MISMATCH]: '근거 출처 불일치',
  [ProposalSkipReason.FILE_NOT_ALLOWED]: '허용되지 않은 파일',
  [ProposalSkipReason.UNSAFE_BLOG_LITERAL]: '안전하지 않은 블로그 문구',
  [ProposalSkipReason.MATCH_NOT_UNIQUE]: '일치 항목 유일하지 않음',
  [ProposalSkipReason.OUTSIDE_EDITABLE_SURFACE]: '편집 가능 범위 밖',
  [ProposalSkipReason.DELETE_NOT_ALLOWED]: '삭제 불가',
  [ProposalSkipReason.PROTECTED_ASSET]: '보호 자산',
  [ProposalSkipReason.RULEBOOK_TOO_LONG]: '규칙 줄 수 초과',
  [ProposalSkipReason.SELFCHECK_FAILED]: '정본 자체 검사 실패',
  [ProposalSkipReason.SEVERITY_SYNC_FAILED]: '심각도 동기화 검사 실패',
  [ProposalSkipReason.GOLDEN_FAILED]: '골든 검사 실패',
  [ProposalSkipReason.CANON_CHECK_ERROR]: '정본 검사 실행 오류',
};

const escapeField = (value: string): string =>
  escapeSlackMrkdwn(value.replace(/[\r\n\t]+/g, ' '));

const preview = (value: string): string => {
  const clipped = value.length > EDIT_PREVIEW_LENGTH;
  const visible = clipped ? `${value.slice(0, EDIT_PREVIEW_LENGTH)}…` : value;
  return escapeField(visible);
};

export const formatHumanizeResearch = (
  output: HumanizeResearchOutput,
): string => {
  const lines = ['🔬 *윤문 규칙 연구: dry-run*'];

  if (output.proposals.length === 0) {
    lines.push('근거 부족으로 제안 없음');
  } else {
    lines.push('', `*편집 제안 ${output.proposals.length}건*`);
    for (const [index, proposal] of output.proposals.entries()) {
      lines.push(
        `${index + 1}. [${TARGET_LABELS[proposal.target]}] ${escapeField(proposal.file)} · ${escapeField(proposal.targetMetric)}`,
        `   ${escapeField(proposal.rationale)}`,
        `   근거: ${proposal.evidence.map(escapeField).join(', ')}`,
        `   ${preview(proposal.oldString)} → ${preview(proposal.newString)}`,
      );
    }
  }

  lines.push('', '*출처 상태*');
  for (const source of output.sources) {
    const error = source.error ? `: ${escapeField(source.error)}` : '';
    lines.push(
      `• ${SOURCE_LABELS[source.source]}: ${STATUS_LABELS[source.status]} (${source.itemCount}건)${error}`,
    );
  }

  if (output.droppedForBudget.length > 0) {
    lines.push(
      '',
      `입력 예산 제외: ${output.droppedForBudget.map(escapeField).join(', ')}`,
    );
  }

  if (output.skipped.length > 0) {
    const counts = new Map<ProposalSkipReason, number>();
    for (const skipped of output.skipped) {
      counts.set(skipped.reason, (counts.get(skipped.reason) ?? 0) + 1);
    }
    lines.push(
      '',
      `제외된 제안: ${[...counts.entries()]
        .map(([reason, count]) => `${SKIP_LABELS[reason]} ${count}건`)
        .join(' · ')}`,
    );
  }

  for (const gap of output.enforcementGaps) {
    lines.push(
      `집행 안 되는 규칙: ${escapeField(gap.ruleId)} (근거 ${gap.evidence.length}건)`,
    );
  }

  if (output.injectionNotices.length > 0) {
    lines.push(
      '',
      '*입력의 지시문 감지*',
      ...output.injectionNotices.map((notice) => `• ${escapeField(notice)}`),
    );
  }

  return lines.join('\n');
};
