import { NotionPlanBlock } from '../../notion/domain/port/notion-client.port';
import { HumanizeService } from './humanize.service';
import { humanizeEveningBlogBlocks } from './humanize-evening-blog.adapter';

const makeHumanizer = (
  humanize: jest.Mock<
    Promise<Record<string, string>>,
    [Record<string, string>]
  >,
): HumanizeService =>
  ({
    humanize,
  }) as unknown as HumanizeService;

describe('humanizeEveningBlogBlocks', () => {
  it('paragraph 블록 text 만 fields 로 전달하고 heading/subheading 은 제외한다', async () => {
    const humanize = jest.fn(async (fields: Record<string, string>) => fields);
    const blocks: NotionPlanBlock[] = [
      { type: 'heading', text: '제목' },
      { type: 'paragraph', text: '첫 문단' },
      { type: 'subheading', text: '소제목' },
      { type: 'paragraph', text: '둘째 문단', link: 'https://example.com' },
    ];

    await humanizeEveningBlogBlocks(blocks, makeHumanizer(humanize));

    expect(humanize).toHaveBeenCalledWith({
      '1': '첫 문단',
      '3': '둘째 문단',
    });
  });

  it('humanize 반환값으로 paragraph text 만 교체하고 순서와 non-paragraph 및 link 를 보존한다', async () => {
    const humanize = jest.fn<
      Promise<Record<string, string>>,
      [Record<string, string>]
    >(async () => ({
      '1': '다듬은 첫 문단',
      '3': '다듬은 둘째 문단',
    }));
    const blocks: NotionPlanBlock[] = [
      { type: 'heading', text: '제목' },
      { type: 'paragraph', text: '첫 문단' },
      { type: 'subheading', text: '소제목' },
      { type: 'paragraph', text: '둘째 문단', link: 'https://example.com' },
    ];

    const result = await humanizeEveningBlogBlocks(
      blocks,
      makeHumanizer(humanize),
    );

    expect(result).toEqual([
      { type: 'heading', text: '제목' },
      { type: 'paragraph', text: '다듬은 첫 문단' },
      { type: 'subheading', text: '소제목' },
      {
        type: 'paragraph',
        text: '다듬은 둘째 문단',
        link: 'https://example.com',
      },
    ]);
  });

  it('paragraph 가 없으면 humanize 를 호출하지 않고 원본 blocks 를 그대로 반환한다', async () => {
    const humanize = jest.fn(async (fields: Record<string, string>) => fields);
    const blocks: NotionPlanBlock[] = [
      { type: 'heading', text: '제목' },
      { type: 'subheading', text: '소제목' },
      { type: 'divider' },
    ];

    const result = await humanizeEveningBlogBlocks(
      blocks,
      makeHumanizer(humanize),
    );

    expect(humanize).not.toHaveBeenCalled();
    expect(result).toBe(blocks);
  });

  it('humanizer 가 입력과 동일한 값을 반환하면 blocks 값은 원본과 동일하다', async () => {
    const humanize = jest.fn(async (fields: Record<string, string>) => fields);
    const blocks: NotionPlanBlock[] = [
      { type: 'heading', text: '제목' },
      { type: 'paragraph', text: '첫 문단' },
      { type: 'paragraph', text: '둘째 문단', link: 'https://example.com' },
    ];

    const result = await humanizeEveningBlogBlocks(
      blocks,
      makeHumanizer(humanize),
    );

    expect(result).toEqual(blocks);
  });
});
