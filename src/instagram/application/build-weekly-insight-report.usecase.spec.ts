import {
  InstagramPost,
  InstagramPostField,
} from '../domain/instagram-post.type';
import { InstagramInsightSnapshotRepositoryPort } from '../domain/port/instagram-insight-snapshot.repository.port';
import { InstagramPostRepositoryPort } from '../domain/port/instagram-post.repository.port';
import { BuildWeeklyInsightReportUsecase } from './build-weekly-insight-report.usecase';

// 포맷터는 mock 하지 않는다. jest 설정(internal-terms.jest-setup)이 autopilot task 를 먼저 불러와
// 이 usecase 가 실제 포맷터와 함께 캐시되므로 jest.mock 이 먹지 않는다. 머리줄의 기간으로 주 범위를 본다.
describe('BuildWeeklyInsightReportUsecase', () => {
  const reel = (publishedAt: string): InstagramPost =>
    ({
      id: `post-${publishedAt}`,
      field: InstagramPostField.DAILY,
      title: '제목',
      mediaId: 'media',
      publishedAt: new Date(publishedAt),
      features: null,
    }) as InstagramPost;
  let posts: jest.Mocked<
    Pick<InstagramPostRepositoryPort, 'listPublishedSince'>
  >;
  let snapshots: jest.Mocked<InstagramInsightSnapshotRepositoryPort>;
  let usecase: BuildWeeklyInsightReportUsecase;

  beforeEach(() => {
    posts = { listPublishedSince: jest.fn() };
    snapshots = {
      insertIfAbsent: jest.fn(),
      listByPostIds: jest.fn().mockResolvedValue([]),
    };
    usecase = new BuildWeeklyInsightReportUsecase(
      posts as unknown as InstagramPostRepositoryPort,
      snapshots,
    );
  });

  it.each([
    ['2026-11-16T00:30:00Z', '2026-11-10T01:00:00Z', '(11/09~11/15)'], // 월 09:30 KST
    ['2026-11-15T14:59:00Z', '2026-11-03T01:00:00Z', '(11/02~11/08)'], // 일 23:59 KST, 그 주는 아직 안 끝남
    ['2026-11-18T03:00:00Z', '2026-11-10T01:00:00Z', '(11/09~11/15)'], // 수요일 수동 실행
  ])('now=%s 이면 지난주를 본다', async (now, publishedAt, range) => {
    const published = [reel(publishedAt)];
    posts.listPublishedSince.mockResolvedValue(published);
    usecase.now = () => new Date(now);

    const report = await usecase.execute();

    expect(report?.split('\n')[0]).toContain(range);
    expect(posts.listPublishedSince).toHaveBeenCalledWith(new Date(0));
    expect(snapshots.listByPostIds).toHaveBeenCalledWith([published[0].id]);
  });

  it('지난주 게시가 없으면 null', async () => {
    posts.listPublishedSince.mockResolvedValue([reel('2026-11-01T01:00:00Z')]);
    usecase.now = () => new Date('2026-11-16T00:30:00Z');
    await expect(usecase.execute()).resolves.toBeNull();
  });
});
