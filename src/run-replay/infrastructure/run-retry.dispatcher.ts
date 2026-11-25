import { Inject, Injectable } from '@nestjs/common';
import { match } from 'ts-pattern';

import {
  JOB_APPLICATION_REPOSITORY_PORT,
  JobApplicationRepositoryPort,
} from '../../agent/job-application/domain/port/job-application.repository.port';
import { statusLabel } from '../../agent/job-application/infrastructure/job-application.formatter';
import { ListUsageUsecase } from '../../agent/vacation/application/list-usage.usecase';
import {
  PlainDate,
  plainDateToIso,
} from '../../agent/vacation/domain/plain-date';
import {
  AGENT_RUN_REPOSITORY_PORT,
  AgentRunRepositoryPort,
} from '../../agent-run/domain/port/agent-run.repository.port';
import { AgentType } from '../../model-router/domain/model-router.type';
import { CountPreviewsByPayloadUsecase } from '../../preview-gate/application/count-previews-by-payload.usecase';
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import {
  PREVIEW_KIND,
  PREVIEW_STATUS,
} from '../../preview-gate/domain/preview-action.type';
import { DispatchInput } from '../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../router/domain/port/agent-dispatcher.port';
import { plainDateToUtcDate } from '../../schedule/domain/parse-due-date';
import { escapeSlackMrkdwn } from '../../slack/format/mrkdwn.util';
import { ReplayReplyRunner } from '../../slack/format/replay-reply.runner';
import { toKoreanDate } from '../../slack/format/schedule.formatter';
import { ReplayFailedRunUsecase } from '../application/replay-failed-run.usecase';
import {
  classifyRetryTarget,
  HeldWriteTarget,
  isHeldWriteTarget,
} from '../domain/retry-target';
import { parseRunRetryRequest } from '../domain/run-retry-request';

interface HeldWriteCardContent {
  payload: Record<string, unknown>;
  lines: string[];
  question: string;
}

