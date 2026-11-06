import { SnapshotWindow } from './instagram-insight.type';
import { InstagramPost, InstagramPostField } from './instagram-post.type';
import { dueWindows } from './snapshot-window.policy';

const post = (patch: Partial<InstagramPost> = {}): InstagramPost =>
  ({
    id: 'post-1',
    field: InstagramPostField.DAILY,
    mediaId: 'media-1',
    ...patch,
  }) as InstagramPost;

describe('dueWindows', () => {
  it.each([
    [1439, [], []],
    [1440, [], [SnapshotWindow.AFTER_24_HOURS]],
    [7200, [], [SnapshotWindow.AFTER_24_HOURS, SnapshotWindow.AFTER_3_DAYS]],
    [
      10080,
      [],
      [
        SnapshotWindow.AFTER_24_HOURS,
        SnapshotWindow.AFTER_3_DAYS,
        SnapshotWindow.AFTER_7_DAYS,
      ],
    ],
    [
      10080,
      [SnapshotWindow.AFTER_24_HOURS],
      [SnapshotWindow.AFTER_3_DAYS, SnapshotWindow.AFTER_7_DAYS],
    ],
    [12961, [], []],
  ])(
    '릴스 나이 %i분, 찍은 창 %j → %j',
    (ageMinutes, capturedWindows, expected) => {
      expect(dueWindows({ post: post(), ageMinutes, capturedWindows })).toEqual(
        expected,
      );
    },
  );

  it('구형 ai·dev 행도 릴스로 본다', () => {
    expect(
      dueWindows({
        post: post({ field: InstagramPostField.AI }),
        ageMinutes: 1500,
        capturedWindows: [],
      }),
    ).toEqual([SnapshotWindow.AFTER_24_HOURS]);
  });

  it.each([
    [1199, [], []],
    [1200, [], [SnapshotWindow.STORY_BEFORE_EXPIRY]],
    [1439, [], [SnapshotWindow.STORY_BEFORE_EXPIRY]],
    [1440, [], []],
    [1300, [SnapshotWindow.STORY_BEFORE_EXPIRY], []],
  ])(
    '스토리 나이 %i분, 찍은 창 %j → %j',
    (ageMinutes, capturedWindows, expected) => {
      expect(
        dueWindows({
          post: post({ field: InstagramPostField.STORY }),
          ageMinutes,
          capturedWindows,
        }),
      ).toEqual(expected);
    },
  );

  it('mediaId 가 없으면 아무 창도 찍지 않는다', () => {
    expect(
      dueWindows({
        post: post({ mediaId: null }),
        ageMinutes: 10080,
        capturedWindows: [],
      }),
    ).toEqual([]);
  });
});
