import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import {
  ActiveRunSnapshot,
  FailedRunDetail,
  RecentlyFinishedRun,
} from '../../../agent-run/domain/port/agent-run.repository.port';
import { AgentType } from '../../../model-router/domain/model-router.type';
import { FindAllOpenPreviewsUsecase } from '../../../preview-gate/application/find-all-open-previews.usecase';
import { PreviewAction } from '../../../preview-gate/domain/preview-action.type';
import { attributeDelay } from '../domain/attribute-delay';
import {
  AXIS_ACTIVE_RUN,
  AXIS_APPROVAL,
  AXIS_FAILED_RUN,
  AXIS_FINISHED_RUN,
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

const isNotDelayReport = (run: { agentType: string }): boolean =>
  run.agentType !== AgentType.DELAY_REPORT;

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
        AXIS_ACTIVE_RUN,
      ),
      this.readOrFallback(
        () => this.findAllOpenPreviews.execute({ now }),
        [] as PreviewAction[],
        AXIS_APPROVAL,
      ),
      this.readOrFallback(
        () =>
          this.agentRunService.findFailedRunsSince({
            withinMinutes: WINDOW_MINUTES,
          }),
        [] as FailedRunDetail[],
        AXIS_FAILED_RUN,
      ),
      this.readOrFallback(
        () =>
          this.agentRunService.findRecentlyFinishedRuns({
            withinMinutes: WINDOW_MINUTES,
          }),
        [] as RecentlyFinishedRun[],
        AXIS_FINISHED_RUN,
      ),
    ]);
    const unavailableAxes = [
      activeRunsResult.unavailableAxis,
      openPreviewsResult.unavailableAxis,
      failedRunsResult.unavailableAxis,
      finishedRunsResult.unavailableAxis,
    ].filter((axis): axis is string => axis !== null);

    const input: DelayReportInput = {
      // 지연 보고 자신의 run 은 세 입력 모두에서 뺀다 — dispatcher 가 AgentRun 안에서 부르므로
      // 지금 회차는 IN_PROGRESS 로, 지난 회차는 성공·실패로 원장에 있다. 남겨 두면 "진행 중 작업:
      // 지연 보고" 나 "지연 보고 실행이 실패했어요" 가 사용자 작업의 지연 원인으로 뽑힌다.
      activeRuns: activeRunsResult.value.filter(isNotDelayReport),
      openPreviews: openPreviewsResult.value.filter(
        (preview) => preview.slackUserId === slackUserId,
      ),
      failedRuns: failedRunsResult.value.filter(isNotDelayReport),
      recentlyFinished: finishedRunsResult.value.filter(isNotDelayReport),
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
