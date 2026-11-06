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
    [1440, [], [SnapshotWindow.H24]],
    [7200, [], [SnapshotWindow.H24, SnapshotWindow.D3]],
    [10080, [], [SnapshotWindow.H24, SnapshotWindow.D3, SnapshotWindow.D7]],
    [10080, [SnapshotWindow.H24], [SnapshotWindow.D3, SnapshotWindow.D7]],
    [12961, [], []],
  ])('릴스 나이 %i분, 기존 %j → %j', (ageMinutes, existing, expected) => {
    expect(dueWindows({ post: post(), ageMinutes, existing })).toEqual(
      expected,
    );
  });

  it('구형 ai·dev 행도 릴스로 본다', () => {
    expect(
      dueWindows({
        post: post({ field: InstagramPostField.AI }),
        ageMinutes: 1500,
        existing: [],
      }),
    ).toEqual([SnapshotWindow.H24]);
  });

  it.each([
    [1199, [], []],
    [1200, [], [SnapshotWindow.STORY]],
    [1439, [], [SnapshotWindow.STORY]],
    [1440, [], []],
    [1300, [SnapshotWindow.STORY], []],
  ])('스토리 나이 %i분, 기존 %j → %j', (ageMinutes, existing, expected) => {
    expect(
      dueWindows({
        post: post({ field: InstagramPostField.STORY }),
        ageMinutes,
        existing,
      }),
    ).toEqual(expected);
  });

  it('mediaId 가 없으면 아무 창도 찍지 않는다', () => {
    expect(
      dueWindows({
        post: post({ mediaId: null }),
        ageMinutes: 10080,
        existing: [],
      }),
    ).toEqual([]);
  });
});
