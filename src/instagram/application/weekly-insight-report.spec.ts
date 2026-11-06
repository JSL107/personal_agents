import {
  FirstLineType,
  InsightMetrics,
  InsightSnapshot,
  ReelFeatures,
  SnapshotError,
  SnapshotWindow,
  TitleForm,
} from '../domain/instagram-insight.type';
import {
  InstagramPost,
  InstagramPostField,
} from '../domain/instagram-post.type';
import { formatWeeklyInsightReport, median } from './weekly-insight-report';

const NOW = new Date('2026-11-16T00:30:00Z');

const features = (patch: Partial<ReelFeatures> = {}): ReelFeatures => ({
  version: 1,
  durationSec: 52,
  segmentFields: ['ai', 'dev'],
  headlines: ['이제 비교할 수 있어요', '버그를 먼저 찾아 줘요'],
  titleForm: TitleForm.RESULT,
  firstLine: { subtitle: '?', speech: '', gesture: 'wave', react: 'none' },
  firstLineType: FirstLineType.QUESTION,
  lineCount: 12,
  speechChars: 300,
  pointCards: 3,
  reacts: [],
  gestureCounts: { wave: 1 },
  engine: null,
  ...patch,
});

let sequence = 0;
const post = (patch: Partial<InstagramPost> = {}): InstagramPost =>
  ({
    id: `post-${++sequence}`,
    reelKey: '2026-11-09/daily',
    field: InstagramPostField.DAILY,
    title: '이제 비교할 수 있어요 · 버그를 먼저 찾아 줘요',
    mediaId: 'media',
    publishedAt: new Date('2026-11-09T01:00:00Z'),
    features: features(),
    ...patch,
  }) as InstagramPost;

const metrics = (patch: Partial<InsightMetrics> = {}): InsightMetrics => ({
  views: 210,
  reach: 180,
  likes: 3,
  comments: 0,
  shares: 1,
  saved: 0,
  totalInteractions: 4,
  reposts: 0,
  replies: null,
  avgWatchMs: 4432,
  totalWatchMs: null,
  skipRate: 72.4,
  ...patch,
});

const snapshot = (
  target: InstagramPost,
  patch: Partial<InsightSnapshot> = {},
): InsightSnapshot => ({
  id: `snap-${++sequence}`,
  postId: target.id,
  snapshotWindow: SnapshotWindow.D7,
  capturedAt: new Date('2026-11-16T00:20:00Z'),
  ageMinutes: 10100,
  metrics: metrics(),
  followersCount: 5,
  error: null,
  raw: [],
  ...patch,
});

const week = { weekStartKst: '2026-11-09', weekEndKst: '2026-11-15', now: NOW };

