import { FindingStatus } from './pr-review-finding.type';

// 카테고리·상태별 카드 수. DB groupBy 결과를 그대로 받는다.
export interface CategoryStatusCount {
  category: string;
  status: string;
  count: number;
}

export interface CategoryAdoption {
  category: string;
  // ACKED(사람이 수용) + FIXED(말없이 고침)
  adopted: number;
  rejected: number;
  // 분모. adopted + rejected.
  total: number;
  // 표본이 ADOPTION_MIN_SAMPLE 미달이면 null — 비율을 내지 않는다.
  ratePercent: number | null;
  /**
   * 직전 구간 대비 채택률 변화(%p). 두 구간 **모두** 표본을 채웠을 때만 값이 있다.
   *
   * 이 필드가 없던 시절에는 누적 채택률만 있었고, 그래서 "규약을 실은 뒤 그 카테고리가
   * 나아졌나" 를 물어볼 수 없었다. 학습이 효과가 있었는지 재는 유일한 자리다.
   */
  changePercentPoint: number | null;
}

// 채택률을 말하기 위한 최소 표본. 3~4건으로 비율을 내면 그 숫자가 판단 근거로 쓰이면서
// 사실상 추측이 된다. 미달 카테고리는 비율 대신 표본 수만 노출한다.
export const ADOPTION_MIN_SAMPLE = 10;

/**
 * 한 구간의 길이(일). 최근 이 기간과 그 직전 같은 기간을 비교한다.
 *
 * 14일인 이유는 표본이다. 실측(2026-08-26) 상 결론 카드가 주당 70~130건 나오는데,
 * 30일로 자르면 이 루프가 실제로 돈 기간(8월 이후) 안에서 직전 구간이 거의 비어
 * 비교가 서지 않는다. 반대로 7일은 주말 PR 공백에 흔들린다.
 */
export const ADOPTION_WINDOW_DAYS = 14;

// 결론이 난 카드만 분모에 넣는다. OPEN(미열람)·STALE(결론 없이 PR 종료)·SUPPRESSED·
// RESOLVED(과거 호환)는 채택/기각 어느 쪽도 아니므로 제외한다.
// `satisfies` 로 오타를 컴파일 타임에 잡고, 조회는 Set<string> 으로 해 DB 문자열을
// 캐스팅 없이 받는다.
const DENOMINATOR_STATUSES = new Set<string>([
  'ACKED',
  'FIXED',
  'REJECTED',
] satisfies FindingStatus[]);
const ADOPTED_STATUSES = new Set<string>([
  'ACKED',
  'FIXED',
] satisfies FindingStatus[]);

interface CategoryTally {
  adopted: number;
  rejected: number;
}

const tallyByCategory = (
  rows: CategoryStatusCount[],
): Map<string, CategoryTally> => {
  const tallies = new Map<string, CategoryTally>();
  for (const { category, status, count } of rows) {
    // 분모에 안 드는 상태는 여기서 걸러진다 — 그래서 결론이 하나도 없는 카테고리는
    // Map 에 등장하지 않고 결과에서 자연히 빠진다.
    if (!DENOMINATOR_STATUSES.has(status)) {
      continue;
    }
    const found = tallies.get(category) ?? { adopted: 0, rejected: 0 };
    if (ADOPTED_STATUSES.has(status)) {
      found.adopted += count;
    } else {
      found.rejected += count;
    }
    tallies.set(category, found);
  }
  return tallies;
};

// 표본 미달이면 null. 두 구간이 같은 판정을 쓰게 한 곳에 모은다 — 직전 구간에만 하한을
// 빼면 4건짜리 비율이 변화량의 기준선이 되어, 감추려던 추측이 화살표로 되살아난다.
const ratePercentOf = (tally: CategoryTally | undefined): number | null => {
  if (tally === undefined) {
    return null;
  }
  const total = tally.adopted + tally.rejected;
  if (total < ADOPTION_MIN_SAMPLE) {
    return null;
  }
  return Math.round((tally.adopted / total) * 100);
};

/**
 * 최근 구간의 카테고리별 채택률과, 직전 같은 길이 구간 대비 변화를 낸다.
 *
 * `prior` 는 비교 기준선일 뿐이라 결과 목록에 등장하지 않는다 — 최근 구간에 결론이
 * 하나도 없는 카테고리는 지금 말할 것이 없으므로 빠지는 편이 맞다.
 */
export const summarizeAdoption = (
  recent: CategoryStatusCount[],
  prior: CategoryStatusCount[],
): CategoryAdoption[] => {
  const recentTallies = tallyByCategory(recent);
  const priorTallies = tallyByCategory(prior);

  return (
    [...recentTallies.entries()]
      .map(([category, { adopted, rejected }]) => {
        const ratePercent = ratePercentOf({ adopted, rejected });
        const priorRatePercent = ratePercentOf(priorTallies.get(category));
        return {
          category,
          adopted,
          rejected,
          total: adopted + rejected,
          ratePercent,
          changePercentPoint:
            ratePercent !== null && priorRatePercent !== null
              ? ratePercent - priorRatePercent
              : null,
        };
      })
      // 표본이 많은 카테고리를 먼저. 동률은 이름 순으로 고정해 출력이 실행마다 흔들리지 않게 한다.
      .sort((left, right) =>
        right.total === left.total
          ? left.category.localeCompare(right.category)
          : right.total - left.total,
      )
  );
};
