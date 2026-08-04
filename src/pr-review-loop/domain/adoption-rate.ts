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
}

// 채택률을 말하기 위한 최소 표본. 3~4건으로 비율을 내면 그 숫자가 판단 근거로 쓰이면서
// 사실상 추측이 된다. 미달 카테고리는 비율 대신 표본 수만 노출한다.
export const ADOPTION_MIN_SAMPLE = 10;

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

export const summarizeAdoption = (
  rows: CategoryStatusCount[],
): CategoryAdoption[] => {
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
  return (
    [...tallies.entries()]
      .map(([category, { adopted, rejected }]) => {
        const total = adopted + rejected;
        return {
          category,
          adopted,
          rejected,
          total,
          ratePercent:
            total >= ADOPTION_MIN_SAMPLE
              ? Math.round((adopted / total) * 100)
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
