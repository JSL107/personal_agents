import { ConfigService } from '@nestjs/config';

import { GithubClientPort } from '../../../github/domain/port/github-client.port';
import { NotionClientPort } from '../../../notion/domain/port/notion-client.port';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { GithubBlogPublishApplier } from './github-blog-publish.applier';

const buildPreview = (): PreviewAction => ({
  id: 'preview-blog-1',
  slackUserId: 'U1',
  kind: PREVIEW_KIND.BLOG_GITHUB_PUBLISH,
  payload: {
    pageId: 'notion-page-1',
    path: 'src/content/posts/2026-08-15-test-post.md',
    content: '---\ntitle: Test\n---\n',
    title: '테스트 글',
    notionUrl: 'https://notion.so/page-1',
    tags: ['NestJS'],
    summary: '요약입니다.',
    slackUserId: 'U1',
  },
  status: PREVIEW_STATUS.PENDING,
  previewText: 'preview',
  responseUrl: null,
  expiresAt: new Date('2026-08-14T18:00:00Z'),
  createdAt: new Date('2026-08-14T17:00:00Z'),
  appliedAt: null,
  cancelledAt: null,
  slackChannelId: null,
  slackMessageTs: null,
});

const buildConfig = (): jest.Mocked<ConfigService> =>
  ({
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        BLOG_PUBLISH_REPO: 'JSL107/JSL107.github.io',
        BLOG_PUBLISH_BRANCH: 'main',
        BLOG_NOTION_PROP_STATUS: '상태',
        BLOG_NOTION_PROP_PUBLISHED_AT: '발행일',
        BLOG_NOTION_PROP_TAGS: '태그',
        BLOG_NOTION_PROP_SUMMARY: '요약',
        BLOG_NOTION_STATUS_PUBLISHED_VALUE: '발행',
      };
      return values[key];
    }),
  }) as unknown as jest.Mocked<ConfigService>;

describe('GithubBlogPublishApplier', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-14T16:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('GitHub commit 후 Notion 발행 속성을 갱신하고 github_file artifact를 반환한다', async () => {
    const githubClient = {
      commitFileToBranch: jest.fn().mockResolvedValue({
        commitSha: 'commit-sha',
        fileUrl:
          'https://github.com/JSL107/JSL107.github.io/blob/main/src/content/posts/2026-08-15-test-post.md',
      }),
    } as unknown as jest.Mocked<GithubClientPort>;
    const notionClient = {
      updatePageProperties: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotionClientPort>;
    const applier = new GithubBlogPublishApplier(
      githubClient,
      notionClient,
      buildConfig(),
    );

    const result = await applier.apply(buildPreview());

    expect(githubClient.commitFileToBranch).toHaveBeenCalledWith({
      repo: 'JSL107/JSL107.github.io',
      branch: 'main',
      path: 'src/content/posts/2026-08-15-test-post.md',
      content: '---\ntitle: Test\n---\n',
      commitMessage: 'feat(blog): 테스트 글',
    });
    expect(notionClient.updatePageProperties).toHaveBeenCalledWith({
      pageId: 'notion-page-1',
      properties: {
        상태: { select: { name: '발행' } },
        발행일: { date: { start: '2026-08-15' } },
        태그: { multi_select: [{ name: 'NestJS' }] },
        요약: { rich_text: [{ text: { content: '요약입니다.' } }] },
      },
    });
    expect(
      githubClient.commitFileToBranch.mock.invocationCallOrder[0],
    ).toBeLessThan(
      notionClient.updatePageProperties.mock.invocationCallOrder[0],
    );
    expect(result.artifacts).toEqual([
      {
        type: 'github_file',
        repo: 'JSL107/JSL107.github.io',
        branch: 'main',
        path: 'src/content/posts/2026-08-15-test-post.md',
        commitSha: 'commit-sha',
      },
    ]);
  });

  it('Notion 속성 갱신 실패는 GitHub 발행을 되돌리거나 throw하지 않고 경고로 노출한다', async () => {
    const githubClient = {
      commitFileToBranch: jest.fn().mockResolvedValue({
        commitSha: 'commit-sha',
        fileUrl: 'https://github.com/example/file',
      }),
    } as unknown as jest.Mocked<GithubClientPort>;
    const notionClient = {
      updatePageProperties: jest
        .fn()
        .mockRejectedValue(new Error('property missing')),
    } as unknown as jest.Mocked<NotionClientPort>;
    const applier = new GithubBlogPublishApplier(
      githubClient,
      notionClient,
      buildConfig(),
    );

    const result = await applier.apply(buildPreview());

    expect(result.message).toContain('GitHub에는 발행됐지만');
    expect(result.message).toContain('property missing');
    expect(result.artifacts).toHaveLength(1);
  });

  it('GitHub commit 실패 시 Notion 발행 상태는 갱신하지 않는다', async () => {
    const githubClient = {
      commitFileToBranch: jest
        .fn()
        .mockRejectedValue(new Error('이미 발행된 경로')),
    } as unknown as jest.Mocked<GithubClientPort>;
    const notionClient = {
      updatePageProperties: jest.fn(),
    } as unknown as jest.Mocked<NotionClientPort>;
    const applier = new GithubBlogPublishApplier(
      githubClient,
      notionClient,
      buildConfig(),
    );

    await expect(applier.apply(buildPreview())).rejects.toThrow(
      '이미 발행된 경로',
    );
    expect(notionClient.updatePageProperties).not.toHaveBeenCalled();
  });
});
