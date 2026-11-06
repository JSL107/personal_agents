import { getKstDateOf, kstDayStartOf } from '../../common/util/kst-date.util';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import {
  FirstLineType,
  InsightMetrics,
  InsightSnapshot,
  REEL_FEATURES_VERSION,
  ReelFeatures,
  SnapshotError,
  SnapshotWindow,
  TitleForm,
} from '../domain/instagram-insight.type';
import {
  InstagramPost,
  InstagramPostField,
} from '../domain/instagram-post.type';

export interface WeeklyReportInput {
  weekStartKst: string;
  weekEndKst: string;
  now: Date;
  // 누적 비교에 쓰므로 지난주 것만이 아니라 게시된 행 전부.
  posts: InstagramPost[];
  snapshots: InsightSnapshot[];
}

interface Group {
  label: string;
  size: number;
  skipRates: number[];
  shareRatios: number[];
}

type ComparableReel = {
  features: ReelFeatures;
  metrics: InsightMetrics;
};

// 칸마다 이 수보다 적으면 숫자를 내지 않는다. 한두 편으로 묶은 중앙값은 우연에 가깝다.
const MIN_GROUP_SIZE = 3;
const STORY_EXPIRES_MINUTES = 1440;
const WINDOW_ORDER = [SnapshotWindow.H24, SnapshotWindow.D3, SnapshotWindow.D7];
const FIRST_LINE_LABELS: Record<FirstLineType, string> = {
  [FirstLineType.QUESTION]: '질문형',
  [FirstLineType.NUMBER]: '숫자형',
  [FirstLineType.STATEMENT]: '상황형',
};
const TITLE_LABELS: Record<TitleForm, string> = {
  [TitleForm.RESULT]: '결과형',
  [TitleForm.QUESTION]: '질문형',
  [TitleForm.STATEMENT]: '서술형',
};
const LENGTH_BUCKETS = ['<45초', '45~55초', '>55초'];

// 숫자만 보여 준다. "어느 쪽이 낫다" 같은 판단은 사람이 한다(스펙 §4.2).
export const formatWeeklyInsightReport = (
  input: WeeklyReportInput,
): string | null => {
  const inWeek = input.posts.filter((post) => {
    const day = post.publishedAt ? getKstDateOf(post.publishedAt) : null;
    return day !== null && day >= input.weekStartKst && day <= input.weekEndKst;
  });
  if (inWeek.length === 0) {
    return null;
  }
  const byPost = groupSnapshots(input.snapshots);
  const reels = inWeek.filter(
    (post) => post.field !== InstagramPostField.STORY,
  );
  const stories = inWeek.filter(
    (post) => post.field === InstagramPostField.STORY,
  );

  const lines = [headerLine(input), '', `[지난주 릴스 ${reels.length}편]`];
  for (const reel of reels) {
    lines.push(...reelLines(reel, byPost.get(reel.id) ?? []));
  }
  if (stories.length > 0) {
    lines.push(storyLine({ stories, byPost, now: input.now }));
  }
  lines.push('', ...comparisonLines(input.posts, byPost));
  return lines.join('\n');
};

export const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const groupSnapshots = (
  snapshots: InsightSnapshot[],
): Map<string, InsightSnapshot[]> => {
  const byPost = new Map<string, InsightSnapshot[]>();
  for (const snapshot of snapshots) {
    byPost.set(snapshot.postId, [
      ...(byPost.get(snapshot.postId) ?? []),
      snapshot,
    ]);
  }
  return byPost;
};

