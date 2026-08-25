// 기각당한 지적을 레포 규약으로 되먹이는 조각.
//
// 왜 "예시" 가 아니라 "규약" 인가 — 기존 되먹임은 프롬프트 맨 끝에 [과거에 무시한 리뷰 패턴]
// 이라는 예시 두 줄을 덧붙였고, 실측 결과 행동을 바꾸지 못했다. 같은 ARCHITECTURE 지적이
// 3연속 기각되고도 계속 나왔으며, 그중 한 회차는 관련 사례가 실제로 주입된 상태였다.
// 반대로 프롬프트에 규칙으로 못 박은 항목(마이그레이션 오탐)은 그 뒤 재발이 0건이다.
// 그래서 이 블록은 SELF_REPO_CONVENTIONS 와 같은 자리에, 같은 형식으로 실린다.
//
// 차단이 아니라 맥락이다. 지적을 막는 게 아니라 이 레포의 사정을 알려주는 것이라,
// 규약이 이번 diff 에 해당하지 않으면 모델이 평소대로 지적할 수 있다.

export interface RejectedConventionRow {
  category: string;
  rejectReason: string;
  resolvedAt: Date;
}

/** 한 번의 기각은 그 PR 사정일 수 있다. 두 번부터 레포 성향으로 본다. */
export const MIN_REJECTIONS_PER_CATEGORY = 2;

/** 카테고리당 노출 상한. 전건을 실으면 기각이 많은 카테고리가 프롬프트를 희석한다. */
export const MAX_REASONS_PER_CATEGORY = 2;

/** 기각 이유 길이 상한. 실측상 이 길이면 판단과 근거 시작까지 들어간다. */
export const MAX_REASON_LENGTH = 400;

/**
 * 기각 이유 길이 하한. 이보다 짧으면 규약 재료로 쓰지 않는다.
 *
 * 실 데이터에서 이유 길이는 9~14자(`미반영 근거를 제시함` 류 한 줄 요약)와 260자 이상
 * (판단 + 근거)으로 깨끗이 갈린다. 한 줄 요약은 무엇이 왜 틀렸는지가 없어 읽어도 배울 게
 * 없는데, 최신이라는 이유로 근거가 실린 사례를 밀어냈다 — 실제로 `미반영 근거를 제시함`
 * 이 ARCHITECTURE 노출 2칸 중 하나를 차지했다. 이유 없는 기각을 빼는 것과 같은 이유다.
 */
export const MIN_REASON_LENGTH = 40;

// 보안은 건수가 차도 학습하지 않는다. 바빠서 넘긴 경고를 규약으로 굳히면
// 그 종류의 지적이 통째로 조용해지고, 조용하기 때문에 발견이 늦는다.
const NEVER_LEARNED_CATEGORIES = new Set(['SECURITY']);

// 기각 이유는 여러 줄 산문이고 코드블록도 섞인다. 그대로 실으면 상한에서 잘릴 때
// 열린 코드펜스나 목록 조각이 남아 어디까지가 한 항목인지 흐려진다 — 한 줄로 눌러
// 불릿 하나 = 한 항목이 되게 한다.
const flatten = (reason: string): string => reason.trim().replace(/\s+/g, ' ');

const truncate = (reason: string): string => {
  const flattened = flatten(reason);
  if (flattened.length <= MAX_REASON_LENGTH) {
    return flattened;
  }
  return `${flattened.slice(0, MAX_REASON_LENGTH)}…`;
};

const groupByCategory = (
  rows: RejectedConventionRow[],
): Map<string, RejectedConventionRow[]> => {
  const grouped = new Map<string, RejectedConventionRow[]>();
  for (const row of rows) {
    if (NEVER_LEARNED_CATEGORIES.has(row.category)) {
      continue;
    }
    if (flatten(row.rejectReason).length < MIN_REASON_LENGTH) {
      continue;
    }
    const bucket = grouped.get(row.category) ?? [];
    bucket.push(row);
    grouped.set(row.category, bucket);
  }
  return grouped;
};

export interface LearnedConventions {
  /** 프롬프트에 덧붙일 규약 블록. 실을 것이 없으면 빈 문자열. */
  block: string;
  /** 규약이 선 카테고리. 무엇이 학습됐는지 운영 로그로 남기는 용도. */
  categories: string[];
}

/**
 * 이 레포에서 반복 기각된 지적을 프롬프트 규약 블록으로 만든다.
 * 임계 미달이거나 실을 것이 없으면 빈 블록 — 프롬프트에 아무것도 더하지 않는다.
 */
export const renderLearnedConventions = (
  rows: RejectedConventionRow[],
): LearnedConventions => {
  const grouped = groupByCategory(rows);
  const sections: string[] = [];
  const categories: string[] = [];

  for (const category of [...grouped.keys()].sort()) {
    const bucket = grouped.get(category) ?? [];
    if (bucket.length < MIN_REJECTIONS_PER_CATEGORY) {
      continue;
    }
    const recent = [...bucket]
      .sort(
        (left, right) => right.resolvedAt.getTime() - left.resolvedAt.getTime(),
      )
      .slice(0, MAX_REASONS_PER_CATEGORY);
    const lines = recent
      .map((item) => `• ${truncate(item.rejectReason)}`)
      .join('\n');
    sections.push(`### ${category} (기각 ${bucket.length}건)\n${lines}`);
    categories.push(category);
  }

  if (sections.length === 0) {
    return { block: '', categories: [] };
  }

  const block = `

[이 레포에서 기각된 지적과 그 이유 — 같은 지적을 되풀이하지 않는다]
아래는 실제로 이 레포에 냈다가 "이 레포에서는 정상" 이라는 이유로 기각된 지적이다.
같은 성격의 지적을 하기 전에 그 이유가 이번 diff 에도 적용되는지 먼저 확인하고, 적용되면 지적하지 않는다.

${sections.join('\n\n')}

이유가 이번 변경에 해당하지 않으면 평소대로 판단한다. 규약을 이유로 실제 결함을 덮지 말 것.`;

  return { block, categories };
};
