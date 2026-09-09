import {
  INDEX_SIZE_LIMIT_BYTES,
  INDEX_TARGET_BYTES,
} from '../../memory-vacuum/domain/memory-index.analyzer';
import {
  VacuumAction,
  VacuumOutcome,
} from '../../memory-vacuum/domain/memory-index.type';
import { MemoryVacuumOutcome } from '../../memory-vacuum/domain/port/memory-vacuum.port';

const ACTION_LABEL: Record<VacuumAction['type'], string> = {
  orphan_indexed: '색인 누락 등록',
  broken_link_removed: '죽은 링크 제거',
  hook_trimmed: '설명 절단',
};

const toKilobytes = (bytes: number): string => `${(bytes / 1024).toFixed(1)}KB`;

const formatActions = (outcome: VacuumOutcome): string => {
  return outcome.actions
    .map((action) => `${ACTION_LABEL[action.type]} ${action.count}건`)
    .join(' · ');
};

// 청소 후에도 목표를 넘는 프로젝트 = 사람이 묶음·폐기를 판단해야 하는 곳.
// 같은 접두라고 주제가 같지는 않아 자동으로 묶지 않는다 — 후보만 들고 부른다.
const formatNeedsHuman = (outcome: VacuumOutcome): string => {
  const candidates = outcome.before.foldCandidates
    .slice(0, 3)
    .map((candidate) => `${candidate.prefix}(${candidate.count})`)
    .join(' · ');
  const tail = candidates.length > 0 ? ` — 묶음 후보 ${candidates}` : '';
  return `⚠️ ${outcome.project}: 청소 뒤에도 ${toKilobytes(outcome.remainingOverflowBytes)} 초과${tail}`;
};

export const formatMemoryVacuum = (
  { outcomes, failures }: MemoryVacuumOutcome,
  firedAtKst: string,
): string => {
  const cleaned = outcomes.filter((outcome) => outcome.actions.length > 0);
  const needsHuman = outcomes.filter(
    (outcome) => outcome.remainingOverflowBytes > 0,
  );
  const atRisk = outcomes.filter(
    (outcome) =>
      outcome.actions.length === 0 &&
      outcome.before.indexBytes > INDEX_TARGET_BYTES,
  );

  // 이상 0건에도 한 줄은 남긴다 — 주 1회 발화라 침묵으로 끊으면 "깨끗하다" 와
  // "청소기가 죽었다" 가 구분되지 않는다.
  if (
    cleaned.length === 0 &&
    needsHuman.length === 0 &&
    failures.length === 0
  ) {
    return [
      `🤖 기억 청소 — ${firedAtKst}`,
      `프로젝트 ${outcomes.length}곳 이상 없음 (상한 ${toKilobytes(INDEX_SIZE_LIMIT_BYTES)})`,
    ].join('\n');
  }

  const lines = [`🤖 기억 청소 — ${firedAtKst}`];
  for (const outcome of cleaned) {
    const after = outcome.before.indexBytes - outcome.remainingOverflowBytes;
    lines.push(
      `• ${outcome.project}: ${formatActions(outcome)} (${toKilobytes(outcome.before.indexBytes)} → ${toKilobytes(Math.max(0, after))})`,
    );
  }
  for (const outcome of needsHuman) {
    lines.push(formatNeedsHuman(outcome));
  }
  for (const outcome of atRisk) {
    lines.push(
      `• ${outcome.project}: ${toKilobytes(outcome.before.indexBytes)} — 상한에 근접`,
    );
  }
  for (const failure of failures) {
    lines.push(`🔴 ${failure.project}: ${failure.reason}`);
  }
  return lines.join('\n');
};
