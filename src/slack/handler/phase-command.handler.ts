import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { GenerateCeoMetaUsecase } from '../../agent/ceo/application/generate-ceo-meta.usecase';
import { GenerateAssignmentUsecase } from '../../agent/cto/application/generate-assignment.usecase';
import { GeneratePoEvaluationUsecase } from '../../agent/po-eval/application/generate-po-evaluation.usecase';
import { AgentRunRange } from '../../common/domain/agent-run-range.type';
import { formatAssignmentOutput } from '../format/assignment.formatter';
import { formatCeoMetaOutput } from '../format/ceo-meta.formatter';
import { formatEvaluationOutput } from '../format/po-evaluation.formatter';
import { runAgentCommand } from './slack-handler.helper';

// V3 phase loop 진입 명령군 — P2 Assign (CTO) / P4 Evaluate (PO_EVAL) / P5 Meta (CEO).
// 모두 직전 phase 의 SUCCEEDED run 을 참조해 합성하는 worker.
//
// agent-command.handler 가 비대해져 (488 LOC 시점) phase 진입군만 본 file 로 분리
// (V3 audit P2 의 "agent-command.handler 분할" 잔여 — refactor/agent-command-handler-split).
export interface PhaseCommandHandlerDeps {
  generateAssignmentUsecase: GenerateAssignmentUsecase;
  generatePoEvaluationUsecase: GeneratePoEvaluationUsecase;
  generateCeoMetaUsecase: GenerateCeoMetaUsecase;
  logger: Logger;
}

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
};
