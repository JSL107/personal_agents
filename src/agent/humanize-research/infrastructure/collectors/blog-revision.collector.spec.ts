import { MeasureBlogRevisionUsecase } from '../../../blog/application/measure-blog-revision.usecase';
import { BlogRevisionCollector } from './blog-revision.collector';

describe('BlogRevisionCollector', () => {
  it('해시 없는 옛 id 가 처리 목록에 있으면 다시 수집하지 않는다', async () => {
    const publishedAt = new Date();
    const path = '_posts/post.md';
    const measurement = {
      isConfigured: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        rows: [
          {
            path,
            publishedAt,
            changes: { removedLines: ['old'], addedLines: ['new'] },
          },
        ],
      }),
    };
    const collector = new BlogRevisionCollector(
      measurement as unknown as MeasureBlogRevisionUsecase,
    );

    const result = await collector.collect({
      humanizerMaxRunId: null,
      blogPostIds: [`blog:${path}:${publishedAt.toISOString()}`],
      upstreamHead: null,
      arxivIds: [],
      canonHead: null,
    });

    expect(result.items).toEqual([]);
  });

  it('measure 를 lookbackDays 56 으로 부른다', async () => {
    const measurement = {
      isConfigured: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const collector = new BlogRevisionCollector(
      measurement as unknown as MeasureBlogRevisionUsecase,
    );

    await collector.collect({
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: null,
      arxivIds: [],
      canonHead: null,
    });

    expect(measurement.execute).toHaveBeenCalledWith({ lookbackDays: 56 });
  });

  it('변경 해시가 id 에 붙고 같은 발행본을 더 고치면 새 항목으로 수집한다', async () => {
    const publishedAt = new Date();
    const changes = {
      removedLines: ['처리하고, 저장한다'],
      addedLines: ['처리하고 저장한다'],
    };
    const measurement = {
      isConfigured: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        rows: [{ path: '_posts/post.md', publishedAt, changes }],
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
      canonHead: null,
    };

    const first = await collector.collect(prior);
    const firstId = first.items[0].id;
    changes.addedLines = ['처리하고 재빨리 저장한다'];
    const second = await collector.collect({
      ...prior,
      blogPostIds: [firstId],
    });

    expect(firstId).toMatch(/^blog:_posts\/post\.md:.*:[a-f0-9]{8}$/u);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].id).not.toBe(firstId);
  });

  it('텍스트에는 편집 요약을 넣고 원시 삭제 줄 목록을 넣지 않는다', async () => {
    const measurement = {
      isConfigured: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue({
        rows: [
          {
            path: '_posts/post.md',
            publishedAt: new Date(),
            changes: {
              removedLines: ['처리하고, 저장한다'],
              addedLines: ['처리하고 저장한다'],
            },
          },
        ],
      }),
    };
    const collector = new BlogRevisionCollector(
      measurement as unknown as MeasureBlogRevisionUsecase,
    );

    const result = await collector.collect({
      humanizerMaxRunId: null,
      blogPostIds: [],
      upstreamHead: null,
      arxivIds: [],
      canonHead: null,
    });

    expect(result.items[0].text).toContain('PUNCTUATION_ONLY: 1건');
    expect(result.items[0].text).not.toContain('삭제된 줄:');
  });

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
      canonHead: null,
    };
    const first = await collector.collect(prior);
    const id = first.items[0].id;
    expect(id).toMatch(/^blog:_posts\/post\.md:.*:[a-f0-9]{8}$/u);
    const repeated = await collector.collect({ ...prior, blogPostIds: [id] });
    expect(repeated.items).toEqual([]);
  });
});
