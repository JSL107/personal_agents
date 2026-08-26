// 지난 윤문본의 문체 갭을 다음 윤문 프롬프트에 되먹인다.
//
// 문체 지표는 발행 카드에 찍히고 사라졌다(`publish-notion-draft.usecase.ts`). 목표 밖 항목을
// 골라내는 판정(`findKoreanStyleGaps`)까지 이미 있었는데, 그 결과가 어디에도 남지 않아
// 다음 윤문은 같은 항목을 또 벗어났다. "차단 임계값은 발행본이 몇 편 쌓인 뒤에 정한다" 는
// 주석이 붙어 있었지만, 쌓이는 자리가 없어 그 조건은 스스로 충족될 수 없었다.
//
// 여기서도 차단하지 않는다. 반복된 항목을 알려줄 뿐이고, 무엇을 어떻게 고칠지는 윤문
// 프롬프트의 기존 규칙이 정한다.

import { KOREAN_STYLE_UNJUDGED_AXES } from './korean-style-metrics';

export interface StyleFeedbackRun {
  /** `findKoreanStyleGaps` 결과. `편차 12.3(≥15)` 처럼 "항목 값(기준)" 꼴이다. */
  gaps: string[];
}

/**
 * 실행 원장의 `output` 에서 문체 갭을 꺼낸다. 형태가 다르면 null —
 * 원장에는 이 필드가 없던 시절의 회차가 섞여 있고, 그 회차는 표본에서 빠져야 한다.
 */
export const toStyleFeedbackRun = (
  output: unknown,
): StyleFeedbackRun | null => {
  if (typeof output !== 'object' || output === null) {
    return null;
  }
  const gaps = (output as { styleGaps?: unknown }).styleGaps;
  if (!Array.isArray(gaps)) {
    return null;
  }
  if (!gaps.every((gap): gap is string => typeof gap === 'string')) {
    return null;
  }
  return { gaps };
};

/** 이 횟수 이상 반복된 항목만 싣는다. 한 번 벗어난 것은 그 글의 사정일 수 있다. */
export const MINIMUM_REPEAT_COUNT = 2;

/**
 * 지금 판정 축이 아닌 항목은 싣지 않는다.
 *
 * 원장에는 **그때의 판정 결과**가 남는다. 축을 내려도 이미 적재된 회차의 갭은 그대로라,
 * 거르지 않으면 내린 축이 최근 표본이 밀려날 때까지(최대 `STYLE_FEEDBACK_RUNS` 편) 계속
 * 프롬프트로 들어간다 — 2026-08-26 에 편차·짧은문장·구어를 내렸을 때 원장에는 「편차
 * 9.6(≥11)」 회차가 5편 있었다. 판정 축은 코드가 정하므로 소비 지점에서 현재 축으로
 * 다시 거른다. 다음에 축을 또 바꿔도 이 필터가 알아서 맞는다.
 */
const isJudgedLabel = (label: string): boolean =>
  !KOREAN_STYLE_UNJUDGED_AXES.some((axis) => axis === label);

interface GapTally {
  label: string;
  count: number;
  /** 가장 최근 회차의 원문. 지금 어느 정도인지 숫자로 보여준다. */
  latest: string;
}

// 갭 문자열의 첫 토큰이 항목 이름이다(`편차`·`짧은문장`·`종결체교대`…). 값과 기준은
// 회차마다 달라 문자열 전체로 세면 같은 항목이 매번 다른 항목으로 잡힌다.
const labelOf = (gap: string): string => gap.split(' ')[0] ?? gap;

const tally = (runs: StyleFeedbackRun[]): GapTally[] => {
  const byLabel = new Map<string, GapTally>();
  // runs 는 최신순이므로 먼저 만난 것이 최근 값이다.
  for (const item of runs) {
    for (const gap of item.gaps) {
      const label = labelOf(gap);
      if (!isJudgedLabel(label)) {
        continue;
      }
      const found = byLabel.get(label);
      if (found === undefined) {
        byLabel.set(label, { label, count: 1, latest: gap });
        continue;
      }
      found.count += 1;
    }
  }
  return [...byLabel.values()]
    .filter((item) => item.count >= MINIMUM_REPEAT_COUNT)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.label.localeCompare(right.label);
    });
};

/**
 * 최근 윤문본에서 반복된 문체 갭을 프롬프트 블록으로 만든다.
 * 반복된 항목이 없으면 빈 문자열 — 프롬프트에 아무것도 더하지 않는다.
 *
 * `runs` 는 **최신순**이어야 한다.
 */
export const renderStyleFeedback = (runs: StyleFeedbackRun[]): string => {
  const repeated = tally(runs);
  if (repeated.length === 0) {
    return '';
  }
  const lines = repeated
    .map((item) => `• ${item.count}/${runs.length}편 — ${item.latest}`)
    .join('\n');

  return `

[최근 윤문본에서 되풀이된 문체 갭]
아래 항목이 최근 글들에서 반복해서 목표를 벗어났다. 괄호 안이 목표 범위다.
${lines}

이번 글에서는 이 항목들을 특히 살펴라. 다른 규칙을 어겨 가며 맞추지는 말 것 — 내용과 의미는 그대로 두는 것이 먼저다.`;
};
