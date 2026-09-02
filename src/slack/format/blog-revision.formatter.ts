import {
  BlogRevisionReport,
  BlogRevisionRow,
} from '../../agent/blog/application/measure-blog-revision.usecase';
import {
  compareRevisionWindows,
  REVISION_MIN_SAMPLE,
  RevisionTrend,
} from '../../agent/blog/domain/revision-rate';

// 두 주씩 끊어 비교한다. 주간 회차라 한 주 창은 발행 두세 편에 흔들리고, 네 주 창은 이번에
// 바꾼 것의 효과가 지난 회차에 묻힌다.
export const REVISION_WINDOW_DAYS = 14;

// 카드에 몇 편까지 낱개로 적을지. 많이 고친 순으로 자른다 — 나머지는 평균에 이미 들어 있다.
const DETAIL_LIMIT = 3;

const formatChange = (trend: RevisionTrend): string => {
  if (trend.changePercentPoint === null) {
    return `직전 구간과 견줄 표본이 모자랍니다(${REVISION_MIN_SAMPLE}편 필요)`;
  }
  if (trend.changePercentPoint === 0) {
    return `직전 ${trend.previous.averagePercent}%와 같습니다`;
  }
  const direction = trend.changePercentPoint < 0 ? '줄었습니다' : '늘었습니다';
  return `직전 ${trend.previous.averagePercent}%에서 ${Math.abs(
    trend.changePercentPoint,
  )}%p ${direction}`;
};

const formatRow = (row: BlogRevisionRow): string => {
  const name = row.path.replace(/^.*\//, '').replace(/\.md$/, '');
  return `• ${row.count.percent}% — ${name}`;
};

/**
 * 주간 블로그 수정률 카드.
 *
 * 숫자만 던지지 않는다 — 이 값이 무엇을 뜻하고 어느 쪽이 좋은 방향인지 카드 안에 적는다.
 * 「42%」만 보면 좋은 값인지 나쁜 값인지 읽는 사람이 알 수 없다.
 */
export const formatBlogRevision = (
  report: BlogRevisionReport,
  now: Date,
): string | null => {
  const trend = compareRevisionWindows(
    report.rows.map((row) => ({
      publishedAt: row.publishedAt,
      count: row.count,
    })),
    now,
    REVISION_WINDOW_DAYS,
  );

  if (trend.recent.postCount === 0) {
    // 이 구간에 발행이 없으면 보고할 것이 없다. 빈 카드를 보내지 않는다.
    return null;
  }

  const lines = [
    `📝 *블로그 수정률* — 최근 2주 *${trend.recent.averagePercent}%* (${trend.recent.postCount}편)`,
    `발행한 글을 사람이 다시 쓴 비율입니다. ${formatChange(trend)}. 낮을수록 손댈 데가 적었다는 뜻이에요.`,
  ];

  if (trend.recent.untouchedCount > 0) {
    lines.push(
      `그대로 둔 글 ${trend.recent.untouchedCount}편. 아직 읽지 않은 글도 여기 들어갑니다.`,
    );
  }

  const worst = [...report.rows]
    .sort((left, right) => right.count.percent - left.count.percent)
    .slice(0, DETAIL_LIMIT);
  if (worst.length > 0) {
    lines.push('', '많이 고친 글', ...worst.map(formatRow));
  }

  if (report.unmatchedCount > 0) {
    // 짝을 못 찾은 글이 늘면 평균이 실제보다 좋아 보인다. 표본에서 빠진 편수를 함께 적는다.
    lines.push(
      `\n짝을 못 찾은 글 ${report.unmatchedCount}편(발행 뒤 경로가 바뀌었거나 지워짐)`,
    );
  }

  return lines.join('\n');
};
