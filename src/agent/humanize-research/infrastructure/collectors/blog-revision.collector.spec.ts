import { MeasureBlogRevisionUsecase } from '../../../blog/application/measure-blog-revision.usecase';
import { BlogRevisionCollector } from './blog-revision.collector';

describe('BlogRevisionCollector', () => {
  it('실제 수정된 발행 카드 id를 다음 회차에서 제외한다', async () => {
    const publishedAt = new Date();
    const measurement = {
      isConfigured: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        rows: [
          {
            path: '_posts/post.md',
            publishedAt,
            changes: { removedLines: ['old'], addedLines: ['new'] },
          },
        ],
      }),
    };
    const collector = new BlogRevisionCollector(
      measurement as unknown as MeasureBlogRevisionUsecase,
    );
    const prior = {
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: null,
      arxivIds: [],
    };
    const first = await collector.collect(prior);
    const id = first.items[0].id;
    expect(id).toBe(`blog:_posts/post.md:${publishedAt.toISOString()}`);
    const repeated = await collector.collect({ ...prior, blogPostIds: [id] });
    expect(repeated.items).toEqual([]);
  });
});
