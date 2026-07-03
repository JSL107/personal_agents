import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
import {
  buildEveningBlogBodyPrompt,
  EVENING_BLOG_BODY_SYSTEM_PROMPT,
} from '../domain/prompt/evening-retro.prompt';

interface EveningBlogPayload {
  topPick: { title: string; keywords: string[] };
  retroContext: string;
  slackUserId: string;
}

@Injectable()
export class EveningBlogPublishApplier implements PreviewApplier {
  readonly kind = PREVIEW_KIND.EVENING_BLOG_PUBLISH;

  constructor(
    private readonly modelRouter: ModelRouterUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly config: ConfigService,
  ) {}

  async apply(preview: PreviewAction): Promise<ApplyResult> {
    const payload = preview.payload as EveningBlogPayload;
    if (!payload?.topPick?.title) {
      throw new Error('EVENING_BLOG_PUBLISH: payload.topPick 누락');
    }
    const parentPageId = this.config
      .get<string>('EVENING_RETRO_BLOG_NOTION_PAGE_ID')
      ?.trim();
    if (!parentPageId) {
      throw new Error(
        'EVENING_RETRO_BLOG_NOTION_PAGE_ID 가 설정되지 않았습니다 (.env 확인).',
      );
    }

    const completion = await this.modelRouter.route({
      agentType: AgentType.EVENING_RETRO,
      request: {
        prompt: buildEveningBlogBodyPrompt({
          title: payload.topPick.title,
          keywords: payload.topPick.keywords,
          retroContext: payload.retroContext,
        }),
        systemPrompt: EVENING_BLOG_BODY_SYSTEM_PROMPT,
      },
    });

    const child = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: payload.topPick.title,
    });
    await this.notionClient.appendBlocks({
      pageId: child.pageId,
      blocks: this.toBlocks(completion.text),
    });

    return {
      message: `블로그 초안을 Notion 에 발행했습니다 — ${child.url}`,
      artifacts: [],
    };
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
