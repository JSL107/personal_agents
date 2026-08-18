import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PublishPortfolioSiteResult,
  PublishPortfolioSiteUsecase,
} from '../../../agent/career-mate/application/publish-portfolio-site.usecase';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

// 경력 프로필을 포트폴리오 사이트에 비공개 초안으로 발행한다(하루 1회).
//
// 저녁 회고(19:00)가 프로필을 갱신하고, 그 승인 카드가 눌릴 여유를 둔 뒤 발행한다.
// 승인이 안 눌린 날은 이전 프로필을 다시 발행하는데, slug 멱등이라 중복이 생기지 않는다.
// 설계: docs/superpowers/plans/2026-08-18-portfolio-site-automation.md §4-C.
@Injectable()
export class PortfolioPublishAutopilotTask implements AutopilotTask {
  readonly id = 'portfolio-publish';
  private readonly logger = new Logger(PortfolioPublishAutopilotTask.name);

  constructor(
    private readonly publishPortfolioSite: PublishPortfolioSiteUsecase,
    private readonly configService: ConfigService,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (!this.isConfigured()) {
      // 사이트 주소나 자동화 토큰이 없는 환경 — 이 슬롯을 쓰지 않는다.
      return { skip: true };
    }

    let result: PublishPortfolioSiteResult;
    try {
      result = await this.publishPortfolioSite.execute({
        slackUserId: context.ownerSlackUserId,
      });
    } catch (error) {
      // 발행 자체가 통째로 실패한 경우(프로필 조회 실패, 사이트 목록 조회 실패 등).
      // 조용히 삼키면 "왜 포트폴리오가 안 바뀌나"를 나중에 추적해야 한다.
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(`포트폴리오 사이트 발행 실패 — ${reason}`);
      return {
        skip: false,
        summaryText: `⚠️ *포트폴리오 사이트 발행 실패* — ${reason}`,
      };
    }

    return this.toTaskResult(result);
  }

  private isConfigured(): boolean {
    const siteUrl = this.configService
      .get<string>('PORTFOLIO_SITE_URL')
      ?.trim();
    const token = this.configService
      .get<string>('PORTFOLIO_AUTOMATION_TOKEN')
      ?.trim();
    return Boolean(siteUrl) && Boolean(token);
  }

  // 갱신만 있는 날은 보고하지 않는다 — 같은 성과를 매일 다시 밀어 넣으므로 갱신은 상시
  // 발생하고, 그걸 매일 알리면 알림이 배경 소음이 된다. 신규·실패·누락만 사람에게 올린다.
  private toTaskResult(
    result: PublishPortfolioSiteResult,
  ): AutopilotTaskResult {
    const worthReporting =
      result.createdProjects.length > 0 ||
      result.createdSkillGroups.length > 0 ||
      result.failures.length > 0 ||
      result.skippedTitles.length > 0;
    if (!worthReporting) {
      this.logger.log(
        `포트폴리오 사이트 발행 — 변화 없음(갱신 ${result.updatedProjects.length}건)`,
      );
      return { skip: true };
    }

    const summaryLines = ['📁 *포트폴리오 사이트 발행*'];
    if (result.createdProjects.length > 0) {
      summaryLines.push(
        `• 새 프로젝트 ${result.createdProjects.length}건 (비공개 초안 — 편집기에서 게시하면 공개)`,
      );
    }
    if (result.createdSkillGroups.length > 0) {
      summaryLines.push(`• 새 스킬 그룹 ${result.createdSkillGroups.length}건`);
    }
    if (result.skippedTitles.length > 0) {
      summaryLines.push(
        `• 근거 PR 이 없어 건너뜀 ${result.skippedTitles.length}건`,
      );
    }
    if (result.failures.length > 0) {
      summaryLines.push(`• ⚠️ 실패 ${result.failures.length}건`);
    }

    return {
      skip: false,
      summaryText: summaryLines.join('\n'),
      detailText: this.buildDetail(result),
    };
  }

  private buildDetail(result: PublishPortfolioSiteResult): string {
    const lines: string[] = [];
    if (result.createdProjects.length > 0) {
      lines.push(`신규: ${result.createdProjects.join(', ')}`);
    }
    if (result.updatedProjects.length > 0) {
      lines.push(`갱신: ${result.updatedProjects.join(', ')}`);
    }
    if (result.skippedTitles.length > 0) {
      lines.push(`건너뜀: ${result.skippedTitles.join(' / ')}`);
    }
    for (const failure of result.failures) {
      lines.push(`실패 ${failure.target} — ${failure.reason}`);
    }
    if (result.publicSlugsAfter === null) {
      lines.push(
        '공개 페이지 확인: 건너뜀 (PORTFOLIO_SITE_HANDLE 미설정 — 발행 실패와는 무관)',
      );
    } else {
      const missing = result.createdProjects.filter(
        (slug) => !result.publicSlugsAfter?.includes(slug),
      );
      lines.push(
        missing.length === 0
          ? `공개 페이지 확인: 발행분 전부 조회됨 (총 ${result.publicSlugsAfter.length}건)`
          : `공개 페이지 확인: ${missing.length}건 미노출 — 비공개 초안이라 정상 (게시 후 노출)`,
      );
    }
    return lines.join('\n');
  }
}
