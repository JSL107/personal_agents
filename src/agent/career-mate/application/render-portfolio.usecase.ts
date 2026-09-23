import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DomainStatus } from '../../../common/exception/domain-status.enum';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
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
  private readonly logger = new Logger(RenderPortfolioUsecase.name);

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
    deferBlockSync,
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
    let reusedAgentRun: boolean;
    if (latest) {
      profile = latest.profileJson;
      agentRunId = latest.agentRunId ?? 0;
      reusedAgentRun = true;
    } else {
      const built = await this.buildProfile.execute({ slackUserId });
      profile = built.result;
      agentRunId = built.agentRunId;
      reusedAgentRun = false;
    }

    const page = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: `포트폴리오 — ${profile.meta.windowStart}~`,
    });
    // 매 호출마다 최신 프로필로 페이지 전체 재작성 — 중복 누적 방지 (replaceAllBlocks).
    const blocks = buildPortfolioBlocks(profile);
    if (deferBlockSync) {
      // 여기서 기다리지 않는다. replaceAllBlocks 는 기존 block 을 하나씩 순차 archive 해서
      // 성과가 쌓일수록 선형으로 길어진다 — 2026-09-22 실측(agent_run #4752)에서 성과 101건
      // (block 602개)에 335초였고, 그것이 REFLECT_PR 전체 438초의 78% 였다. 회고 결과는 이미
      // 다 만들어진 뒤라 사용자를 이 구간에 붙잡아 둘 이유가 없다.
      void this.syncBlocksInBackground(page.pageId, blocks);
    } else {
      await this.notionClient.replaceAllBlocks({
        pageId: page.pageId,
        blocks,
      });
    }

    return { url: page.url, pageId: page.pageId, agentRunId, reusedAgentRun };
  }

  // 본문 반영을 응답 경로 밖에서 끝낸다. 실패는 로그로만 남긴다 — 호출부는 이미 사용자에게
  // 회고 결과와 링크를 돌려준 뒤라 여기서 던져도 받을 곳이 없다(BlogDispatcher.runInBackground
  // 와 같은 정책). 페이지는 이미 존재하므로 링크 자체는 유효하고, 본문만 직전 회차 상태로
  // 남았다가 다음 회고 때 최신 프로필로 통째 덮인다.
  private async syncBlocksInBackground(
    pageId: string,
    blocks: NotionPlanBlock[],
  ): Promise<void> {
    try {
      await this.notionClient.replaceAllBlocks({ pageId, blocks });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `포트폴리오 본문 반영 실패 (page ${pageId} — 링크는 이미 전달됨, 다음 회고 때 재반영): ${message}`,
      );
    }
  }
}
