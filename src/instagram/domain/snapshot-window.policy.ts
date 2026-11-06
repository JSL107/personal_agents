import { SnapshotWindow } from './instagram-insight.type';
import { InstagramPost, InstagramPostField } from './instagram-post.type';

// 7일 창 뒤 이틀 여유. 이보다 오래된 행은 더 찍지 않는다(이대리가 오래 꺼져 있던 경우).
export const INSIGHT_LOOKBACK_MINUTES = 12_960;

const REEL_WINDOW_MINUTES: [SnapshotWindow, number][] = [
  [SnapshotWindow.AFTER_24_HOURS, 1440],
  [SnapshotWindow.AFTER_3_DAYS, 4320],
  [SnapshotWindow.AFTER_7_DAYS, 10080],
];
// 스토리 지표는 게시 24시간 뒤 사라진다. 시간당 한 번 도는 수집이 놓치지 않게 20시간부터 찍는다.
const STORY_FROM_MINUTES = 1200;
const STORY_UNTIL_MINUTES = 1440;

// 이번 회차에 찍어야 할 창. 밀린 창은 한꺼번에 돌려준다(값은 지금 값, 늦음은 ageMinutes 로 남는다).
export const dueWindows = ({
  post,
  ageMinutes,
  capturedWindows,
}: {
  post: InstagramPost;
  ageMinutes: number;
  capturedWindows: SnapshotWindow[];
}): SnapshotWindow[] => {
  if (!post.mediaId || ageMinutes > INSIGHT_LOOKBACK_MINUTES) {
    return [];
  }
  if (post.field === InstagramPostField.STORY) {
    return dueStoryWindows({ ageMinutes, capturedWindows });
  }
  const reached = REEL_WINDOW_MINUTES.filter(
    ([window, minutes]) =>
      ageMinutes >= minutes && !capturedWindows.includes(window),
  );
  const windows = reached.map(([window]) => window);
  return windows;
};

const dueStoryWindows = ({
  ageMinutes,
  capturedWindows,
}: {
  ageMinutes: number;
  capturedWindows: SnapshotWindow[];
}): SnapshotWindow[] => {
  if (ageMinutes < STORY_FROM_MINUTES || ageMinutes >= STORY_UNTIL_MINUTES) {
    return [];
  }
  if (capturedWindows.includes(SnapshotWindow.STORY_BEFORE_EXPIRY)) {
    return [];
  }
  return [SnapshotWindow.STORY_BEFORE_EXPIRY];
};
