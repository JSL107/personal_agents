import { STALE_RUN_SWEPT_ERROR } from '../../agent-run/domain/agent-run.type';
import { findInternalTerms } from './internal-terms';

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
