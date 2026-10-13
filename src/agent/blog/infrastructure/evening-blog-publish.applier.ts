import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
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
import {
  buildEveningBlogProperties,
  EVENING_BLOG_PUBLIC_SOURCE_TYPE,
  EVENING_BLOG_SOURCE_TYPE,
} from '../domain/evening-blog-publish-properties';
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

const PUBLIC_DRAFT_RETRO_CONTEXT =
  '(공개 저장소 초안이라 회고 맥락을 싣지 않는다 — 근거 PR 만으로 쓴다)';

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
    @Inject(GITHUB_CLIENT_PORT)
    private readonly githubClient: GithubClientPort,
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

    // 계약을 본문 생성 **전에** 정한다. 공개 계약은 코드블록을 가린 채 익명화하고 원문 그대로
    // 되돌리므로, 본문 모델이 회고 맥락(그날 회사 업무가 섞인 worklog·평가·머지 PR 요약)의
    // 사내 이름을 코드 예시로 옮기면 금지어 목록에 없는 한 그대로 발행된다(PR #790 리뷰 지적).
    // 그래서 공개 초안에는 회고 맥락을 싣지 않는다 — 재료는 공개 PR 본문과 주제 개요뿐이다.
    const sourceType = await this.resolveSourceType(payload.sourcePrs ?? []);
    const retroContext =
      sourceType === EVENING_BLOG_PUBLIC_SOURCE_TYPE
        ? PUBLIC_DRAFT_RETRO_CONTEXT
        : payload.retroContext;

    const completion = await this.modelRouter.route({
      agentType: AgentType.EVENING_RETRO,
      request: {
        prompt: buildEveningBlogBodyPrompt({
          title: payload.topPick.title,
          keywords: payload.topPick.keywords,
          reason: payload.topPick.reason ?? '',
          retroContext,
          sourcePrs: payload.sourcePrs ?? [],
          outline: payload.topPick.outline ?? [],
        }),
        systemPrompt: EVENING_BLOG_BODY_SYSTEM_PROMPT,
      },
      // 이 호출은 EVENING_RETRO 의 회고 업무가 아니라 provider 를 고르기 위해 그 타입을
      // 차용한다 — 실제로 받는 것은 Notion 에 그대로 실릴 Markdown 본문이다(아래 toBlocks).
      // 계약 머리말이 붙으면 "산출물에 prNotes·candidates·retrospective 를 포함하라" 가
      // 본문 지시와 충돌해 발행 글에 회고 JSON 이 섞인다.
      noContractPreamble: true,
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
      sourceType,
    );

    return {
      message: `블로그 초안을 Notion 에 발행했습니다 — ${row.url}${propertyNotice}`,
      artifacts: [],
    };
  }

  // 출처유형 = 발행 단계의 익명화 계약. 재료 PR 이 **1개 이상이고 전부 공개 저장소**일 때만
  // 공개 계약으로 보낸다. 재료가 없으면 그날 회고(회사 업무 포함)만으로 쓴 글이고, 조회가
  // 실패하면 공개인지 모른다 — 둘 다 회사 계약으로 떨어진다. 반대로 틀리면(비공개 코드를
  // 공개 계약으로 보내면) 코드가 마스킹돼 원문 그대로 발행되므로 엄격한 쪽이 기본이다.
  private async resolveSourceType(
    sourcePrs: EveningBlogSourcePr[],
  ): Promise<string> {
    if (sourcePrs.length === 0) {
      return EVENING_BLOG_SOURCE_TYPE;
    }
    try {
      const repositories = [
        ...new Set(sourcePrs.map((pullRequest) => pullRequest.repo)),
      ];
      const visibilities = await Promise.all(
        repositories.map((repository) =>
          this.githubClient.isRepositoryPublic(repository),
        ),
      );
      return visibilities.every(Boolean)
        ? EVENING_BLOG_PUBLIC_SOURCE_TYPE
        : EVENING_BLOG_SOURCE_TYPE;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `재료 저장소 공개 여부 조회 실패 — 회사 계약(${EVENING_BLOG_SOURCE_TYPE})으로 저장: ${message}`,
      );
      return EVENING_BLOG_SOURCE_TYPE;
    }
  }

  // 본문 적재 후 DB 행 속성(태그/출처유형/카테고리/상태)을 채운다.
  // 본문은 이미 저장된 뒤라 throw 하지 않지만, 조용히 넘기지 않고 안내 문구로 노출한다 —
  // 자연어 경로가 같은 실패를 warn 으로만 남겨 4회 연속 실패를 아무도 모르던 전례가 있다.
  private async applyRowProperties(
    pageId: string,
    keywords: string[],
    sourceType: string,
  ): Promise<string> {
    try {
      await this.notionClient.updatePageProperties({
        pageId,
        properties: buildEveningBlogProperties(keywords, sourceType),
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
