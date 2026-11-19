import { countOccurrences } from '../../common/util/text-occurrence.util';
import {
  FindVerdictParams,
  PrecheckEditsParams,
  RubricItemKey,
  RubricItemSpec,
  RubricItemVerdict,
  RubricScore,
} from './docs-audit-rubric.type';

// 통과 = required 항목이 모두 "예". weight 는 기록·표시용 점수에만 쓰인다
// (required 를 다 맞히면 최소 85점이라 점수 선과 통과 조건이 따로 놀 수 없다).
export const RUBRIC: readonly RubricItemSpec[] = [
  {
    key: RubricItemKey.FACTUAL,
    label: '사실 일치',
    question:
      '바뀐 문장에 들어간 이름·수치·기본값이 모두 코드 발췌에서 확인되는가',
    weight: 40,
    required: true,
  },
  {
    key: RubricItemKey.COMPLETE,
    label: '빠짐없음',
    question: '문서 발췌에서 코드와 어긋난 문장을 모두 고쳤는가',
    weight: 25,
    required: true,
  },
  {
    key: RubricItemKey.SCOPED,
    label: '범위 지킴',
    question:
      '코드와 관계없는 문장(표현 다듬기, 순서 바꾸기)은 건드리지 않았는가',
    weight: 20,
    required: true,
  },
  {
    key: RubricItemKey.CITED,
    label: '근거 제시',
    question: '편집마다 근거가 된 코드 줄을 제시할 수 있는가',
    weight: 10,
    required: false,
  },
  {
    key: RubricItemKey.STYLED,
    label: '형식 유지',
    question: '문서의 문체·표·목록 구조를 유지했는가',
    weight: 5,
    required: false,
  },
];

export const REQUIRED_RUBRIC_KEYS: readonly RubricItemKey[] = RUBRIC.filter(
  (spec) => spec.required,
).map((spec) => spec.key);

// 과수정의 기계적 상한. 감시 대상이 README 한 곳이라 env 로 뺄 만큼 갈리지 않는다.
export const MAX_EDITS_PER_FILE = 8;

const MISSING_EVIDENCE = '근거 누락';

const findVerdict = ({
  items,
  key,
}: FindVerdictParams): RubricItemVerdict | undefined =>
  items.find((item) => item.key === key);

export const scoreRubric = (
  items: readonly RubricItemVerdict[],
): RubricScore => {
  const missing = RUBRIC.filter(
    (spec) => findVerdict({ items, key: spec.key }) === undefined,
  );
  if (missing.length > 0) {
    const missingKeys = missing.map((spec) => spec.key).join(', ');
    return {
      judgeable: false,
      pass: false,
      score: 0,
      failedRequired: [...REQUIRED_RUBRIC_KEYS],
      feedback: `평가 응답 형식 오류 — 항목 누락: ${missingKeys}`,
    };
  }

  const judged = RUBRIC.map((spec) => ({
    spec,
    verdict: findVerdict({ items, key: spec.key }) as RubricItemVerdict,
  }));
  const score = judged
    .filter(({ verdict }) => verdict.passed)
    .reduce((sum, { spec }) => sum + spec.weight, 0);
  const failed = judged.filter(({ verdict }) => !verdict.passed);
  const failedRequired = failed
    .filter(({ spec }) => spec.required)
    .map(({ spec }) => spec.key);
  const feedback = failed
    .map(({ spec, verdict }) => {
      const evidence = verdict.evidence.trim() || MISSING_EVIDENCE;
      return `${spec.key}(${spec.label}): ${evidence}`;
    })
    .join('\n');
  return {
    judgeable: true,
    pass: failedRequired.length === 0,
    score,
    failedRequired,
    feedback,
  };
};

// 평가자를 부르기 전에 코드가 확인할 수 있는 것. 실패 사유가 하나라도 있으면 그 회차는 실패다.
// 원문 유일성은 적용기(DocsRevisionApplier)와 같은 기준 — 지금까지는 확정 뒤 적용 단계에서야
// 조용히 빠져, 확정된 제안이 일부만 적용될 수 있었다.
export const precheckEdits = ({
  fullDoc,
  edits,
}: PrecheckEditsParams): string[] => {
  const tooMany =
    edits.length > MAX_EDITS_PER_FILE
      ? [`edits: 편집 ${edits.length}개 — 파일당 최대 ${MAX_EDITS_PER_FILE}개`]
      : [];
  const perEdit = [...edits.entries()].flatMap(([index, edit]) => {
    const label = `편집 #${index + 1}`;
    if (edit.oldString === edit.newString) {
      return [`noop: ${label} 은 바꾸는 내용이 없음`];
    }
    const occurrences = countOccurrences({
      source: fullDoc,
      text: edit.oldString,
    });
    if (occurrences !== 1) {
      return [
        `unique: ${label} 의 oldString 이 문서에 ${occurrences}회 나옴 (정확히 1회여야 함)`,
      ];
    }
    return [];
  });
  return [...tooMany, ...perEdit];
};
