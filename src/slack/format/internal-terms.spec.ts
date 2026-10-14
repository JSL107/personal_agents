import { STALE_RUN_SWEPT_ERROR } from '../../agent-run/domain/agent-run.type';
import { formatDelayReport } from './delay-report.formatter';
import { findInternalTerms } from './internal-terms';
import type { InternalTermsGuard } from './internal-terms.jest-setup';
import { toReadableSlackArgs } from './message-blocks.builder';

describe('findInternalTerms', () => {
  it('#816 에서 실제로 나간 문장을 잡는다', () => {
    expect(
      findInternalTerms(`CODE_REVIEWER 워커 — 실패 — ${STALE_RUN_SWEPT_ERROR}`),
    ).toEqual(['swept: stale IN_PROGRESS', 'CODE_REVIEWER']);
    expect(
      findInternalTerms('Knowledge Lint (episodic-memory 무결성)'),
    ).toEqual(['episodic-memory']);
    expect(findInternalTerms('중복 후보 — distance 0.000')).toEqual([
      'distance 0',
    ]);
    expect(findInternalTerms('PO_EVAL은 이번 주 안정적')).toEqual(['PO_EVAL']);
  });

  it('enum 값은 enum 에서 만든다 — 상태값도 잡는다', () => {
    expect(findInternalTerms('상태: FAILED')).toEqual(['FAILED']);
  });

  it('밑줄 없는 한 단어 enum 값은 보통 단어와 갈리지 않아 잡지 않는다', () => {
    expect(findInternalTerms('PM Agent 구현 마무리 · CEO 메타')).toEqual([]);
  });

  it('더 긴 단어의 일부는 잡지 않는다', () => {
    expect(findInternalTerms('CODE_REVIEWERS, FAILED_COUNT')).toEqual([]);
  });

  it('인라인 코드·코드 블록·URL 안의 식별자는 허용한다', () => {
    expect(findInternalTerms('• `[CODE_REVIEWER #42]` 2026-05-30')).toEqual([]);
    expect(findInternalTerms('```\nstatus=FAILED\n```')).toEqual([]);
    expect(
      findInternalTerms('<https://example.com/runs?type=CODE_REVIEWER|보기>'),
    ).toEqual([]);
  });

  it('사람 말로 옮긴 문장은 통과한다', () => {
    expect(
      findInternalTerms(
        '코드 리뷰 — 실패 — 30분 넘게 끝나지 않아 자동으로 정리됨',
      ),
    ).toEqual([]);
  });
});

// setup 배선 자체를 지킨다 — package.json 등록이 빠지거나 파일명 탐색이 깨지면 위 판정 함수가
// 멀쩡해도 어떤 spec 도 검사되지 않는다.
describe('internal-terms.jest-setup 배선', () => {
  const guard = (globalThis as { __internalTermsGuard?: InternalTermsGuard })
    .__internalTermsGuard;

  it('jest setupFilesAfterEnv 로 등록돼 있다', () => {
    expect(guard).toBeDefined();
  });

  it('포맷터·autopilot task·발송 인자 세 갈래를 파일명 규칙으로 감싼다', () => {
    expect([...(guard?.wrappedSources ?? [])]).toEqual(
      expect.arrayContaining([
        'slack/format/delay-report.formatter.ts formatDelayReport',
        'autopilot/infrastructure/tasks/run-sweeper.autopilot-task.ts RunSweeperAutopilotTask',
        'slack/format/message-blocks.builder.ts toReadableSlackArgs',
      ]),
    );
  });

  it('감싼 함수를 지나간 내부 식별자를 위반으로 모은다', () => {
    formatDelayReport({
      primaryCause: 'UNRESOLVED_FAILURE',
      detail: 'CODE_REVIEWER 실행이 실패했어요.',
      secondaryNotes: [],
      unavailableAxes: [],
      unverifiedHigherPriority: [],
      inconclusiveNotes: [],
    });
    toReadableSlackArgs('상태 FAILED');

    // 꺼내 가야 afterEach 가 이 테스트를 실패시키지 않는다.
    const taken = guard?.takeViolations() ?? [];
    expect(taken.map(({ source, terms }) => [source, terms])).toEqual([
      [
        'slack/format/delay-report.formatter.ts formatDelayReport',
        ['CODE_REVIEWER'],
      ],
      [
        'slack/format/message-blocks.builder.ts toReadableSlackArgs',
        ['FAILED'],
      ],
    ]);
  });
});
