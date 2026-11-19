import {
  MAX_EDITS_PER_FILE,
  precheckEdits,
  RUBRIC,
  scoreRubric,
} from './docs-audit-rubric';
import { RubricItemKey, RubricItemVerdict } from './docs-audit-rubric.type';

const judged = (
  failed: RubricItemKey[] = [],
  evidence = '',
): RubricItemVerdict[] =>
  RUBRIC.map((spec) => ({
    key: spec.key,
    passed: !failed.includes(spec.key),
    evidence,
  }));

describe('scoreRubric', () => {
  it('전부 예 → 100점·통과·피드백 없음', () => {
    expect(scoreRubric(judged())).toEqual({
      judgeable: true,
      pass: true,
      score: 100,
      failedRequired: [],
      feedback: '',
    });
  });

  it('필수 하나라도 아니오면 불통과, 실패 필수 항목을 돌려준다', () => {
    const result = scoreRubric(judged([RubricItemKey.SCOPED], '표현만 바꿈'));
    expect(result.pass).toBe(false);
    expect(result.score).toBe(80);
    expect(result.failedRequired).toEqual([RubricItemKey.SCOPED]);
    expect(result.feedback).toBe('scoped(범위 지킴): 표현만 바꿈');
  });

  it('가점 항목만 아니오면 통과 — 필수를 다 맞히면 최소 85점', () => {
    const result = scoreRubric(
      judged([RubricItemKey.CITED, RubricItemKey.STYLED]),
    );
    expect(result.pass).toBe(true);
    expect(result.score).toBe(85);
  });

  it('아니오인데 근거가 비면 "근거 누락" 으로 채운다', () => {
    const result = scoreRubric(judged([RubricItemKey.FACTUAL], '  '));
    expect(result.feedback).toBe('factual(사실 일치): 근거 누락');
  });

  it('항목이 빠지면 판정 불가 — 필수 전부 실패로 센다', () => {
    const result = scoreRubric(judged().slice(1));
    expect(result).toMatchObject({
      judgeable: false,
      pass: false,
      score: 0,
      failedRequired: [
        RubricItemKey.FACTUAL,
        RubricItemKey.COMPLETE,
        RubricItemKey.SCOPED,
      ],
    });
    expect(result.feedback).toContain('항목 누락: factual');
  });

  it('배점 합은 100', () => {
    expect(RUBRIC.reduce((sum, spec) => sum + spec.weight, 0)).toBe(100);
  });
});

describe('precheckEdits', () => {
  it('원문이 정확히 한 번 나오고 바뀌는 내용이 있으면 통과', () => {
    expect(
      precheckEdits({
        fullDoc: '기본값은 5 이다',
        edits: [{ oldString: '5', newString: '3' }],
      }),
    ).toEqual([]);
  });

  it('원문이 0회·2회면 편집 번호와 횟수를 사유로 낸다', () => {
    expect(
      precheckEdits({
        fullDoc: 'x y x',
        edits: [
          { oldString: 'z', newString: 'w' },
          { oldString: 'x', newString: 'w' },
        ],
      }),
    ).toEqual([
      'unique: 편집 #1 의 oldString 이 앞 편집까지 반영한 문서에 0회 나옴 (정확히 1회여야 함)',
      'unique: 편집 #2 의 oldString 이 앞 편집까지 반영한 문서에 2회 나옴 (정확히 1회여야 함)',
    ]);
  });

  it('앞 편집이 뒤 편집의 원문을 지우면 실패 — 적용기처럼 순서대로 센다', () => {
    expect(
      precheckEdits({
        fullDoc: 'abc 끝',
        edits: [
          { oldString: 'abc', newString: 'x' },
          { oldString: 'bc', newString: 'y' },
        ],
      }),
    ).toEqual([
      'unique: 편집 #2 의 oldString 이 앞 편집까지 반영한 문서에 0회 나옴 (정확히 1회여야 함)',
    ]);
  });

  it('앞 편집이 뒤 편집의 원문을 하나 더 만들면 실패', () => {
    expect(
      precheckEdits({
        fullDoc: '기본값 5, 상한 7',
        edits: [
          { oldString: '7', newString: '5' },
          { oldString: '5', newString: '3' },
        ],
      }),
    ).toEqual([
      'unique: 편집 #2 의 oldString 이 앞 편집까지 반영한 문서에 2회 나옴 (정확히 1회여야 함)',
    ]);
  });

  it('바꾸는 내용이 없는 편집은 실패', () => {
    expect(
      precheckEdits({
        fullDoc: 'a',
        edits: [{ oldString: 'a', newString: 'a' }],
      }),
    ).toEqual(['noop: 편집 #1 은 바꾸는 내용이 없음']);
  });

  it('편집 수 상한을 넘으면 실패', () => {
    const fullDoc = Array.from(
      { length: MAX_EDITS_PER_FILE + 1 },
      (_, index) => `줄${index}`,
    ).join('\n');
    const edits = Array.from(
      { length: MAX_EDITS_PER_FILE + 1 },
      (_, index) => ({
        oldString: `줄${index}\n`,
        newString: `행${index}\n`,
      }),
    );
    const reasons = precheckEdits({ fullDoc: `${fullDoc}\n`, edits });
    expect(reasons[0]).toBe(
      `edits: 편집 ${MAX_EDITS_PER_FILE + 1}개 — 파일당 최대 ${MAX_EDITS_PER_FILE}개`,
    );
  });
});
