import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateBackendPlanUsecase } from '../../agent/be/application/generate-backend-plan.usecase';
import { ReviewPullRequestUsecase } from '../../agent/code-reviewer/application/review-pull-request.usecase';
import { SaveReviewOutcomeUsecase } from '../../agent/code-reviewer/application/save-review-outcome.usecase';
import { GenerateImpactReportUsecase } from '../../agent/impact-reporter/application/generate-impact-report.usecase';
import { GenerateDailyPlanUsecase } from '../../agent/pm/application/generate-daily-plan.usecase';
import { GeneratePoOutlineUsecase } from '../../agent/po-expand/application/generate-po-outline.usecase';
import { GeneratePoShadowUsecase } from '../../agent/po-shadow/application/generate-po-shadow.usecase';
import { GenerateWorklogUsecase } from '../../agent/work-reviewer/application/generate-worklog.usecase';
import { RetryRunUsecase } from '../../agent-run/application/retry-run.usecase';
import { TriggerType } from '../../agent-run/domain/agent-run.type';
import { formatBackendPlan } from '../format/backend-plan.formatter';
import { formatDailyPlan } from '../format/daily-plan.formatter';
import { formatDailyReview } from '../format/daily-review.formatter';
import { formatImpactReport } from '../format/impact-report.formatter';
import { formatPoShadowReport } from '../format/po-shadow.formatter';
import { formatPullRequestReview } from '../format/pull-request-review.formatter';
import { runAgentCommand } from './slack-handler.helper';

