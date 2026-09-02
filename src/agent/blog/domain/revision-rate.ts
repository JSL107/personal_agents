// 발행한 글을 사람이 얼마나 고쳤는지 재는 지표.
//
// 발행 경로의 다른 판정은 전부 하한선이거나 훼손 방지다. 편집 단계는 「필기인가 · 주제가 있나 ·
// 800자 넘나 · 틀렸나」만 보고, 문체 지표는 카드에 숫자를 적을 뿐 발행을 막지 않는다. 좋은 글과
// 그저 그런 글을 가르는 자리가 없다.
//
// 그 자리를 사람이 이미 메우고 있다 — 발행된 글을 다시 열어 고친다. 고친 양이 곧 판정이다.
// 많이 고쳤으면 그만큼 안 좋았던 것이고, 손댈 데가 없으면 좋았던 것이다.

export interface RevisionCount {
  addedLines: number;
  removedLines: number;
  /** 발행본 줄 수. 분모다. */
  totalLines: number;
  /** (추가 + 삭제) / 발행본 줄 수. 늘려 쓴 글은 100을 넘을 수 있다. */
  percent: number;
}

/**
 * 두 판의 차이를 줄 수로 잰다.
 *
 * 순서를 보지 않는 멀티셋 비교다 — 같은 줄이 양쪽에 있으면 자리를 옮겼어도 유지로 센다.
 * `git diff` 의 LCS 와 값이 갈리는 경우가 문단을 통째로 옮긴 글인데, 윤문·편집에서 그런 이동은
 * 드물고 대부분 문장 수정이라 실측 차이가 작다. 정확한 diff 를 얻자고 라이브러리를 들이거나
 * 서버에서 git 을 실행하는 것보다, **한 자리에서 계산해 스크립트와 서버가 같은 값을 보는 것**이
 * 이 지표에는 더 중요하다.
 */
export const countRevision = (
  published: string,
  final: string,
): RevisionCount => {
  const before = published.split('\n');
  const after = final.split('\n');

  const remaining = new Map<string, number>();
  for (const line of before) {
    remaining.set(line, (remaining.get(line) ?? 0) + 1);
  }

  let kept = 0;
  for (const line of after) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) {
      kept += 1;
      remaining.set(line, left - 1);
    }
  }

  const removedLines = before.length - kept;
  const addedLines = after.length - kept;
  return {
    addedLines,
    removedLines,
    totalLines: before.length,
    percent:
      before.length === 0
        ? 0
        : Math.round(((addedLines + removedLines) / before.length) * 100),
  };
};

export interface RevisionSummary {
  postCount: number;
  averagePercent: number;
  /** 손댈 데가 없던 글. 이 수가 늘어나는 것이 목표다. */
  untouchedCount: number;
}

export const summarizeRevisions = (
  counts: readonly RevisionCount[],
): RevisionSummary => {
  if (counts.length === 0) {
    return { postCount: 0, averagePercent: 0, untouchedCount: 0 };
  }
  const total = counts.reduce((sum, count) => sum + count.percent, 0);
  return {
    postCount: counts.length,
    averagePercent: Math.round(total / counts.length),
    untouchedCount: counts.filter((count) => count.percent === 0).length,
  };
};

/**
 * 비율을 말하기 위한 최소 표본.
 *
 * 3 인 이유는 실측 규모다 — 2026-08 기준 발행이 4주에 9편이라 2주 창에 4~5편이 들어온다.
 * 10 을 요구하면 창이 영영 안 차고, 1~2 편으로 비율을 내면 그 글 한 편이 눈금을 통째로
 * 흔든다. 발행이 잦아지면 이 값부터 올려라.
 */
export const REVISION_MIN_SAMPLE = 3;

export interface RevisionTrend {
  recent: RevisionSummary;
  previous: RevisionSummary;
  /**
   * 직전 구간 대비 변화(%p). **두 구간 모두 표본을 채웠을 때만 값이 있다.**
   *
   * 이 필드가 학습이 효과를 냈는지 재는 유일한 자리다. 평균만 보면 「이번 주 54%」가 좋은
   * 값인지 나쁜 값인지 알 수 없다. 음수가 개선이다 — 사람이 덜 고쳤다는 뜻이다.
   */
  changePercentPoint: number | null;
}

interface DatedRevision {
  publishedAt: Date;
  count: RevisionCount;
}

/**
 * 최근 창과 그 직전 같은 길이의 창을 비교한다.
 *
 * 구간을 발행 시각으로 나누는 이유 — 사람이 글을 고치는 시점은 발행보다 늦고 여러 글을 한꺼번에
 * 고치기도 한다(실측: 수정 PR 하나가 8월 글 7편을 함께 손봤다). 수정 시각으로 묶으면 그 하루에
 * 전부 몰려 창이 뒤틀리므로, 「언제 쓴 글이 얼마나 고쳐졌나」로 본다.
 */
export const compareRevisionWindows = (
  rows: readonly DatedRevision[],
  now: Date,
  windowDays: number,
): RevisionTrend => {
  const dayMs = 24 * 60 * 60 * 1000;
  const recentSince = now.getTime() - windowDays * dayMs;
  const previousSince = now.getTime() - windowDays * 2 * dayMs;

  const inWindow = (row: DatedRevision, from: number, to: number): boolean => {
    const at = row.publishedAt.getTime();
    return at >= from && at < to;
  };

  const recent = summarizeRevisions(
    rows
      .filter((row) => inWindow(row, recentSince, now.getTime()))
      .map((row) => row.count),
  );
  const previous = summarizeRevisions(
    rows
      .filter((row) => inWindow(row, previousSince, recentSince))
      .map((row) => row.count),
  );

  const comparable =
    recent.postCount >= REVISION_MIN_SAMPLE &&
    previous.postCount >= REVISION_MIN_SAMPLE;
  return {
    recent,
    previous,
    changePercentPoint: comparable
      ? recent.averagePercent - previous.averagePercent
      : null,
  };
};
