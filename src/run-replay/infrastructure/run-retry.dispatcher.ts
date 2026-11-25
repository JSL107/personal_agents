import { Inject, Injectable } from '@nestjs/common';

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
import { classifyRetryTarget } from '../domain/retry-target';
import { parseRunRetryRequest } from '../domain/run-retry-request';

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
