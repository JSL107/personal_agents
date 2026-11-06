import { match } from 'ts-pattern';

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
import { lateMinutesOf } from '../domain/snapshot-window.policy';

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

interface ComparableReel {
  features: ReelFeatures;
  metrics: InsightMetrics;
}

interface ComparisonAxis {
  name: string;
  keyOf: (reel: ComparableReel) => string;
  order: string[];
}

enum StoryStatus {
  COLLECTED = 'COLLECTED',
  NOT_ENOUGH_VIEWERS = 'NOT_ENOUGH_VIEWERS',
  MISSED = 'MISSED',
  NO_MEDIA = 'NO_MEDIA',
  WAITING = 'WAITING',
}

// 칸마다 이 수보다 적으면 숫자를 내지 않는다. 한두 편으로 묶은 중앙값은 우연에 가깝다.
const MIN_GROUP_SIZE = 3;
const STORY_EXPIRES_MINUTES = 1440;
const MINUTE_MS = 60_000;
const REEL_WINDOW_ORDER = [
  SnapshotWindow.AFTER_24_HOURS,
  SnapshotWindow.AFTER_3_DAYS,
  SnapshotWindow.AFTER_7_DAYS,
];
const WINDOW_LABELS: Record<SnapshotWindow, string> = {
  [SnapshotWindow.AFTER_24_HOURS]: '24시간',
  [SnapshotWindow.AFTER_3_DAYS]: '3일',
  [SnapshotWindow.AFTER_7_DAYS]: '7일',
  [SnapshotWindow.STORY_BEFORE_EXPIRY]: '스토리',
};
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
const COMPARISON_AXES: ComparisonAxis[] = [
  {
    name: '첫 줄',
    keyOf: (reel) => FIRST_LINE_LABELS[reel.features.firstLineType],
    order: Object.values(FIRST_LINE_LABELS),
  },
  {
    name: '제목',
    keyOf: (reel) => TITLE_LABELS[reel.features.titleForm],
    order: Object.values(TITLE_LABELS),
  },
  {
    name: '첫 포즈',
    keyOf: (reel) => reel.features.firstLine.gesture,
    order: [],
  },
  {
    name: '길이',
    keyOf: (reel) => lengthBucket(reel.features.durationSec),
    order: LENGTH_BUCKETS,
  },
];

// 숫자만 보여 준다. "어느 쪽이 낫다" 같은 판단은 사람이 한다(스펙 §4.2).
export const formatWeeklyInsightReport = (
  input: WeeklyReportInput,
): string | null => {
  const inWeek = input.posts.filter((post) => isInWeek({ post, input }));
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
    lines.push(
      ...reelLines({ post: reel, snapshots: byPost.get(reel.id) ?? [] }),
    );
  }
  if (stories.length > 0) {
    lines.push(storyLine({ stories, byPost, now: input.now }));
  }
  lines.push('', ...comparisonLines({ posts: input.posts, byPost }));
  return lines.join('\n');
};

export const median = (values: number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }
  const average = (sorted[middle - 1] + sorted[middle]) / 2;
  return average;
};

const isInWeek = ({
  post,
  input,
}: {
  post: InstagramPost;
  input: WeeklyReportInput;
}): boolean => {
  if (!post.publishedAt) {
    return false;
  }
  const day = getKstDateOf(post.publishedAt);
  if (day < input.weekStartKst) {
    return false;
  }
  return day <= input.weekEndKst;
};

const groupSnapshots = (
  snapshots: InsightSnapshot[],
): Map<string, InsightSnapshot[]> => {
  const byPost = new Map<string, InsightSnapshot[]>();
  for (const snapshot of snapshots) {
    const saved = byPost.get(snapshot.postId) ?? [];
    byPost.set(snapshot.postId, [...saved, snapshot]);
  }
  return byPost;
};

// 팔로워는 그 주 월요일 0시부터 지금까지 찍힌 스냅숏의 처음과 마지막 값이다.
const headerLine = (input: WeeklyReportInput): string => {
  const range = `${shortDate(input.weekStartKst)}~${shortDate(input.weekEndKst)}`;
  const from = kstDayStartOf(input.weekStartKst).getTime();
  const counts: number[] = [];
  const inRange = input.snapshots
    .filter(
      (snapshot) =>
        snapshot.capturedAt.getTime() >= from &&
        snapshot.capturedAt.getTime() <= input.now.getTime(),
    )
    .sort(
      (left, right) => left.capturedAt.getTime() - right.capturedAt.getTime(),
    );
  for (const snapshot of inRange) {
    if (snapshot.followersCount !== null) {
      counts.push(snapshot.followersCount);
    }
  }
  const followers = followersPhrase(counts);
  return `📊 스킬쟁이 주간 리포트 (${range}) · ${followers}`;
};

