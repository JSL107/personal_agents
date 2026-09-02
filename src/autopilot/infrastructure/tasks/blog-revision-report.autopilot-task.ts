import { Injectable, Logger } from '@nestjs/common';

import { MeasureBlogRevisionUsecase } from '../../../agent/blog/application/measure-blog-revision.usecase';
import { formatBlogRevision } from '../../../slack/format/blog-revision.formatter';
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
 * LLM 을 부르지 않는다. 원장 조회 + 파일 조회 + 줄 비교뿐이라 쿼터를 쓰지 않는다.
 */
@Injectable()
export class BlogRevisionReportAutopilotTask implements AutopilotTask {
  readonly id = 'blog-revision-report';
  private readonly logger = new Logger(BlogRevisionReportAutopilotTask.name);

  constructor(
    private readonly measureBlogRevision: MeasureBlogRevisionUsecase,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    if (!this.measureBlogRevision.isConfigured()) {
      // 블로그 발행을 설정하지 않은 환경에서는 기능이 없는 것처럼 조용히 넘긴다.
      return { skip: true };
    }

    try {
      const report = await this.measureBlogRevision.execute();
      const summaryText = formatBlogRevision(report, new Date());
      if (summaryText === null) {
        // 구간에 발행이 없으면 보고할 것이 없다.
        return { skip: true };
      }
      return { skip: false, summaryText };
    } catch (error: unknown) {
      // 관측용 카드 하나 때문에 같은 회차의 다른 보고까지 끊지 않는다. 대신 조용히 사라지지
      // 않게 로그로 남긴다 — 이 카드가 몇 주째 안 보이면 여기부터 본다.
      this.logger.warn(
        `블로그 수정률 집계 실패, 이 회차는 건너뛴다: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { skip: true };
    }
  }
}
