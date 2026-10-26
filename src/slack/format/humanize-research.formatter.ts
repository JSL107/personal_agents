import {
  CollectionStatus,
  HumanizeResearchOutput,
  HumanizeResearchSource,
  ProposalSkipReason,
} from '../../agent/humanize-research/domain/humanize-research.type';
import { escapeSlackMrkdwn } from './mrkdwn.util';

const EDIT_PREVIEW_LENGTH = 120;

const SOURCE_LABELS: Record<HumanizeResearchSource, string> = {
  [HumanizeResearchSource.HUMANIZER]: '윤문 지표',
  [HumanizeResearchSource.BLOG]: '블로그 수정',
  [HumanizeResearchSource.UPSTREAM]: '상위 규칙 변경',
  [HumanizeResearchSource.ARXIV]: 'arXiv 초록',
  [HumanizeResearchSource.SAMPLE]: '신규 모델 글',
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
  const lines = ['🔬 *윤문 규칙 연구 — dry-run*'];

  if (output.proposals.length === 0) {
    lines.push('근거 부족으로 제안 없음');
  } else {
    lines.push('', `*편집 제안 ${output.proposals.length}건*`);
    for (const [index, proposal] of output.proposals.entries()) {
      lines.push(
        `${index + 1}. ${escapeField(proposal.file)} · ${escapeField(proposal.targetMetric)}`,
        `   ${escapeField(proposal.rationale)}`,
        `   근거: ${proposal.evidence.map(escapeField).join(', ')}`,
        `   ${preview(proposal.oldString)} → ${preview(proposal.newString)}`,
      );
    }
  }

  lines.push('', '*출처 상태*');
  for (const source of output.sources) {
    const error = source.error ? ` — ${escapeField(source.error)}` : '';
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

  if (output.injectionNotices.length > 0) {
    lines.push(
      '',
      '*입력의 지시문 감지*',
      ...output.injectionNotices.map((notice) => `• ${escapeField(notice)}`),
    );
  }

  return lines.join('\n');
};
