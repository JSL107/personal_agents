import { VacuumOutcome } from '../../memory-vacuum/domain/memory-index.type';
import { MemoryVacuumOutcome } from '../../memory-vacuum/domain/port/memory-vacuum.port';
import { formatMemoryVacuum } from './memory-vacuum.formatter';

const buildOutcome = (
  overrides: Partial<VacuumOutcome> = {},
): VacuumOutcome => ({
  project: 'p',
  before: {
    project: 'p',
    indexBytes: 49_000,
    entryCount: 300,
    fileCount: 330,
    dust: { orphans: [], brokenLinks: [], overflowBytes: 19_000 },
    foldCandidates: [],
  },
  actions: [{ type: 'hook_trimmed', count: 240 }],
  nextIndexContent: '새 색인',
  nextIndexBytes: 15_000,
  remainingOverflowBytes: 0,
  ...overrides,
});

const format = (outcome: MemoryVacuumOutcome): string =>
  formatMemoryVacuum(outcome, '2026-09-09');

describe('formatMemoryVacuum', () => {
  it('청소 후 크기를 실제 결과 바이트로 보고한다', () => {
    // 초과분(remainingOverflowBytes)으로 되계산하면 목표 밑으로 잘 줄인 회차가 0 이 되어
    // `49.0KB → 49.0KB`(줄인 것이 없음)로 뒤집힌다.
    const text = format({ outcomes: [buildOutcome()], failures: [] });

    expect(text).toContain('47.9KB → 14.6KB');
  });

  it('이상 0건에도 한 줄은 남긴다', () => {
    // 주 1회 발화라 침묵으로 끊으면 "깨끗하다" 와 "청소기가 죽었다" 가 구분되지 않는다.
    const text = format({
      outcomes: [
        buildOutcome({
          actions: [],
          nextIndexContent: null,
          nextIndexBytes: 10_000,
          before: { ...buildOutcome().before, indexBytes: 10_000 },
        }),
      ],
      failures: [],
    });

    expect(text).toContain('이상 없음');
  });

  it('청소 뒤에도 초과면 묶음 후보와 함께 사람을 부른다', () => {
    const text = format({
      outcomes: [
        buildOutcome({
          remainingOverflowBytes: 2_048,
          nextIndexBytes: 28_048,
          before: {
            ...buildOutcome().before,
            foldCandidates: [{ prefix: 'feedback_codex_', count: 11 }],
          },
        }),
      ],
      failures: [],
    });

    expect(text).toContain('2.0KB 초과');
    expect(text).toContain('feedback_codex_(11)');
  });

  it('실패는 사유와 함께 드러낸다', () => {
    const text = format({
      outcomes: [],
      failures: [{ project: 'locked', reason: '색인 읽기 실패 — EACCES' }],
    });

    expect(text).toContain('locked');
    expect(text).toContain('EACCES');
  });
});