const followersPhrase = (counts: number[]): string => {
  if (counts.length === 0) {
    return '팔로워 -';
  }
  const first = counts[0];
  const last = counts[counts.length - 1];
  return `팔로워 ${first} → ${last} (${signed(last - first)})`;
};

const reelLines = ({
  post,
  snapshots,
}: {
  post: InstagramPost;
  snapshots: InsightSnapshot[];
}): string[] => {
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
  const missingSevenDay =
    latest.snapshotWindow === SnapshotWindow.AFTER_7_DAYS
      ? ''
      : ' (7일 값 미수집)';
  const metricsLine = `  ${WINDOW_LABELS[latest.snapshotWindow]} ${describeMetrics(latest.metrics)}${latePhrase(latest)}${missingSevenDay}`;
  return [head, metricsLine];
};

const describeFeatures = (features: ReelFeatures): string => {
  const firstLineType = FIRST_LINE_LABELS[features.firstLineType];
  const titleForm = TITLE_LABELS[features.titleForm];
  const parts = [
    `${Math.round(features.durationSec)}초`,
    `${features.segmentFields.length}꼭지`,
    `${firstLineType}/${titleForm}`,
    features.firstLine.gesture,
  ];
  return parts.join(' ');
};

const describeMetrics = (metrics: InsightMetrics): string => {
  const skip =
    metrics.skipRate === null ? '-' : `${Math.round(metrics.skipRate)}%`;
  const averageWatch =
    metrics.avgWatchMs === null
      ? '-'
      : `${(metrics.avgWatchMs / 1000).toFixed(1)}초`;
  const parts = [
    `조회 ${orDash(metrics.views)}`,
    `도달 ${orDash(metrics.reach)}`,
    `스킵 ${skip}`,
    `평균 ${averageWatch}`,
    `공유 ${orDash(metrics.shares)}`,
    `저장 ${orDash(metrics.saved)}`,
  ];
  return parts.join(' · ');
};

const latestReelSnapshot = (
  snapshots: InsightSnapshot[],
): InsightSnapshot | null => {
  for (const window of [...REEL_WINDOW_ORDER].reverse()) {
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
  const counts: Record<StoryStatus, number> = {
    [StoryStatus.COLLECTED]: 0,
    [StoryStatus.NOT_ENOUGH_VIEWERS]: 0,
    [StoryStatus.MISSED]: 0,
    [StoryStatus.NO_MEDIA]: 0,
    [StoryStatus.WAITING]: 0,
  };
  for (const story of stories) {
    const snapshot = (byPost.get(story.id) ?? []).find(
      (saved) => saved.snapshotWindow === SnapshotWindow.STORY_BEFORE_EXPIRY,
    );
    const status = storyStatusOf({ story, snapshot, now });
    counts[status] += 1;
  }
  const parts = [
    `수집 ${counts[StoryStatus.COLLECTED]}`,
    `조회 5 미만 ${counts[StoryStatus.NOT_ENOUGH_VIEWERS]}`,
    `놓침 ${counts[StoryStatus.MISSED]}`,
    `mediaId 없음 ${counts[StoryStatus.NO_MEDIA]}`,
  ];
  if (counts[StoryStatus.WAITING] > 0) {
    parts.push(`수집 대기 ${counts[StoryStatus.WAITING]}`);
  }
  return `스토리 ${stories.length}건: ${parts.join(' · ')}`;
};

// mediaId·스냅숏·오류·만료 여부의 조합으로 스토리 하나의 상태를 고른다(위에서부터 먼저 맞는 것).
const storyStatusOf = ({
  story,
  snapshot,
  now,
}: {
  story: InstagramPost;
  snapshot: InsightSnapshot | undefined;
  now: Date;
}): StoryStatus => {
  const ageMinutes = story.publishedAt
    ? (now.getTime() - story.publishedAt.getTime()) / MINUTE_MS
    : Infinity;
  const status = match({
    hasMedia: Boolean(story.mediaId),
    hasSnapshot: Boolean(snapshot),
    snapshotError: snapshot?.error ?? null,
    expired: ageMinutes >= STORY_EXPIRES_MINUTES,
  })
    .with({ hasMedia: false }, () => StoryStatus.NO_MEDIA)
    .with(
      { snapshotError: SnapshotError.NOT_ENOUGH_VIEWERS },
      () => StoryStatus.NOT_ENOUGH_VIEWERS,
    )
    .with({ hasSnapshot: true }, () => StoryStatus.COLLECTED)
    .with({ expired: false }, () => StoryStatus.WAITING)
    .otherwise(() => StoryStatus.MISSED);
  return status;
};

const comparisonLines = ({
  posts,
  byPost,
}: {
  posts: InstagramPost[];
  byPost: Map<string, InsightSnapshot[]>;
}): string[] => {
  const comparable: ComparableReel[] = [];
  let lateCount = 0;
  for (const post of posts) {
    const sevenDaySnapshot = (byPost.get(post.id) ?? []).find(
      (snapshot) => snapshot.snapshotWindow === SnapshotWindow.AFTER_7_DAYS,
    );
    if (
      post.field !== InstagramPostField.STORY &&
      post.features?.version === REEL_FEATURES_VERSION &&
      sevenDaySnapshot
    ) {
      comparable.push({
        features: post.features,
        metrics: sevenDaySnapshot.metrics,
      });
      if (lateMinutesOf(sevenDaySnapshot) !== null) {
        lateCount += 1;
      }
    }
  }
  if (comparable.length === 0) {
    return ['[누적 비교] 7일 값까지 쌓인 영상이 아직 없습니다.'];
  }
  const axisLines = COMPARISON_AXES.map(({ name, keyOf, order }) => {
    const groups = groupBy({ reels: comparable, keyOf, order });
    return `${name}  ${describeGroups(groups)}`;
  });
  const late = lateCount > 0 ? ` · 늦게 수집 ${lateCount}편` : '';
  const header = `[누적 비교 · 7일 값 기준 · ${comparable.length}편${late}]`;
  return [header, ...axisLines];
};

// order 에 있는 이름은 그 순서로, 없는 이름(포즈)은 편수 많은 순으로 뒤에 붙인다.
const groupBy = ({
  reels,
  keyOf,
  order,
}: {
  reels: ComparableReel[];
  keyOf: (reel: ComparableReel) => string;
  order: string[];
}): Group[] => {
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
    const { skipRate, shares, reach } = reel.metrics;
    if (skipRate !== null) {
      group.skipRates.push(skipRate);
    }
    if (shares !== null && reach) {
      group.shareRatios.push((shares / reach) * 100);
    }
    groups.set(label, group);
  }
  const ranked = [...groups.values()].sort((left, right) => {
    const leftRank = rankIn({ order, label: left.label });
    const rightRank = rankIn({ order, label: right.label });
    if (leftRank === rightRank) {
      return right.size - left.size;
    }
    return leftRank - rightRank;
  });
  return ranked;
};

