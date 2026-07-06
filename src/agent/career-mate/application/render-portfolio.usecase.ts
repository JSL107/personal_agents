import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
} from '../../../notion/domain/port/notion-client.port';
import { CareerMateException } from '../domain/career-mate.exception';
import {
  CareerProfileData,
  RenderPortfolioInput,
  RenderPortfolioResult,
} from '../domain/career-mate.type';
import { CareerMateErrorCode } from '../domain/career-mate-error-code.enum';
import {
  CAREER_PROFILE_REPOSITORY_PORT,
  CareerProfileRepositoryPort,
} from '../domain/port/career-profile.repository.port';
import { buildPortfolioBlocks } from '../infrastructure/career-mate.formatter';
import { BuildCareerProfileUsecase } from './build-career-profile.usecase';

@Injectable()
export class RenderPortfolioUsecase {
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
  }: RenderPortfolioInput): Promise<RenderPortfolioResult> {
    const parentPageId = this.config.get<string>(
      'CAREER_PORTFOLIO_NOTION_PAGE_ID',
    );
    if (!parentPageId) {
      throw new CareerMateException({
        code: CareerMateErrorCode.CONFIG_MISSING,
        message:
          'CAREER_PORTFOLIO_NOTION_PAGE_ID 가 설정되지 않았습니다 (.env 확인).',
        status: DomainStatus.INTERNAL,
      });
    }

    const latest = await this.repository.findLatestBySlackUser(slackUserId);
    let profile: CareerProfileData;
    let agentRunId: number;
    if (latest) {
      profile = latest.profileJson;
      agentRunId = latest.agentRunId ?? 0;
    } else {
      const built = await this.buildProfile.execute({ slackUserId });
      profile = built.result;
      agentRunId = built.agentRunId;
    }

    const page = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: `포트폴리오 — ${profile.meta.windowStart}~`,
    });
    // 매 호출마다 최신 프로필로 페이지 전체 재작성 — 중복 누적 방지 (replaceAllBlocks).
    await this.notionClient.replaceAllBlocks({
      pageId: page.pageId,
      blocks: buildPortfolioBlocks(profile),
    });

    return { url: page.url, pageId: page.pageId, agentRunId };
  }
}
