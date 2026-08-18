import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getTodayKstDate } from '../../../common/util/kst-date.util';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import { PreviewActionException } from '../../../preview-gate/domain/preview-action.exception';
import {
  PREVIEW_KIND,
  PreviewAction,
  PreviewKind,
} from '../../../preview-gate/domain/preview-action.type';
import { PreviewActionErrorCode } from '../../../preview-gate/domain/preview-action-error-code.enum';
import { isBlogGithubPublishPayload } from '../domain/blog.type';
import {
  BlogPublishPropertyNames,
  buildBlogPublishProperties,
  DEFAULT_BLOG_PROP,
  DEFAULT_BLOG_STATUS_PUBLISHED,
} from '../domain/blog-publish-properties';

@Injectable()
export class GithubBlogPublishApplier implements PreviewApplier {
  readonly kind: PreviewKind = PREVIEW_KIND.BLOG_GITHUB_PUBLISH;
  private readonly logger = new Logger(GithubBlogPublishApplier.name);

  constructor(
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    if (!isBlogGithubPublishPayload(preview.payload)) {
      throw new PreviewActionException({
        code: PreviewActionErrorCode.NO_APPLIER_FOR_KIND,
        message: 'BLOG_GITHUB_PUBLISH payload 형식이 맞지 않습니다.',
      });
    }

    const payload = preview.payload;
    const repo = this.getRequiredConfig('BLOG_PUBLISH_REPO');
    const branch = this.getRequiredConfig('BLOG_PUBLISH_BRANCH');
    const commit = await this.githubClient.commitFileToBranch({
      repo,
      branch,
      path: payload.path,
      content: payload.content,
      commitMessage: `feat(blog): ${payload.title}`,
    });

    const propertyNotice = await this.applyNotionProperties(payload);
    return {
      message: [
        `✅ GitHub 블로그 발행 완료 — ${commit.fileUrl}`,
        `Commit: \`${commit.commitSha}\``,
        `Notion: ${payload.notionUrl}${propertyNotice}`,
      ].join('\n'),
      artifacts: [
        {
          type: 'github_file',
          repo,
          branch,
          path: payload.path,
          commitSha: commit.commitSha,
        },
      ],
    };
  }

  private async applyNotionProperties(payload: {
    pageId: string;
    tags: string[];
    summary: string;
  }): Promise<string> {
    try {
      await this.notionClient.updatePageProperties({
        pageId: payload.pageId,
        properties: buildBlogPublishProperties(
          {
            tags: payload.tags,
            summary: payload.summary || null,
            publishedAt: getTodayKstDate(),
          },
          this.getPropertyNames(),
          this.getOptionalConfig('BLOG_NOTION_STATUS_PUBLISHED_VALUE') ??
            DEFAULT_BLOG_STATUS_PUBLISHED,
        ),
      });
      return '';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`블로그 발행 Notion 속성 갱신 실패: ${message}`);
      return `\n⚠️ GitHub에는 발행됐지만 Notion 상태 업데이트에 실패했습니다. Notion에서 직접 발행 처리해주세요 — ${message}`;
    }
  }

  // 후보 생성 경로(publish-notion-draft.usecase)와 같은 기본값을 쓴다. 여기만 env 를 필수로
  // 요구하면 카드는 뜨는데 승인 후 Notion 갱신만 실패한다 — GitHub 파일은 이미 커밋된 뒤라
  // 페이지가 '초안' 으로 남고, 다음 저녁에 같은 글을 다시 올리려다 경로 충돌(422)까지 난다.
  private getPropertyNames(): BlogPublishPropertyNames {
    return {
      status:
        this.getOptionalConfig('BLOG_NOTION_PROP_STATUS') ??
        DEFAULT_BLOG_PROP.status,
      publishedAt:
        this.getOptionalConfig('BLOG_NOTION_PROP_PUBLISHED_AT') ??
        DEFAULT_BLOG_PROP.publishedAt,
      tags:
        this.getOptionalConfig('BLOG_NOTION_PROP_TAGS') ??
        DEFAULT_BLOG_PROP.tags,
      summary:
        this.getOptionalConfig('BLOG_NOTION_PROP_SUMMARY') ??
        DEFAULT_BLOG_PROP.summary,
    };
  }

  private getOptionalConfig(key: string): string | undefined {
    return this.configService.get<string>(key)?.trim() || undefined;
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key)?.trim();
    if (!value) {
      throw new Error(`${key} 가 설정되지 않았습니다 (.env 확인).`);
    }
    return value;
  }
}
