import { Injectable } from '@nestjs/common';

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

  constructor(
    private readonly measureBlogRevision: MeasureBlogRevisionUsecase,
  ) {}

  async run(): Promise<AutopilotTaskResult> {
    if (!this.measureBlogRevision.isConfigured()) {
      // 블로그 발행을 설정하지 않은 환경에서는 기능이 없는 것처럼 조용히 넘긴다.
      return { skip: true };
    }

    // 집계 실패를 삼키지 않는다. orchestrator 가 이미 그룹을 계속 진행시키면서 digest 에
    // 「⚠️ 자동 생성 실패」를 적고, 저빈도 cron 은 BullMQ 로 4회까지 재시도한다. 여기서
    // `skip: true` 로 정상 종료하면 그 두 경로가 모두 죽어 그 주 보고가 조용히 유실된다.
    const report = await this.measureBlogRevision.execute();
    const summaryText = formatBlogRevision(report, new Date());
    if (summaryText === null) {
      // 구간에 발행이 없으면 보고할 것이 없다. 이건 실패가 아니다.
      return { skip: true };
    }
    return { skip: false, summaryText };
  }
}