// 팔로워는 그 주 월요일 0시부터 지금까지 찍힌 스냅숏의 처음과 마지막 값이다.
const headerLine = (input: WeeklyReportInput): string => {
  const range = `${shortDate(input.weekStartKst)}~${shortDate(input.weekEndKst)}`;
  const from = kstDayStartOf(input.weekStartKst).getTime();
  const counts = input.snapshots
    .filter(
      (snapshot) =>
        snapshot.followersCount !== null &&
        snapshot.capturedAt.getTime() >= from &&
        snapshot.capturedAt.getTime() <= input.now.getTime(),
    )
    .sort(
      (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
    )
    .map((snapshot) => snapshot.followersCount as number);
  const followers =
    counts.length === 0
      ? '팔로워 -'
      : `팔로워 ${counts[0]} → ${counts[counts.length - 1]} (${signed(counts[counts.length - 1] - counts[0])})`;
  return `📊 스킬쟁이 주간 리포트 (${range}) · ${followers}`;
};

const reelLines = (
  post: InstagramPost,
  snapshots: InsightSnapshot[],
): string[] => {
  const day = post.publishedAt
    ? shortDate(getKstDateOf(post.publishedAt))
    : '-';
  const title = `${day} 「${escapeSlackMrkdwn(post.title)}」`;
  const head = post.features
    ? `${title} ${describeFeatures(post.features)}`
    : `${title} (특성 없음)`;
  const latest = latestReelSnapshot(snapshots);
  if (!latest) {
    return [head, '  아직 수집 전'];
  }
  const missingD7 =
    latest.snapshotWindow === SnapshotWindow.D7 ? '' : ' (D7 미수집)';
  return [
    head,
    `  ${latest.snapshotWindow} ${describeMetrics(latest.metrics)}${missingD7}`,
  ];
};

const describeFeatures = (features: ReelFeatures): string =>
  [
    `${Math.round(features.durationSec)}초`,
    `${features.segmentFields.length}꼭지`,
    `${FIRST_LINE_LABELS[features.firstLineType]}/${TITLE_LABELS[features.titleForm]}`,
    features.firstLine.gesture,
  ].join(' ');

const describeMetrics = (metrics: InsightMetrics): string =>
  [
    `조회 ${orDash(metrics.views)}`,
    `도달 ${orDash(metrics.reach)}`,
    `스킵 ${metrics.skipRate === null ? '-' : `${Math.round(metrics.skipRate)}%`}`,
    `평균 ${metrics.avgWatchMs === null ? '-' : `${(metrics.avgWatchMs / 1000).toFixed(1)}초`}`,
    `공유 ${orDash(metrics.shares)}`,
    `저장 ${orDash(metrics.saved)}`,
  ].join(' · ');

const latestReelSnapshot = (
  snapshots: InsightSnapshot[],
): InsightSnapshot | null => {
  for (const window of [...WINDOW_ORDER].reverse()) {
    const found = snapshots.find(
      (snapshot) => snapshot.snapshotWindow === window,
    );
    if (found) {
      return found;
    }
  }
  return null;
};

const storyLine = ({
  stories,
  byPost,
  now,
}: {
  stories: InstagramPost[];
  byPost: Map<string, InsightSnapshot[]>;
  now: Date;
}): string => {
  const counts = {
    collected: 0,
    notEnough: 0,
    missed: 0,
    noMedia: 0,
    waiting: 0,
  };
  for (const story of stories) {
    const found = (byPost.get(story.id) ?? []).find(
      (snapshot) => snapshot.snapshotWindow === SnapshotWindow.STORY,
    );
    const ageMinutes = story.publishedAt
      ? (now.getTime() - story.publishedAt.getTime()) / 60_000
      : Infinity;
    if (!story.mediaId) {
      counts.noMedia += 1;
    } else if (found?.error === SnapshotError.NOT_ENOUGH_VIEWERS) {
      counts.notEnough += 1;
    } else if (found) {
      counts.collected += 1;
    } else if (ageMinutes < STORY_EXPIRES_MINUTES) {
      counts.waiting += 1;
    } else {
      counts.missed += 1;
    }
  }
  const parts = [
    `수집 ${counts.collected}`,
    `조회 5 미만 ${counts.notEnough}`,
    `놓침 ${counts.missed}`,
    `mediaId 없음 ${counts.noMedia}`,
  ];
  if (counts.waiting > 0) {
    parts.push(`수집 대기 ${counts.waiting}`);
  }
  return `스토리 ${stories.length}건: ${parts.join(' · ')}`;
};

const comparisonLines = (
  posts: InstagramPost[],
  byPost: Map<string, InsightSnapshot[]>,
): string[] => {
  const comparable: ComparableReel[] = [];
  for (const post of posts) {
    const d7 = (byPost.get(post.id) ?? []).find(
      (snapshot) => snapshot.snapshotWindow === SnapshotWindow.D7,
    );
    if (
      post.field !== InstagramPostField.STORY &&
      post.features?.version === REEL_FEATURES_VERSION &&
      d7
    ) {
      comparable.push({ features: post.features, metrics: d7.metrics });
    }
  }
  if (comparable.length === 0) {
    return ['[누적 비교] D7 까지 쌓인 영상이 아직 없습니다.'];
  }
  const axes: [string, (reel: ComparableReel) => string, string[]][] = [
    [
      '첫 줄',
      (reel) => FIRST_LINE_LABELS[reel.features.firstLineType],
      Object.values(FIRST_LINE_LABELS),
    ],
    [
      '제목',
      (reel) => TITLE_LABELS[reel.features.titleForm],
      Object.values(TITLE_LABELS),
    ],
    ['첫 포즈', (reel) => reel.features.firstLine.gesture, []],
    ['길이', (reel) => lengthBucket(reel.features.durationSec), LENGTH_BUCKETS],
  ];
  return [
    `[누적 비교 · D7 기준 · ${comparable.length}편]`,
    ...axes.map(
      ([name, keyOf, order]) =>
        `${name}  ${describeGroups(groupBy(comparable, keyOf, order))}`,
    ),
  ];
};

// order 에 있는 이름은 그 순서로, 없는 이름(포즈)은 편수 많은 순으로 뒤에 붙인다.
const groupBy = (
  reels: ComparableReel[],
  keyOf: (reel: ComparableReel) => string,
  order: string[],
): Group[] => {
  const groups = new Map<string, Group>();
  for (const reel of reels) {
    const label = keyOf(reel);
    const group = groups.get(label) ?? {
      label,
      size: 0,
      skipRates: [],
      shareRatios: [],
    };
    group.size += 1;
    group.skipRates.push(
      ...(reel.metrics.skipRate === null ? [] : [reel.metrics.skipRate]),
    );
    const { shares, reach } = reel.metrics;
    group.shareRatios.push(
      ...(shares === null || !reach ? [] : [(shares / reach) * 100]),
    );
    groups.set(label, group);
  }
  const ranked = [...groups.values()].sort((left, right) => {
    const leftIndex = order.indexOf(left.label);
    const rightIndex = order.indexOf(right.label);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Infinity : leftIndex) -
        (rightIndex === -1 ? Infinity : rightIndex)
      );
    }
    return right.size - left.size;
  });
  return ranked;
};

const describeGroups = (groups: Group[]): string =>
  groups
    .map((group) => {
      if (group.size < MIN_GROUP_SIZE) {
        return `${group.label} n=${group.size} (표본 부족)`;
      }
      const skip = median(group.skipRates);
      const share = median(group.shareRatios);
      return `${group.label} n=${group.size} 스킵 ${skip === null ? '-' : `${Math.round(skip)}%`} · 공유/도달 ${share === null ? '-' : `${share.toFixed(1)}%`}`;
    })
    .join(' | ');

const lengthBucket = (seconds: number): string => {
  if (seconds < 45) {
    return LENGTH_BUCKETS[0];
  }
  return seconds <= 55 ? LENGTH_BUCKETS[1] : LENGTH_BUCKETS[2];
};

const shortDate = (day: string): string =>
  `${day.slice(5, 7)}/${day.slice(8, 10)}`;

const orDash = (value: number | null): string =>
  value === null ? '-' : String(value);

const signed = (value: number): string =>
  value >= 0 ? `+${value}` : String(value);