// order 에 없는 이름은 맨 뒤(Infinity). 둘 다 없으면 같은 순위라 편수로 가른다.
const rankIn = ({
  order,
  label,
}: {
  order: string[];
  label: string;
}): number => {
  const index = order.indexOf(label);
  if (index === -1) {
    return Infinity;
  }
  return index;
};

const describeGroups = (groups: Group[]): string => {
  const cells = groups.map((group) => {
    if (group.size < MIN_GROUP_SIZE) {
      return `${group.label} n=${group.size} (표본 부족)`;
    }
    const skip = describeMedian({
      values: group.skipRates,
      format: (value) => `${Math.round(value)}%`,
    });
    const share = describeMedian({
      values: group.shareRatios,
      format: (value) => `${value.toFixed(1)}%`,
    });
    return `${group.label} n=${group.size} 스킵 ${skip} · 공유/도달 ${share}`;
  });
  return cells.join(' | ');
};

// 편수가 충분해도 Meta 가 지표를 비워 준 영상은 중앙값에서 빠진다. 실제로 계산에 든 값 수로 다시 본다.
const describeMedian = ({
  values,
  format,
}: {
  values: number[];
  format: (value: number) => string;
}): string => {
  const value = median(values);
  if (value === null || values.length < MIN_GROUP_SIZE) {
    return '(표본 부족)';
  }
  return format(value);
};

const lengthBucket = (seconds: number): string => {
  if (seconds < 45) {
    return LENGTH_BUCKETS[0];
  }
  if (seconds <= 55) {
    return LENGTH_BUCKETS[1];
  }
  return LENGTH_BUCKETS[2];
};

const shortDate = (day: string): string =>
  `${day.slice(5, 7)}/${day.slice(8, 10)}`;

const latePhrase = (snapshot: InsightSnapshot): string => {
  const lateMinutes = lateMinutesOf(snapshot);
  if (lateMinutes === null) {
    return '';
  }
  return ` (${Math.round(lateMinutes / 60)}시간 늦게 수집)`;
};

const orDash = (value: number | null): string =>
  value === null ? '-' : String(value);

const signed = (value: number): string =>
  value >= 0 ? `+${value}` : String(value);
