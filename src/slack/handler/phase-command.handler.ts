import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { PoEvalCareerlogPayload } from '../../agent/po-eval/infrastructure/po-eval-careerlog.applier';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { CreatePreviewUsecase } from '../../preview-gate/application/create-preview.usecase';
import { PREVIEW_KIND } from '../../preview-gate/domain/preview-action.type';
import { formatAssignmentOutput } from '../format/assignment.formatter';
import { formatCeoMetaOutput } from '../format/ceo-meta.formatter';
import { formatModelFooter } from '../format/model-footer.formatter';
import { formatEvaluationOutput } from '../format/po-evaluation.formatter';
import { buildPreviewBlocks } from '../format/preview-message.builder';
import {
  runAgentCommand,
  toUserFacingErrorMessage,
} from './slack-handler.helper';

// V3 phase loop 진입 명령군 — P2 Assign (CTO) / P4 Evaluate (PO_EVAL) / P5 Meta (CEO).
// 모두 직전 phase 의 SUCCEEDED run 을 참조해 합성하는 worker.
//
// agent-command.handler 가 비대해져 (488 LOC 시점) phase 진입군만 본 file 로 분리
// (V3 audit P2 의 "agent-command.handler 분할" 잔여 — refactor/agent-command-handler-split).
export interface PhaseCommandHandlerDeps {
  generateAssignmentUsecase: GenerateAssignmentUsecase;
  generatePoEvaluationUsecase: GeneratePoEvaluationUsecase;
  generateCeoMetaUsecase: GenerateCeoMetaUsecase;
  // V3 §P4 careerLog Notion 적재 — /po-eval 결과에 "📝 Notion 적재" 버튼 부착.
  // CreatePreviewUsecase 는 PreviewGate 의 PreviewAction 을 PENDING 으로 생성.
  // careerLogNotionPageId 가 undefined 면 버튼 X (기존 텍스트만).
  createPreviewUsecase: CreatePreviewUsecase;
  careerLogNotionPageId?: string;
  logger: Logger;
}

// careerLog preview 의 TTL — 사용자가 30분 안 결정 권장. expired 시 ApplyPreviewUsecase 가 거절.
const CAREERLOG_PREVIEW_TTL_MS = 30 * 60 * 1000;

export const registerPhaseCommandHandlers = (
  app: App,
  deps: PhaseCommandHandlerDeps,
): void => {
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

    // careerLogNotionPageId 미설정 시 기존 텍스트-only 경로 (runAgentCommand) 그대로.
    if (deps.careerLogNotionPageId === undefined) {
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
      return;
    }

    // careerLog Notion 적재 옵션 활성 — 결과 텍스트 + ✅ 적용 / ❌ 취소 버튼 부착.
    // 사용자가 ✅ 누르면 preview-action.handler → PoEvalCareerlogApplier 가 Notion 페이지 append.
    try {
      const outcome = await deps.generatePoEvaluationUsecase.execute({
        slackUserId: command.user_id,
        range,
      });
      const text =
        formatEvaluationOutput(outcome.result) + formatModelFooter(outcome);
      const payload: PoEvalCareerlogPayload = {
        notionPageId: deps.careerLogNotionPageId,
        period: outcome.result.careerLog.period,
        careerLog: outcome.result.careerLog,
      };
      const preview = await deps.createPreviewUsecase.execute({
        slackUserId: command.user_id,
        kind: PREVIEW_KIND.PO_EVAL_CAREERLOG,
        payload,
        previewText: text,
        responseUrl: null,
        ttlMs: CAREERLOG_PREVIEW_TTL_MS,
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text,
        blocks: buildPreviewBlocks({
          previewText: `${text}\n\n_📝 위 careerLog 를 Notion 페이지에 적재하시려면 ✅ 적용 (30분 안)._`,
          previewId: preview.id,
        }) as never,
      });
    } catch (error: unknown) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      deps.logger.error(
        `/po-eval 실패: ${rawMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      await respond({
        response_type: 'ephemeral',
        replace_original: true,
        text: `이대리 /po-eval 실패: ${toUserFacingErrorMessage(error)}`,
      });
    }
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
};