@Injectable()
export class RunRetryDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.RUN_RETRY;

  constructor(
    @Inject(AGENT_RUN_REPOSITORY_PORT)
    private readonly repository: AgentRunRepositoryPort,
    private readonly replay: ReplayFailedRunUsecase,
    private readonly runner: ReplayReplyRunner,
    private readonly createPreview: CreatePreviewUsecase,
    private readonly countPreviews: CountPreviewsByPayloadUsecase,
    private readonly listUsage: ListUsageUsecase,
    @Inject(JOB_APPLICATION_REPOSITORY_PORT)
    private readonly applications: JobApplicationRepositoryPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const runId = parseRunRetryRequest(input.text ?? '');
    if (runId === null) {
      return this.reply(
        "다시 돌릴 실행 번호를 '실행번호 1234 다시 해줘'처럼 알려 주세요.",
      );
    }
    const run = await this.repository.findById(runId);
    if (!run) {
      return this.reply(`실행 #${runId} 을 찾지 못했어요.`);
    }
    const snapshot = run.inputSnapshot;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      !('slackUserId' in snapshot) ||
      typeof snapshot.slackUserId !== 'string' ||
      snapshot.slackUserId !== input.slackUserId
    ) {
      return this.reply('본인 실행만 다시 돌릴 수 있어요.');
    }
    const target = classifyRetryTarget(run);
    if (target.kind === 'FAILED') {
      const prepared = await this.replay.prepare({
        runId,
        requesterSlackUserId: input.slackUserId,
      });
      if (prepared.kind === 'REJECTED') {
        return this.reply(prepared.message);
      }
      const result = await this.runner.run(prepared);
      return {
        agentRunId: result.agentRunId,
        output: result,
        modelUsed: 'deterministic',
        formattedText: result.text,
        ...(result.preview
          ? { preview: { ...result.preview, content: result.followupText } }
          : {}),
      };
    }
    if (target.kind === 'HELD_SCHEDULE') {
      // 이미 승인된 카드가 있으면 새 카드를 만들지 않는다. 대기 중 카드는 보지 않는다 — 만료됐거나
      // Slack 전송에 실패한 카드도 스위퍼가 돌기 전까지 PENDING 으로 남아 새 카드를 막는다. 카드 두
      // 장을 차례로 눌러도 두 번째는 applier 의 같은 제목·날짜 검사에서 걸린다.
      const handled = await this.findHandledCard(runId);
      if (handled !== null) {
        return this.reply(handled);
      }
      const title = escapeSlackMrkdwn(target.title);
      const date = toKoreanDate(plainDateToUtcDate(target.dueDate));
      const text = `*다시 실행* — 실행 #${runId} 에서 질문으로 보고 멈춘 일정 등록이에요.\n• 제목: ${title}\n• 날짜: ${date}\n등록할까요?`;
      const preview = await this.createPreview.execute({
        slackUserId: input.slackUserId,
        kind: PREVIEW_KIND.HELD_SCHEDULE_REGISTER,
        payload: {
          sourceRunId: runId,
          title: target.title,
          dueDate: target.dueDate,
        },
        previewText: text,
        ttlMs: 30 * 60 * 1000,
      });
      return { ...this.reply(text), preview: { id: preview.id, text } };
    }
    if (isHeldWriteTarget(target)) {
      return this.createHeldWriteCard({
        target,
        runId,
        slackUserId: input.slackUserId,
      });
    }
    if (target.kind === 'HELD_UNAVAILABLE') {
      return this.reply(
        "이 실행은 질문으로 보고 멈췄지만 다시 실행할 내용이 저장돼 있지 않아요. 원래 문장을 '…해줘' 처럼 다시 말해 주세요.",
      );
    }
    const status: Record<string, string> = {
      SUCCEEDED: '성공',
      FAILED: '실패',
      IN_PROGRESS: '진행 중',
    };
    return this.reply(
      `실패했거나 질문으로 멈춘 실행만 다시 돌릴 수 있어요. 실행 #${runId} 은 ${status[run.status] ?? run.status} 상태예요.`,
    );
  }

  private async createHeldWriteCard({
    target,
    runId,
    slackUserId,
  }: {
    target: HeldWriteTarget;
    runId: number;
    slackUserId: string;
  }): Promise<DispatchOutcome> {
    const vacation =
      target.kind === 'HELD_VACATION_REGISTER' ||
      target.kind === 'HELD_VACATION_CANCEL';
    const kind = vacation
      ? PREVIEW_KIND.HELD_VACATION_WRITE
      : PREVIEW_KIND.HELD_JOB_APPLICATION_WRITE;
    const applied = await this.countPreviews.execute({
      kind,
      payloadPath: ['sourceRunId'],
      payloadValue: runId,
      status: PREVIEW_STATUS.APPLIED,
    });
    if (applied > 0) {
      // 승인됐어도 실제로 쓰지 않았을 수 있다(지원 상태가 카드 뒤에 바뀜, 이미 있는 기록) — 처리됐다고만 말한다.
      return this.reply(
        `실행 #${runId} 의 확인 카드는 이미 처리됐어요. 다시 하려면 원래 문장을 '…해줘' 처럼 말해 주세요.`,
      );
    }
    const content: HeldWriteCardContent | string = await match(target)
      .with({ kind: 'HELD_VACATION_REGISTER' }, (registerTarget) => {
        const lines = [
          `• 기간: ${this.dateRange({ startDate: registerTarget.startDate, endDate: registerTarget.endDate })}`,
          `• 반차: ${registerTarget.fraction === 0.5 ? '예' : '아니요'}`,
        ];
        if (registerTarget.memo) {
          lines.push(`• 메모: ${escapeSlackMrkdwn(registerTarget.memo)}`);
        }
        return {
          payload: {
            sourceRunId: runId,
            action: 'REGISTER',
            startDate: registerTarget.startDate,
            endDate: registerTarget.endDate,
            ...(registerTarget.memo !== undefined
              ? { memo: registerTarget.memo }
              : {}),
            ...(registerTarget.fraction !== undefined
              ? { fraction: registerTarget.fraction }
              : {}),
          },
          lines,
          question: '등록할까요?',
        };
      })
      .with({ kind: 'HELD_VACATION_CANCEL' }, async (cancelTarget) => {
        const usages = await this.listUsage.execute({ slackUserId });
        const usage = usages.find(
          (record) => record.id === cancelTarget.usageId,
        );
        if (!usage) {
          return `취소할 휴가(#${cancelTarget.usageId})를 찾지 못했어요 — 이미 취소됐거나 다른 기록이에요.`;
        }
        const lines = [
          `• 기간: ${this.dateRange({ startDate: usage.startDate, endDate: usage.endDate })}`,
        ];
        if (usage.memo) {
          lines.push(`• 메모: ${escapeSlackMrkdwn(usage.memo)}`);
        }
        return {
          payload: {
            sourceRunId: runId,
            action: 'CANCEL',
            usageId: cancelTarget.usageId,
          },
          lines,
          question: '취소할까요?',
        };
      })
      .with({ kind: 'HELD_JOB_ADD' }, (addTarget) => {
        const lines = [
          `• 회사: ${escapeSlackMrkdwn(addTarget.company)}`,
          `• 직무: ${escapeSlackMrkdwn(addTarget.role)}`,
          `• 상태: ${statusLabel(addTarget.status ?? 'APPLIED')}`,
          `• 지원일: ${plainDateToIso(addTarget.appliedAt)}`,
        ];
        if (addTarget.deadline) {
          lines.push(`• 마감: ${plainDateToIso(addTarget.deadline)}`);
        }
        if (addTarget.jdUrl) {
          lines.push(`• 공고 링크: ${escapeSlackMrkdwn(addTarget.jdUrl)}`);
        }
        return {
          payload: {
            sourceRunId: runId,
            action: 'ADD',
            company: addTarget.company,
            role: addTarget.role,
            status: addTarget.status ?? 'APPLIED',
            appliedAt: addTarget.appliedAt,
            ...(addTarget.jdUrl !== undefined
              ? { jdUrl: addTarget.jdUrl }
              : {}),
            ...(addTarget.deadline !== undefined
              ? { deadline: addTarget.deadline }
              : {}),
          },
          lines,
          question: '등록할까요?',
        };
      })
      .with({ kind: 'HELD_JOB_UPDATE_STATUS' }, async (updateTarget) => {
        const application = await this.applications.findActiveByCompanyRef({
          slackUserId,
          companyRef: updateTarget.ref,
        });
        if (!application) {
          return '해당하는 진행 중 지원 건을 찾지 못했어요.';
        }
        return {
          payload: {
            sourceRunId: runId,
            action: 'UPDATE_STATUS',
            applicationId: application.id,
            expectedStatus: application.status,
            status: updateTarget.status,
          },
          lines: [
            `• 회사: ${escapeSlackMrkdwn(application.company)}`,
            `• 직무: ${escapeSlackMrkdwn(application.role)}`,
            `• 상태: ${statusLabel(application.status)} → ${statusLabel(updateTarget.status)}`,
          ],
          question: '변경할까요?',
        };
      })
      .exhaustive();
    if (typeof content === 'string') {
      return this.reply(content);
    }
    const text = [
      `*다시 실행* — 실행 #${runId} 에서 질문으로 보고 멈춘 내용이에요.`,
      ...content.lines,
      content.question,
    ].join('\n');
    const preview = await this.createPreview.execute({
      slackUserId,
      kind,
      payload: content.payload,
      previewText: text,
      ttlMs: 30 * 60 * 1000,
    });
    return { ...this.reply(text), preview: { id: preview.id, text } };
  }

  private dateRange({
    startDate,
    endDate,
  }: {
    startDate: PlainDate;
    endDate: PlainDate;
  }): string {
    const start = plainDateToIso(startDate);
    const end = plainDateToIso(endDate);
    if (start === end) {
      return start;
    }
    return `${start} ~ ${end}`;
  }

  private async findHandledCard(runId: number): Promise<string | null> {
    const applied = await this.countPreviews.execute({
      kind: PREVIEW_KIND.HELD_SCHEDULE_REGISTER,
      payloadPath: ['sourceRunId'],
      payloadValue: runId,
      status: PREVIEW_STATUS.APPLIED,
    });
    if (applied === 0) {
      return null;
    }
    return `실행 #${runId} 의 일정은 이미 다시 실행해 등록했어요.`;
  }

  private reply(formattedText: string): DispatchOutcome {
    return {
      agentRunId: 0,
      output: null,
      modelUsed: 'deterministic',
      formattedText,
    };
  }
}
