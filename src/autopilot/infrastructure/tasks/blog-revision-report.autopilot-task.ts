import { Injectable } from '@nestjs/common';

import { ExtractRevisionConventionsUsecase } from '../../../agent/blog/application/extract-revision-conventions.usecase';
import { MeasureBlogRevisionUsecase } from '../../../agent/blog/application/measure-blog-revision.usecase';
import { compareRevisionWindows } from '../../../agent/blog/domain/revision-rate';
import { AgentRunService } from '../../../agent-run/application/agent-run.service';
import { TriggerType } from '../../../agent-run/domain/agent-run.type';
import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  formatBlogRevision,
  REVISION_WINDOW_DAYS,
} from '../../../slack/format/blog-revision.formatter';
import {
  AutopilotTask,
  AutopilotTaskResult,
} from '../../domain/autopilot-task.port';

/**
 * 주간 블로그 수정률 보고 — 발행한 글을 사람이 얼마나 다시 썼는지.
 *
 * 이 수치가 이 파이프라인에서 **글의 품질을 판정하는 유일한 자리**다. 편집 단계는 하한선만
 * 보고(필기인가·주제가 있나·800자 넘나·틀렸나), 문체 지표는 발행을 막지 않는다. 좋은 글과
 * 그저 그런 글을 가르는 것은 사람이 발행 뒤에 손을 대느냐였고, 그 판정이 지금까지 아무 데도
 * 쌓이지 않았다.
 *
 * 집계와 skip 모두 원장에 남겨, 다른 주간 회고가 미실행을 감지할 수 있게 한다.
 */
@Injectable()
export class BlogRevisionReportAutopilotTask implements AutopilotTask {
  readonly id = 'blog-revision-report';

  constructor(
    private readonly measureBlogRevision: MeasureBlogRevisionUsecase,
    private readonly agentRunService: AgentRunService,
    private readonly extractRevisionConventions: ExtractRevisionConventionsUsecase,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    const outcome = await this.agentRunService.execute<AutopilotTaskResult>({
      agentType: AgentType.BLOG_REVISION,
      triggerType: TriggerType.WEEKLY_BLOG_REVISION_CRON,
      inputSnapshot: { windowDays: REVISION_WINDOW_DAYS, lookbackDays: 28 },
      run: async () => {
        if (!this.measureBlogRevision.isConfigured()) {
          // 설정이 없어도 회차가 돌았다는 증거는 남긴다. 카드만 생략한다.
          return {
            result: { skip: true },
            modelUsed: 'none',
            output: {
              recentAveragePercent: 0,
              recentPostCount: 0,
              unmatchedCount: 0,
              conventions: [],
              skipReason: 'NOT_CONFIGURED',
            },
          };
        }
        // 집계 실패는 전파해 orchestrator 경고와 BullMQ 재시도를 유지한다.
        const report = await this.measureBlogRevision.execute();
        const now = new Date();
        const recent = compareRevisionWindows(
          report.rows,
          now,
          REVISION_WINDOW_DAYS,
        ).recent;
        const summaryText = formatBlogRevision(report, now);
        const extraction = await this.extractRevisionConventions.execute(
          report,
          now,
        );
        return {
          result:
            summaryText === null
              ? { skip: true }
              : { skip: false, summaryText },
          modelUsed: extraction.modelUsed,
          output: {
            recentAveragePercent: recent.averagePercent,
            recentPostCount: recent.postCount,
            unmatchedCount: report.unmatchedCount,
            conventions: extraction.conventions,
            ...(summaryText === null ? { skipReason: 'NO_RECENT_POSTS' } : {}),
          },
        };
      },
    });
    return outcome.result;
  }
}
