import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { SaveReviewOutcomeUsecase } from '../../agent/code-reviewer/application/save-review-outcome.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { formatAssignmentOutput } from '../format/assignment.formatter';
import { formatCeoMetaOutput } from '../format/ceo-meta.formatter';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatEvaluationOutput } from '../format/po-evaluation.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { runAgentCommand } from './slack-handler.helper';

// AgentRunOutcome<T> 를 반환하는 모델 호출 명령군. 모두 동일 골격:
// (1) 인자 검증 → (2) 진행 안내 ack → (3) usecase 실행 → (4) format + footer 응답.
// runAgentCommand 가 (3)+(4)+에러 로깅을 캡슐화해 각 핸들러는 골격만 노출.
//
// BE 5종 ( /plan-task /be-schema /be-test /be-sre /be-fix ) 은 be.handler.ts 로 통합,
// /retry-run 은 retry-run.handler.ts, BE/PM 진단(/ping /quota /sync-context) 은 diagnosis.handler.ts 로 분리.
export const registerAgentCommandHandlers = (
  app: App,
  deps: {
    generateDailyPlanUsecase: GenerateDailyPlanUsecase;
    generateWorklogUsecase: GenerateWorklogUsecase;
    reviewPullRequestUsecase: ReviewPullRequestUsecase;
    saveReviewOutcomeUsecase: SaveReviewOutcomeUsecase;
    generateImpactReportUsecase: GenerateImpactReportUsecase;
    generatePoShadowUsecase: GeneratePoShadowUsecase;
    generateAssignmentUsecase: GenerateAssignmentUsecase;
    generatePoEvaluationUsecase: GeneratePoEvaluationUsecase;
    generateCeoMetaUsecase: GenerateCeoMetaUsecase;
    logger: Logger;
  },
): void => {
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
      logger: deps.logger,
      commandLabel: '/today',
      execute: () =>
        deps.generateDailyPlanUsecase.execute({
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
      logger: deps.logger,
      commandLabel: '/worklog',
      execute: () =>
        deps.generateWorklogUsecase.execute({
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
      logger: deps.logger,
      commandLabel: '/po-shadow',
      execute: () =>
        deps.generatePoShadowUsecase.execute({
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
      logger: deps.logger,
      commandLabel: '/impact-report',
      execute: () =>
        deps.generateImpactReportUsecase.execute({
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
      logger: deps.logger,
      commandLabel: '/review-pr',
      execute: () =>
        deps.reviewPullRequestUsecase.execute({
          prRef,
          slackUserId: command.user_id,
        }),
      format: (review) => formatPullRequestReview({ prRef, review }),
    });
  });

  app.command('/assign', async ({ ack, command, respond }) => {
    // 인자 미사용 — 직전 PM run 자동 조회. 명시 PM run id 지정은 본 step 미지원 (warn fallback).
    await ack({
      response_type: 'ephemeral',
      text: '이대리 (CTO 모드) 가 직전 plan 의 task 를 BE worker 에 분배 중입니다 (10~30초 소요)...',
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/assign',
      execute: () =>
        deps.generateAssignmentUsecase.execute({
          slackUserId: command.user_id,
        }),
      format: formatAssignmentOutput,
    });
  });

  app.command('/po-eval', async ({ ack, command, respond }) => {
    // 인자: 'today' | 'week' (default: week). 다른 값이면 week 로 fallback.
    const arg = command.text?.trim().toLowerCase() ?? '';
    const range: AgentRunRange = arg === 'today' ? 'TODAY' : 'WEEK';
    await ack({
      response_type: 'ephemeral',
      text: `이대리(PO 통합) 가 ${range === 'WEEK' ? '최근 7일' : '최근 24시간'} sub-agent 결과를 합성 중입니다 (15~30초 소요)...`,
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/po-eval',
      execute: () =>
        deps.generatePoEvaluationUsecase.execute({
          slackUserId: command.user_id,
          range,
        }),
      format: formatEvaluationOutput,
    });
  });

  app.command('/ceo-review', async ({ ack, command, respond }) => {
    // 인자: 'today' | 'week' (default: week). 다른 값이면 week 로 fallback.
    const arg = command.text?.trim().toLowerCase() ?? '';
    const range: AgentRunRange = arg === 'today' ? 'TODAY' : 'WEEK';
    await ack({
      response_type: 'ephemeral',
      text: `이대리(CEO 메타) 가 ${range === 'WEEK' ? '최근 7일' : '최근 24시간'} phase 결과를 종합 중입니다 (15~30초 소요)...`,
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/ceo-review',
      execute: () =>
        deps.generateCeoMetaUsecase.execute({
          slackUserId: command.user_id,
          range,
        }),
      format: formatCeoMetaOutput,
    });
  });

  app.command('/review-feedback', async ({ ack, command, respond }) => {
    const parts = (command.text ?? '').trim().split(/\s+/);
    const runId = Number(parts[0]);
    const verdict = (parts[1] ?? '').toLowerCase();

    if (
      !parts[0] ||
      !Number.isInteger(runId) ||
      runId <= 0 ||
      !['accept', 'reject'].includes(verdict)
    ) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/review-feedback <AgentRun ID> accept|reject [이유]`\n예: `/review-feedback 42 reject 너무 사소한 스타일 지적`',
      });
      return;
    }
    await ack({ response_type: 'ephemeral', text: '피드백 저장 중...' });

    const accepted = verdict === 'accept';
    const comment = parts.slice(2).join(' ') || undefined;
    try {
      await deps.saveReviewOutcomeUsecase.execute({
        agentRunId: runId,
        slackUserId: command.user_id,
        accepted,
        comment,
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${runId} 피드백 저장 완료 (${accepted ? '✅ accept' : '❌ reject'}${comment ? ` — ${comment}` : ''})`,
      });
    } catch (error: unknown) {
      deps.logger.error(
        `/review-feedback 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `피드백 저장 실패: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  });
};