// AgentRunOutcome<T> 를 반환하는 모델 호출 명령군. 모두 동일 골격:
// (1) 인자 검증 → (2) 진행 안내 ack → (3) usecase 실행 → (4) format + footer 응답.
// runAgentCommand 가 (3)+(4)+에러 로깅을 캡슐화해 각 핸들러는 골격만 노출.
export const registerAgentCommandHandlers = (
  app: App,
  deps: {
    generateDailyPlanUsecase: GenerateDailyPlanUsecase;
    generateWorklogUsecase: GenerateWorklogUsecase;
    reviewPullRequestUsecase: ReviewPullRequestUsecase;
    saveReviewOutcomeUsecase: SaveReviewOutcomeUsecase;
    generateImpactReportUsecase: GenerateImpactReportUsecase;
    generatePoShadowUsecase: GeneratePoShadowUsecase;
    generatePoOutlineUsecase: GeneratePoOutlineUsecase;
    generateBackendPlanUsecase: GenerateBackendPlanUsecase;
    retryRunUsecase: RetryRunUsecase;
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
      format: (result) => formatDailyPlan(result.plan, result.sources),
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

  app.command('/plan-task', async ({ ack, command, respond }) => {
    const subject = command.text?.trim() ?? '';
    if (subject.length === 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/plan-task <PR URL / 작업 설명>` (예: `/plan-task 결제 검증 API 추가` 또는 `/plan-task foo/bar#34`)',
      });
      return;
    }
    await ack({
      response_type: 'ephemeral',
      text: '이대리(BE 모드) 가 구현 계획을 세우는 중입니다 (15~40초 소요)...',
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/plan-task',
      execute: () =>
        deps.generateBackendPlanUsecase.execute({
          subject,
          slackUserId: command.user_id,
        }),
      format: formatBackendPlan,
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

  app.command('/retry-run', async ({ ack, command, respond }) => {
    const idText = command.text?.trim() ?? '';
    const id = Number(idText);
    if (!idText || !Number.isInteger(id) || id <= 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/retry-run <id>` (예: `/retry-run 42`)',
      });
      return;
    }
    await ack({
      response_type: 'ephemeral',
      text: `이대리가 run #${id} 를 재실행하는 중입니다...`,
    });

    const payload = await deps.retryRunUsecase.execute({ id });
    if (!payload) {
      await respond({
        response_type: 'ephemeral',
        text: `run #${id} 를 찾을 수 없거나 FAILED 상태가 아닙니다.`,
      });
      return;
    }

    const snapshot = payload.inputSnapshot as Record<string, unknown> | null;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${id} 의 inputSnapshot 형식이 올바르지 않아 재실행할 수 없습니다.`,
      });
      return;
    }
    const originalUserId = snapshot.slackUserId as string | undefined;
    if (originalUserId && originalUserId !== command.user_id) {
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `AgentRun #${id} 는 다른 사용자의 실행 기록이라 재실행할 수 없습니다.`,
      });
      return;
    }
    const slackUserId = originalUserId ?? command.user_id;

    switch (payload.agentType) {
      case 'PM':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(PM)',
          execute: () =>
            deps.generateDailyPlanUsecase.execute({
              tasksText: (snapshot.tasksText as string | undefined) ?? '',
              slackUserId,
              triggerType: TriggerType.FAILURE_REPLAY,
            }),
          format: (result) => formatDailyPlan(result.plan, result.sources),
        });
        break;
      case 'WORK_REVIEWER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(WORK_REVIEWER)',
          execute: () =>
            deps.generateWorklogUsecase.execute({
              workText: (snapshot.workText as string | undefined) ?? '',
              slackUserId,
            }),
          format: formatDailyReview,
        });
        break;
      case 'CODE_REVIEWER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(CODE_REVIEWER)',
          execute: () =>
            deps.reviewPullRequestUsecase.execute({
              prRef: (snapshot.prRef as string | undefined) ?? '',
              slackUserId,
            }),
          format: (review) =>
            formatPullRequestReview({
              prRef: (snapshot.prRef as string | undefined) ?? '',
              review,
            }),
        });
        break;
      case 'IMPACT_REPORTER':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: '/retry-run(IMPACT_REPORTER)',
          execute: () =>
            deps.generateImpactReportUsecase.execute({
              subject: (snapshot.subject as string | undefined) ?? '',
              slackUserId,
            }),
          format: formatImpactReport,
        });
        break;
      case 'BE':
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (BE)`,
          execute: () =>
            deps.generateBackendPlanUsecase.execute({
              subject: (snapshot.subject as string) ?? '',
              slackUserId,
            }),
          format: formatBackendPlan,
        });
        break;
      case 'PO_SHADOW': {
        const origLen =
          (snapshot.extraContextLength as number | undefined) ?? 0;
        if (origLen > 0) {
          await respond({
            response_type: 'ephemeral',
            replace_original: true,
            text: `AgentRun #${id} (PO_SHADOW) 는 추가 컨텍스트가 포함된 요청이라 정확히 재현할 수 없어 재실행을 지원하지 않습니다.`,
          });
          return;
        }
        await runAgentCommand({
          respond,
          logger: deps.logger,
          commandLabel: `/retry-run#${id} (PO_SHADOW)`,
          execute: () =>
            deps.generatePoShadowUsecase.execute({
              extraContext: '',
              slackUserId,
            }),
          format: formatPoShadowReport,
        });
        break;
      }
      default:
        await respond({
          response_type: 'ephemeral',
          text: `agentType '${payload.agentType}' 는 retry-run 이 지원되지 않습니다.`,
        });
    }
  });

  app.command('/po-expand', async ({ ack, command, respond }) => {
    const subject = command.text?.trim() ?? '';
    if (subject.length === 0) {
      await ack({
        response_type: 'ephemeral',
        text: '사용법: `/po-expand <아이디어 한 줄>` (예: `/po-expand 결제 실패 자동 재시도`)',
      });
      return;
    }
    await ack({
      response_type: 'ephemeral',
      text: '이대리(PO 모드) 가 개요를 작성 중입니다 (5~15초 소요)...',
    });

    await runAgentCommand({
      respond,
      logger: deps.logger,
      commandLabel: '/po-expand',
      execute: () =>
        deps.generatePoOutlineUsecase.execute({
          subject,
          slackUserId: command.user_id,
        }),
      format: (outline) => {
        const lines: string[] = [
          `*📋 ${outline.subject} — 개요*`,
          '',
          outline.outline.map((l) => `• ${l}`).join('\n'),
        ];
        if (outline.clarifyingQuestions.length > 0) {
          lines.push('', '*명확화 질문:*');
          outline.clarifyingQuestions.forEach((q) => lines.push(`• ${q}`));
        }
        return lines.join('\n');
      },
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
