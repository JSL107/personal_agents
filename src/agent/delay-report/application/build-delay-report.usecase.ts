import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { attributeDelay } from '../domain/attribute-delay';
import {
  DelayReportInput,
  DelayReportIntegrations,
  DelayVerdict,
} from '../domain/delay-report.type';

export interface BuildDelayReportInput {
  slackUserId: string;
  now: Date;
}

const WINDOW_MINUTES = 24 * 60;

interface ReadResult<T> {
  value: T;
  unavailableAxis: string | null;
}

@Injectable()
export class BuildDelayReportUsecase {
  private readonly logger = new Logger(BuildDelayReportUsecase.name);

  constructor(
    private readonly agentRunService: AgentRunService,
    private readonly findAllOpenPreviews: FindAllOpenPreviewsUsecase,
    private readonly configService: ConfigService,
  ) {}

  // 축 하나가 죽어도 나머지로 보고를 완성한다. 단 빈 값으로 침묵하면 "지연 없습니다" 로
  // 잘못 닫히므로, 실패한 축 이름을 함께 돌려 판정·문구까지 전달한다.
  private async readOrFallback<T>(
    read: () => Promise<T>,
    fallback: T,
    axis: string,
  ): Promise<ReadResult<T>> {
    try {
      return { value: await read(), unavailableAxis: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`DELAY_REPORT 조회 실패 — ${axis}: ${message}`);
      return { value: fallback, unavailableAxis: axis };
    }
  }

  async execute({
    slackUserId,
    now,
  }: BuildDelayReportInput): Promise<DelayVerdict> {
    const [
      activeRunsResult,
      openPreviewsResult,
      failedRunsResult,
      finishedRunsResult,
    ] = await Promise.all([
      this.readOrFallback(
        () => this.agentRunService.findActiveRuns(),
        [] as ActiveRunSnapshot[],
        '진행 중 작업',
      ),
      this.readOrFallback(
        () => this.findAllOpenPreviews.execute({ now }),
        [] as PreviewAction[],
        '승인 대기 카드',
      ),
      this.readOrFallback(
        () =>
          this.agentRunService.findFailedRunsSince({
            withinMinutes: WINDOW_MINUTES,
          }),
        [] as FailedRunDetail[],
        '최근 실패',
      ),
      this.readOrFallback(
        () =>
          this.agentRunService.findRecentlyFinishedRuns({
            withinMinutes: WINDOW_MINUTES,
          }),
        [] as RecentlyFinishedRun[],
        '최근 종료 상태',
      ),
    ]);
    const unavailableAxes = [
      activeRunsResult.unavailableAxis,
      openPreviewsResult.unavailableAxis,
      failedRunsResult.unavailableAxis,
      finishedRunsResult.unavailableAxis,
    ].filter((axis): axis is string => axis !== null);

    const input: DelayReportInput = {
      activeRuns: activeRunsResult.value,
      openPreviews: openPreviewsResult.value.filter(
        (preview) => preview.slackUserId === slackUserId,
      ),
      failedRuns: failedRunsResult.value,
      recentlyFinished: finishedRunsResult.value,
      integrations: this.readIntegrations(),
      now,
      unavailableAxes,
    };
    return attributeDelay(input);
  }

  private readIntegrations(): DelayReportIntegrations {
    return {
      githubConfigured: Boolean(this.configService.get<string>('GITHUB_TOKEN')),
      notionConfigured: Boolean(this.configService.get<string>('NOTION_TOKEN')),
    };
  }
}