describe('formatWeeklyInsightReport', () => {
  it('지난주 게시가 없으면 null', () => {
    const old = post({ publishedAt: new Date('2026-11-01T01:00:00Z') });
    expect(
      formatWeeklyInsightReport({ ...week, posts: [old], snapshots: [] }),
    ).toBeNull();
  });

  it('머리줄에 기간과 그 주 팔로워 증감을 적는다', () => {
    const reel = post();
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [reel],
      snapshots: [
        snapshot(reel, {
          snapshotWindow: SnapshotWindow.H24,
          capturedAt: new Date('2026-11-10T01:20:00Z'),
          followersCount: 2,
        }),
        snapshot(reel),
      ],
    });
    expect(text?.split('\n')[0]).toBe(
      '📊 스킬쟁이 주간 리포트 (11/09~11/15) · 팔로워 2 → 5 (+3)',
    );
  });

  it('영상 줄은 가장 늦은 창 값을 쓰고 없는 지표는 - 로 적는다', () => {
    const reel = post();
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [reel],
      snapshots: [snapshot(reel, { metrics: metrics({ shares: null }) })],
    });
    expect(text).toContain(
      '11/09 「이제 비교할 수 있어요 · 버그를 먼저 찾아 줘요」 52초 2꼭지 질문형/결과형 wave',
    );
    expect(text).toContain(
      '  D7 조회 210 · 도달 180 · 스킵 72% · 평균 4.4초 · 공유 - · 저장 0',
    );
  });

  it('D7 이 아직 없으면 그 창을 쓰고 미수집이라고 적는다', () => {
    const reel = post({ publishedAt: new Date('2026-11-15T01:00:00Z') });
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [reel],
      snapshots: [snapshot(reel, { snapshotWindow: SnapshotWindow.H24 })],
    });
    expect(text).toContain('  H24 조회 210');
    expect(text).toContain('(D7 미수집)');
  });

  it('스토리 상태를 한 줄로 센다', () => {
    const stories = [
      post({ field: InstagramPostField.STORY, reelKey: '2026-11-09/story' }),
      post({ field: InstagramPostField.STORY, reelKey: '2026-11-10/story' }),
      post({ field: InstagramPostField.STORY, mediaId: null }),
      post({ field: InstagramPostField.STORY }),
      post({
        field: InstagramPostField.STORY,
        publishedAt: new Date('2026-11-15T10:00:00Z'),
      }),
    ];
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [post(), ...stories],
      snapshots: [
        snapshot(stories[0], { snapshotWindow: SnapshotWindow.STORY }),
        snapshot(stories[1], {
          snapshotWindow: SnapshotWindow.STORY,
          error: SnapshotError.NOT_ENOUGH_VIEWERS,
        }),
      ],
    });
    expect(text).toContain(
      '스토리 5건: 수집 1 · 조회 5 미만 1 · 놓침 1 · mediaId 없음 1 · 수집 대기 1',
    );
  });

  it('누적 비교는 D7 이 있는 version 1 릴스만 묶고 3편 미만은 표본 부족', () => {
    const question = [post(), post(), post()];
    const number = post({
      features: features({ firstLineType: FirstLineType.NUMBER }),
    });
    const noD7 = post();
    const oldVersion = post({ features: null });
    const skips = [60, 70, 90];
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [...question, number, noD7, oldVersion],
      snapshots: [
        ...question.map((target, index) =>
          snapshot(target, {
            metrics: metrics({
              skipRate: skips[index],
              shares: index,
              reach: 100,
            }),
          }),
        ),
        snapshot(number),
        snapshot(noD7, { snapshotWindow: SnapshotWindow.H24 }),
        snapshot(oldVersion),
      ],
    });
    expect(text).toContain('[누적 비교 · D7 기준 · 4편]');
    expect(text).toContain(
      '첫 줄  질문형 n=3 스킵 70% · 공유/도달 1.0% | 숫자형 n=1 (표본 부족)',
    );
    expect(text).toContain('길이  45~55초 n=4 스킵 71%');
    expect(text).toContain('첫 포즈  wave n=4');
  });

  it('편수가 3이어도 지표 유효값이 3개 미만이면 그 지표만 표본 부족', () => {
    const reels = [post(), post(), post()];
    const text = formatWeeklyInsightReport({
      ...week,
      posts: reels,
      snapshots: reels.map((target, index) =>
        snapshot(target, {
          metrics: metrics({ skipRate: index === 0 ? 70 : null }),
        }),
      ),
    });
    expect(text).toContain(
      '첫 줄  질문형 n=3 스킵 (표본 부족) · 공유/도달 0.6%',
    );
  });

  it('판단 문장을 쓰지 않는다', () => {
    const reels = [post(), post(), post()];
    const text = formatWeeklyInsightReport({
      ...week,
      posts: reels,
      snapshots: reels.map((target) => snapshot(target)),
    });
    expect(text).not.toMatch(/낫|좋|추천|권장/);
  });

  it('제목의 Slack 제어 문자를 이스케이프한다', () => {
    const reel = post({ title: '<b>&' });
    const text = formatWeeklyInsightReport({
      ...week,
      posts: [reel],
      snapshots: [],
    });
    expect(text).toContain('「&lt;b&gt;&amp;」');
    expect(text).toContain('  아직 수집 전');
  });
});

describe('median', () => {
  it.each([
    [[1, 100, 3], 3],
    [[1, 2, 3, 4], 2.5],
    [[], null],
  ])('%j → %p', (values, expected) => {
    expect(median(values)).toBe(expected);
  });
});
