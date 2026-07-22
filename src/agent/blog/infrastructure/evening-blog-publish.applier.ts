import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { HumanizeService } from '../../../humanize/application/humanize.service';
import { humanizeEveningBlogBlocks } from '../../../humanize/application/humanize-evening-blog.adapter';
import { ModelRouterUsecase } from '../../../model-router/application/model-router.usecase';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../../notion/domain/port/notion-client.port';
import { ApplyResult } from '../../../preview-gate/domain/apply-result.type';
import { PreviewApplier } from '../../../preview-gate/domain/port/preview-applier.port';
import {
  PREVIEW_KIND,
  PreviewAction,
} from '../../../preview-gate/domain/preview-action.type';
import { buildEveningBlogProperties } from '../domain/evening-blog-publish-properties';
import {
  buildEveningBlogBodyPrompt,
  EVENING_BLOG_BODY_SYSTEM_PROMPT,
  EveningBlogSourcePr,
} from '../domain/prompt/evening-retro.prompt';

interface EveningBlogPayload {
  topPick: {
    title: string;
    keywords: string[];
    reason?: string;
    sourceRefs?: string[];
    outline?: string[];
  };
  sourcePrs?: EveningBlogSourcePr[];
  retroContext: string;
  slackUserId: string;
}

@Injectable()
export class EveningBlogPublishApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_BLOG_PUBLISH;
  private readonly logger = new Logger(EveningBlogPublishApplier.name);

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly config: ConfigService,
    private readonly humanizer: HumanizeService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningBlogPayload;
    if (!payload?.topPick?.title) {
      throw new Error('EVENING_BLOG_PUBLISH: payload.topPick 누락');
    }
    const databaseId = this.config
      .get<string>('EVENING_RETRO_BLOG_NOTION_DATABASE_ID')
      ?.trim();
    if (!databaseId) {
      throw new Error(
        'EVENING_RETRO_BLOG_NOTION_DATABASE_ID 가 설정되지 않았습니다 (.env 확인).',
      );
    }

    const completion = await this.modelRouter.route({
      agentType: AgentType.EVENING_RETRO,
      request: {
        prompt: buildEveningBlogBodyPrompt({
          title: payload.topPick.title,
          keywords: payload.topPick.keywords,
          reason: payload.topPick.reason ?? '',
          retroContext: payload.retroContext,
          sourcePrs: payload.sourcePrs ?? [],
          outline: payload.topPick.outline ?? [],
        }),
        systemPrompt: EVENING_BLOG_BODY_SYSTEM_PROMPT,
      },
    });

    const row = await this.notionClient.findOrCreateDailyPage({
      databaseId,
      title: payload.topPick.title,
    });
    const blocks = this.toBlocks(completion.text);
    const humanizedBlocks = await humanizeEveningBlogBlocks(
      blocks,
      this.humanizer,
    );
    await this.notionClient.appendBlocks({
      pageId: row.pageId,
      blocks: humanizedBlocks,
    });
    const propertyNotice = await this.applyRowProperties(
      row.pageId,
      payload.topPick.keywords ?? [],
    );

    return {
      message: `블로그 초안을 Notion 에 발행했습니다 — ${row.url}${propertyNotice}`,
      artifacts: [],
    };
  }

  // 본문 적재 후 DB 행 속성(태그/출처유형/카테고리/상태)을 채운다.
  // 본문은 이미 저장된 뒤라 throw 하지 않지만, 조용히 넘기지 않고 안내 문구로 노출한다 —
  // 자연어 경로가 같은 실패를 warn 으로만 남겨 4회 연속 실패를 아무도 모르던 전례가 있다.
  private async applyRowProperties(
    pageId: string,
    keywords: string[],
  ): Promise<string> {
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildEveningBlogProperties(keywords),
      });
      return '';
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`저녁 블로그 DB 행 속성 설정 실패: ${message}`);
      return `\n⚠️ 본문은 저장됐지만 속성(태그/출처유형/카테고리/상태) 설정에 실패했습니다. Notion 에서 직접 채워주세요 — ${message}`;
    }
  }

  // 마크다운 본문 줄을 NotionPlanBlock 으로 최소 변환.
  // 빈 줄은 제외, '#' 계열은 heading/subheading, 나머지는 paragraph.
  private toBlocks(markdown: string): NotionPlanBlock[] {
    return markdown
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line): NotionPlanBlock => {
        if (line.startsWith('## ')) {
          return { type: 'subheading', text: line.replace(/^## /, '') };
        }
        if (line.startsWith('# ')) {
          return { type: 'heading', text: line.replace(/^# /, '') };
        }
        return { type: 'paragraph', text: line };
      });
  }
}
