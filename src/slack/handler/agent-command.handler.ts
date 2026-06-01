import { Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { SearchAgentRunsUsecase } from '../../agent-run/application/search-agent-runs.usecase';
import { SlackHandler } from '../domain/port/slack-handler.port';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { formatSearchRuns } from '../format/search-runs.formatter';
import { runAgentCommand, runEphemeral } from './slack-handler.helper';

// 사용자 ↔ worker 1:1 fast path 명령군 (LLM 호출, 단일 worker 진입).
// 모두 동일 골격: (1) 인자 검증 → (2) 진행 안내 ack → (3) usecase 실행 → (4) format + footer 응답.
// runAgentCommand 가 (3)+(4)+에러 로깅을 캡슐화해 각 핸들러는 골격만 노출.
//
// C-4 Phase 6 — registerAgentCommandHandlers fn → @Injectable() class.
@Injectable()
export class AgentCommandHandler implements SlackHandler {
  private readonly logger = new Logger(AgentCommandHandler.name);

  constructor(
    private readonly generateDailyPlanUsecase: GenerateDailyPlanUsecase,
    private readonly generateWorklogUsecase: GenerateWorklogUsecase,
    private readonly reviewPullRequestUsecase: ReviewPullRequestUsecase,
    private readonly generateImpactReportUsecase: GenerateImpactReportUsecase,
    private readonly generatePoShadowUsecase: GeneratePoShadowUsecase,
    // /search-runs — 본인 AgentRun output / inputSnapshot 키워드 검색. LLM 호출 X.
    private readonly searchAgentRunsUsecase: SearchAgentRunsUsecase,
  ) {}

  register(app: App): void {
    app.command('/today', async ({ ack, command, respond }) => {
      // 자유 텍스트는 옵션. 빈 입력이면 GitHub assigned / Notion task / Slack 멘션 / 직전 PM·Work Reviewer
      // 자동 수집만으로 plan 생성. 자동 컨텍스트도 모두 비어있으면 EMPTY_TASKS_INPUT 으로 끊고 안내.
      const tasksText = command.text?.trim() ?? '';
      const ackMessage =
        tasksText.length === 0
          ? '이대리가 자동 수집한 컨텍스트(GitHub/Notion/Slack/어제 plan)로 오늘의 계획을 작성 중입니다 (10~20초 소요)...'
          : '이대리가 오늘의 계획을 작성 중입니다 (10~20초 소요)...';
      await ack({ response_type: 'ephemeral', text: ackMessage });

      await runAgentCommand({
        respond,
        logger: this.logger,
        commandLabel: '/today',
        execute: () =>
          this.generateDailyPlanUsecase.execute({
            tasksText,
            slackUserId: command.user_id,
          }),
        format: (result) => formatDailyPlan(result.plan),
      });
    });

    app.command('/worklog', async ({ ack, command, respond }) => {
      const workText = command.text?.trim() ?? '';
      if (workText.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/worklog <오늘 한 일을 자유롭게 적어주세요>`',
        });
        return;
      }
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 오늘의 회고를 작성 중입니다 (10~20초 소요)...',
      });

      await runAgentCommand({
        respond,
        logger: this.logger,
        commandLabel: '/worklog',
        execute: () =>
          this.generateWorklogUsecase.execute({
            workText,
            slackUserId: command.user_id,
          }),
        format: formatDailyReview,
      });
    });

    app.command('/po-shadow', async ({ ack, command, respond }) => {
      // 직전 PM plan 을 PO 시각으로 재검토 — 인자 없이도 OK (extra context optional).
      const extraContext = command.text?.trim() ?? '';
      await ack({
        response_type: 'ephemeral',
        text: '이대리(PO 모드) 가 직전 plan 을 재검토 중입니다 (10~30초 소요)...',
      });

      await runAgentCommand({
        respond,
        logger: this.logger,
        commandLabel: '/po-shadow',
        execute: () =>
          this.generatePoShadowUsecase.execute({
            extraContext,
            slackUserId: command.user_id,
          }),
        format: formatPoShadowReport,
      });
    });

    app.command('/impact-report', async ({ ack, command, respond }) => {
      const subject = command.text?.trim() ?? '';
      if (subject.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/impact-report <PR 링크 또는 task 설명>` (예: `/impact-report PR #34 — GitHub 커넥터 추가`)',
        });
        return;
      }
      await ack({
        response_type: 'ephemeral',
        text: '이대리가 임팩트 보고서를 작성 중입니다 (10~30초 소요)...',
      });

      await runAgentCommand({
        respond,
        logger: this.logger,
        commandLabel: '/impact-report',
        execute: () =>
          this.generateImpactReportUsecase.execute({
            subject,
            slackUserId: command.user_id,
          }),
        format: formatImpactReport,
      });
    });

    app.command('/review-pr', async ({ ack, command, respond }) => {
      const prRef = command.text?.trim() ?? '';
      if (prRef.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/review-pr <PR URL 또는 owner/repo#번호>` (예: `/review-pr https://github.com/foo/bar/pull/34`)',
        });
        return;
      }
      await ack({
        response_type: 'ephemeral',
        text: `이대리가 PR ${prRef} 를 리뷰하는 중입니다 (15~40초 소요)...`,
      });

      await runAgentCommand({
        respond,
        logger: this.logger,
        commandLabel: '/review-pr',
        execute: () =>
          this.reviewPullRequestUsecase.execute({
            prRef,
            slackUserId: command.user_id,
          }),
        format: (review) => formatPullRequestReview({ prRef, review }),
      });
    });

    // /search-runs <키워드> — 본인 SUCCEEDED AgentRun 의 output / inputSnapshot 키워드 검색.
    // LLM 호출 X (DB ILIKE) → runEphemeral 패턴 (즉시 ack + DB 조회 + replace_original).
    app.command('/search-runs', async ({ ack, command, respond }) => {
      const keyword = command.text?.trim() ?? '';
      if (keyword.length === 0) {
        await ack({
          response_type: 'ephemeral',
          text: '사용법: `/search-runs <키워드>` (예: `/search-runs 결제`). 본인 누적 AgentRun 의 output / 입력에서 키워드 매칭 — 최근순 최대 10건.',
        });
        return;
      }
      // 사용자 keyword 가 backtick / angle bracket 을 포함해도 Slack mrkdwn 구조가 깨지지 않게
      // 백틱은 시각적으로 동등한 ʼ 로 치환 (실제 mrkdwn 의 ` 와 충돌 회피).
      const safeKeywordForAck = keyword.replace(/`/g, 'ʼ');
      await ack({
        response_type: 'ephemeral',
        text: `이대리가 \`${safeKeywordForAck}\` 키워드로 본인 누적 run 을 검색합니다...`,
      });

      await runEphemeral({
        respond,
        logger: this.logger,
        commandLabel: '/search-runs',
        task: () =>
          this.searchAgentRunsUsecase.execute({
            slackUserId: command.user_id,
            keyword,
          }),
        format: formatSearchRuns,
      });
    });
  }
}
