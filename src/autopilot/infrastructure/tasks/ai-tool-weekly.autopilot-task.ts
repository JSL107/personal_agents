import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { parseAiWeeklyMetrics } from '../../../ai-tool-weekly/domain/ai-weekly-metrics.parser';
import {
  AiWeeklyPeriod,
  resolveAiWeeklyPeriod,
} from '../../../ai-tool-weekly/domain/ai-weekly-period';
import { AiWeeklyMetricsRunner } from '../../../ai-tool-weekly/infrastructure/ai-weekly-metrics.runner';
import {
  GITHUB_CLIENT_PORT,
  GithubClientPort,
} from '../../../github/domain/port/github-client.port';
import {
  AiWeeklyPullRequests,
  formatAiToolWeekly,
} from '../../../slack/format/ai-tool-weekly.formatter';
import {
  AutopilotTask,
  AutopilotTaskContext,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

@Injectable()
export class AiToolWeeklyAutopilotTask implements AutopilotTask {
  readonly id = 'ai-tool-weekly';
  private readonly logger = new Logger(AiToolWeeklyAutopilotTask.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly runner: AiWeeklyMetricsRunner,
    @Inject(GITHUB_CLIENT_PORT) private readonly github: GithubClientPort,
  ) {}

  async run(context: AutopilotTaskContext): Promise<AutopilotTaskResult> {
    if (!this.configService.get<string>('AUTOPILOT_HARNESS_TARGET')?.trim()) {
      this.logger.log('AI 도구 주간 점검 비활성');
      return { skip: true };
    }
    const period = resolveAiWeeklyPeriod(context.firedAtKst);
    const pullRequests = await this.readPullRequests(period);
    const raw = await this.runner.run(period);
    const { metrics, droppedNameCount } = parseAiWeeklyMetrics(raw);
    if (droppedNameCount > 0) {
      this.logger.warn(`이름 검증 탈락 ${droppedNameCount}건`);
    }
    const formatted = formatAiToolWeekly({ period, metrics, pullRequests });
    return {
      skip: false,
      summaryText: formatted.summary,
      detailText: formatted.detail,
    };
  }

  private async readPullRequests(
    period: AiWeeklyPeriod,
  ): Promise<AiWeeklyPullRequests> {
    const author = this.configService
      .get<string>('IMPACT_REPORT_GITHUB_AUTHOR')
      ?.trim();
    if (!author) {
      return { status: 'error' };
    }
    try {
      const results = await this.github.listAuthorMergedPullRequestsSince({
        repo: null,
        author,
        sinceIsoDate: toSearchDateTime(period.since),
        untilIsoDate: toSearchDateTime(new Date(period.until.getTime() - 1000)),
        limit: 100,
        throwOnDetailFailure: true,
      });
      const included = results.filter(
        (item) => item.mergedAt && new Date(item.mergedAt) < period.until,
      );
      const company = included.filter(
        (item) => item.repo.split('/')[0].toLowerCase() === 'schoolbell-e',
      ).length;
      return {
        status: 'ok',
        company,
        personal: included.length - company,
        truncated: results.length >= 100,
      };
    } catch {
      this.logger.warn('머지 PR 조회 실패');
      return { status: 'error' };
    }
  }
}

// GitHub 검색어에 넣는 시각. Octokit 은 검색어의 '+' 를 인코딩하지 않아 '+09:00' 이 공백으로 읽히고
// 결과가 0건이 된다(2026-11-10 첫 발송). 그래서 오프셋 없이 UTC Z 형식으로 넘긴다.
const toSearchDateTime = (date: Date): string => {
  const iso = date.toISOString();
  return `${iso.slice(0, 19)}Z`;
};
