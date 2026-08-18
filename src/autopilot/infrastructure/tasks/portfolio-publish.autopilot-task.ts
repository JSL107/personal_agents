import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditResumeUsecase } from '../../../agent/career-mate/application/audit-resume.usecase';
import {
  PublishPortfolioSiteResult,
  PublishPortfolioSiteUsecase,
} from '../../../agent/career-mate/application/publish-portfolio-site.usecase';
import { ResumeAuditResult } from '../../../agent/career-mate/domain/career-mate.type';
import { formatResumeAudit } from '../../../agent/career-mate/infrastructure/career-mate.formatter';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
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
    private readonly auditResume: AuditResumeUsecase,
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

    let auditResult: ResumeAuditResult | null = null;
    let auditNote: string | null = null;
    // 감사는 발행 성공 뒤 별도 경계에서만 실행한다. 여기서 같은 try/catch 를 공유하면 감사의
    // 모델·파서 실패가 이미 성공한 발행 결과까지 실패로 바꾸는 과거 관제 사고를 재현한다.
    try {
      const outcome = await this.auditResume.execute({
        slackUserId: context.ownerSlackUserId,
        triggerType: TriggerType.AUTOPILOT_RESUME_AUDIT_CRON,
      });
      auditResult = outcome.result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      auditNote = `⚠️ 감사 실패 — ${reason}`;
      this.logger.warn(auditNote);
    }

    return this.toTaskResult(result, auditResult, auditNote);
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
    auditResult: ResumeAuditResult | null,
    auditNote: string | null,
  ): AutopilotTaskResult {
    const weakCount =
      auditResult?.items.filter((item) => item.status === 'WEAK').length ?? 0;
    const missingCount =
      auditResult?.items.filter((item) => item.status === 'MISSING').length ??
      0;
    const hasGuardConcern = auditResult
      ? auditResult.guard.demotedTitles.length > 0 ||
        auditResult.guard.droppedTitles.length > 0 ||
        auditResult.guard.unjudgedTitles.length > 0
      : false;
    const worthReporting =
      result.createdProjects.length > 0 ||
      result.createdSkillGroups.length > 0 ||
      result.failures.length > 0 ||
      result.skippedTitles.length > 0 ||
      result.missingAfterPublish.length > 0 ||
      weakCount > 0 ||
      missingCount > 0 ||
      hasGuardConcern ||
      auditNote !== null;
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
    if (result.missingAfterPublish.length > 0) {
      summaryLines.push(
        `• ⚠️ 발행 후 재조회에 없는 항목 ${result.missingAfterPublish.length}건`,
      );
    }
    if (auditResult && (weakCount > 0 || missingCount > 0)) {
      summaryLines.push(
        `• 📋 이력서 감사 — 약함 ${weakCount}건 / 근거없음 ${missingCount}건 (총 ${auditResult.items.length}건)`,
      );
    }
    if (auditResult && hasGuardConcern) {
      summaryLines.push(
        `• ⚠️ 이력서 감사 가드 경고 — 강등 ${auditResult.guard.demotedTitles.length} / 폐기 ${auditResult.guard.droppedTitles.length} / 누락 ${auditResult.guard.unjudgedTitles.length}`,
      );
    }
    if (auditNote) {
      summaryLines.push(`• ${auditNote}`);
    }

    return {
      skip: false,
      summaryText: summaryLines.join('\n'),
      detailText: this.buildDetail(result, auditResult, auditNote),
    };
  }

  private buildDetail(
    result: PublishPortfolioSiteResult,
    auditResult: ResumeAuditResult | null,
    auditNote: string | null,
  ): string {
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
    if (result.missingAfterPublish.length > 0) {
      lines.push(
        `발행 확인: 재조회에 없는 slug ${result.missingAfterPublish.join(', ')} — 사이트 저장이 실제로 안 됐을 수 있다`,
      );
    } else if (
      result.createdProjects.length > 0 ||
      result.updatedProjects.length > 0
    ) {
      lines.push('발행 확인: 재조회에서 발행분 전부 확인');
    }
    if (auditResult) {
      const weakItems = auditResult.items.filter(
        (item) => item.status === 'WEAK' || item.status === 'MISSING',
      );
      const hasGuardConcern =
        auditResult.guard.demotedTitles.length > 0 ||
        auditResult.guard.droppedTitles.length > 0 ||
        auditResult.guard.unjudgedTitles.length > 0;
      if (weakItems.length > 0 || hasGuardConcern) {
        // 수동/자동 경로가 같은 escape 규약을 쓰게 formatter 결과를 재사용한다. LLM 문자열을
        // task 에서 직접 이어 붙이면 Slack mrkdwn 제어문자가 보고 구조를 위조할 수 있다.
        lines.push(formatResumeAudit(auditResult).full);
      }
    }
    if (auditNote) {
      lines.push(auditNote);
    }
    return lines.join('\n');
  }
}
