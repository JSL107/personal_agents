import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getTodayKstDate } from '../../../common/util/kst-date.util';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import {
  CareerProfileData,
  RenderResumeInput,
  RenderResumeResult,
} from '../domain/career-mate.type';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import { buildResumeBlocks } from '../infrastructure/career-mate.formatter';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class RenderResumeUsecase {
  private readonly logger = new Logger(RenderResumeUsecase.name);

  constructor(
    @Inject(CAREER_PROFILE_REPOSITORY_PORT)
    private readonly repository: CareerProfileRepositoryPort,
    private readonly buildProfile: BuildCareerProfileUsecase,
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly config: ConfigService,
  ) {}

  async execute({
    slackUserId,
  }: RenderResumeInput): Promise<RenderResumeResult> {
    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    const resolved: RenderResumeResult = latest
      ? { profile: latest.profileJson, agentRunId: latest.agentRunId ?? 0 }
      : await this.buildAndWrap(slackUserId);
    await this.mirrorToNotion(resolved.profile);
    return resolved;
  }

  private async buildAndWrap(slackUserId: string): Promise<RenderResumeResult> {
    const built = await this.buildProfile.execute({ slackUserId });
    return { profile: built.result, agentRunId: built.agentRunId };
  }

  // 이력서를 Notion 날짜별 자식 페이지에 최신본으로 미러 — best-effort.
  // env 미설정 시 skip, 실패해도 Slack/DB 결과는 그대로 반환 (구직 흐름 안 막음).
  private async mirrorToNotion(profile: CareerProfileData): Promise<void> {
    const parentPageId = this.config.get<string>(
      'CAREER_RESUME_NOTION_PAGE_ID',
    );
    if (!parentPageId) {
      return;
    }
    try {
      const page = await this.notionClient.findOrCreateChildPage({
        parentPageId,
        title: `이력서 — ${getTodayKstDate()}`,
      });
      await this.notionClient.replaceAllBlocks({
        pageId: page.pageId,
        blocks: buildResumeBlocks(profile),
      });
    } catch (error: unknown) {
      this.logger.warn(
        `이력서 Notion 미러 실패 (skip): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
