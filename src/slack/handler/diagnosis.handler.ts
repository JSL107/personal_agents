import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { SyncContextUsecase } from '../../agent/pm/application/sync-context.usecase';
import { GetQuotaStatsUsecase } from '../../agent-run/application/get-quota-stats.usecase';
import { formatContextSummary } from '../format/context-summary.formatter';
import { formatQuotaStats } from '../format/quota-stats.formatter';
import { runEphemeral } from './slack-handler.helper';

// 진단 / 관측용 슬래시 명령 — 모델 호출 없이 DB 조회 또는 외부 API 점검만 수행.
// /ping (즉시 ack), /sync-context (HOTFIX-1), /quota (OPS-1).
export const registerDiagnosisHandlers = (
  app: App,
  deps: {
    syncContextUsecase: SyncContextUsecase;
    getQuotaStatsUsecase: GetQuotaStatsUsecase;
    logger: Logger;
  },
): void => {
  // 봇 health check — 모델/DB 호출 없이 1초 안에 ack 응답.
  // Slack Bolt Socket Mode 가 살아있고 manifest 가 워크스페이스에 등록돼 있는지 확인 가능.
  app.command('/ping', async ({ ack }) => {
    await ack({
      response_type: 'ephemeral',
      text: 'pong 🏓 — 이대리 봇 정상 동작 중',
    });
  });

  // /sync-context — PM /today 가 보는 5종 컨텍스트 (GitHub/Notion/Slack/직전 plan/직전 worklog)
  // 를 모델 호출 없이 한 번 더 점검. AgentRun 도 만들지 않고 푸터도 없다.
  app.command('/sync-context', async ({ ack, command, respond }) => {
    await ack({
      response_type: 'ephemeral',
      text: '이대리가 외부 컨텍스트를 재수집 중입니다 (5~15초 소요)...',
    });
    await runEphemeral({
      respond,
      logger: deps.logger,
      commandLabel: '/sync-context',
      task: () =>
        deps.syncContextUsecase.execute({ slackUserId: command.user_id }),
      format: formatContextSummary,
    });
  });

  // /quota [today|week] — 사용자 자신의 agent_run 사용량 통계.
  // 인자 없으면 today 기본. 모델 호출 없이 DB groupBy 만 — 즉시 응답.
  app.command('/quota', async ({ ack, command, respond }) => {
    const arg = command.text?.trim().toLowerCase() ?? '';
    const range: 'TODAY' | 'WEEK' = arg === 'week' ? 'WEEK' : 'TODAY';

    // TODAY range 는 자정 기준이 아니라 rolling 24h 임을 라벨로 명시 — 사용자 오해 방지 (V3 audit B3 P9).
    await ack({
      response_type: 'ephemeral',
      text: `이대리가 ${range === 'WEEK' ? '최근 7일' : '최근 24시간 (rolling)'} 사용량을 집계 중입니다...`,
    });

    await runEphemeral({
      respond,
      logger: deps.logger,
      commandLabel: '/quota',
      task: () =>
        deps.getQuotaStatsUsecase.execute({
          slackUserId: command.user_id,
          range,
        }),
      format: formatQuotaStats,
    });
  });
};
