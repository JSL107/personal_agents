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

  // 페이지당 "아직 시작하지 않은 반영" 한 자리. 반영이 도는 동안 새 요청이 오면 이 자리를
  // 최신 블록으로 갈아끼운다 — replaceAllBlocks 는 페이지를 통째로 다시 쓰므로 중간 회차는
  // 어차피 마지막 회차가 덮는다. 자리를 하나로 묶지 않으면 회고를 연달아 할 때 회차마다
  // 수백 초짜리 전체 재작성이 줄줄이 쌓여, 같은 결과를 내면서 Notion 왕복만 배로 쓰고
  // 프로세스가 내려갈 때 유실될 구간도 그만큼 길어진다.
  private readonly pendingBlocks = new Map<string, NotionPlanBlock[]>();
  private readonly drainingPages = new Set<string>();

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
      this.queueBlockSync(page.pageId, blocks);
    } else {
      await this.notionClient.replaceAllBlocks({
        pageId: page.pageId,
        blocks,
      });
    }

    return { url: page.url, pageId: page.pageId, agentRunId, reusedAgentRun };
  }

  // 반영을 대기열의 유일한 자리에 올린다. 이미 도는 루프가 있으면 그 루프가 집어가므로
  // 여기서 새로 띄우지 않는다 — 그래서 한 페이지에 동시에 도는 반영은 최대 하나다.
  private queueBlockSync(pageId: string, blocks: NotionPlanBlock[]): void {
    this.pendingBlocks.set(pageId, blocks);
    if (this.drainingPages.has(pageId)) {
      return;
    }
    this.drainingPages.add(pageId);
    void this.drainBlockSync(pageId);
  }

  // 본문 반영을 응답 경로 밖에서 끝낸다. 실패는 로그로만 남긴다 — 호출부는 이미 사용자에게
  // 회고 결과와 링크를 돌려준 뒤라 여기서 던져도 받을 곳이 없다(BlogDispatcher.runInBackground
  // 와 같은 정책). 페이지는 이미 존재하므로 링크 자체는 유효하고, 본문만 직전 회차 상태로
  // 남았다가 다음 회고 때 최신 프로필로 통째 덮인다.
  //
  // 한 번 더 도는 이유는 반영 중에 들어온 최신 회차를 집기 위해서다. 실패해도 대기열은
  // 계속 비운다 — 한 회차의 실패가 뒤에 올라온 최신 회차까지 막으면 안 된다.
  private async drainBlockSync(pageId: string): Promise<void> {
    try {
      for (;;) {
        const blocks = this.pendingBlocks.get(pageId);
        if (!blocks) {
          return;
        }
        this.pendingBlocks.delete(pageId);
        try {
          await this.notionClient.replaceAllBlocks({ pageId, blocks });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `포트폴리오 본문 반영 실패 (page ${pageId} — 링크는 이미 전달됨, 다음 회고 때 재반영): ${message}`,
          );
        }
      }
    } finally {
      // 반드시 푼다. 남겨 두면 그 페이지는 이후 어떤 반영도 시작되지 않는다.
      this.drainingPages.delete(pageId);
    }
  }
}
