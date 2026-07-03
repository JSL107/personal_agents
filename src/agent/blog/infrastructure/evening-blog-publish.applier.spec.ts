import { ConfigService } from '@nestjs/config';

import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { EveningBlogPublishApplier } from './evening-blog-publish.applier';

describe('EveningBlogPublishApplier', () => {
  let applier: EveningBlogPublishApplier;
  let modelRouter: jest.Mocked<ModelRouterUsecase>;
  let notionClient: jest.Mocked<NotionClientPort>;
  let config: jest.Mocked<ConfigService>;

  const makePreview = (payload: unknown): PreviewAction =>
    ({
      kind: PREVIEW_KIND.EVENING_BLOG_PUBLISH,
      payload,
    }) as unknown as PreviewAction;

  beforeEach(() => {
    modelRouter = {
      route: jest.fn().mockResolvedValue({
        text: '# 제목\n본문',
        modelUsed: 'gpt',
        provider: 'CHATGPT',
      }),
    } as unknown as jest.Mocked<ModelRouterUsecase>;

    notionClient = {
      findOrCreateChildPage: jest
        .fn()
        .mockResolvedValue({ pageId: 'p1', url: 'u' }),
      appendBlocks: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotionClientPort>;

    config = {
      get: jest.fn().mockReturnValue('PARENT'),
    } as unknown as jest.Mocked<ConfigService>;

    applier = new EveningBlogPublishApplier(modelRouter, notionClient, config);
  });

  it('(a) NOTION_PAGE_ID 미설정 시 apply 가 throw 한다', async () => {
    config.get.mockReturnValue(undefined);
    const preview = makePreview({
      topPick: { title: '테스트', keywords: ['k1'] },
      retroContext: '회고',
      slackUserId: 'U1',
    });

    await expect(applier.apply(preview)).rejects.toThrow(
      'EVENING_RETRO_BLOG_NOTION_PAGE_ID 가 설정되지 않았습니다',
    );
  });

  it('(b) 정상 흐름 — route → findOrCreateChildPage → appendBlocks 순 호출 후 ApplyResult.message 반환', async () => {
    const preview = makePreview({
      topPick: { title: '제목', keywords: ['k1', 'k2'] },
      retroContext: '오늘의 회고',
      slackUserId: 'U1',
    });

    const result = await applier.apply(preview);

    expect(modelRouter.route).toHaveBeenCalledWith(
      expect.objectContaining({ agentType: AgentType.EVENING_RETRO }),
    );
    expect(notionClient.findOrCreateChildPage).toHaveBeenCalledWith({
      parentPageId: 'PARENT',
      title: '제목',
    });
    expect(notionClient.appendBlocks).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'p1' }),
    );
    expect(result.message).toContain('u');
    expect(result.artifacts).toEqual([]);
  });

  it('(c) payload.topPick 없음 → apply 가 throw 한다', async () => {
    const preview = makePreview({ retroContext: '회고', slackUserId: 'U1' });

    await expect(applier.apply(preview)).rejects.toThrow(
      'EVENING_BLOG_PUBLISH: payload.topPick 누락',
    );
  });
});
