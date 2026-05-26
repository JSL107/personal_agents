import { Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import { IdaeriRouterPort } from '../../router/domain/idaeri-router.port';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// V3 비전 봇 쪼개기 step 5 — 자연어 진입 surface.
// Slack 에서 bot 이 멘션된 (`<@BOT_ID> ...`) 메시지를 받아 IdaeriRouterPort.dispatch 로 위임.
// 슬래시 명령은 기존 핸들러가 그대로 처리 — 본 핸들러는 자연어 진입점만 담당.
//
// 한계 (본 step):
// - DM 진입 X — 본 step 은 app_mention 만. DM 도 받으려면 별도 분기 필요.
// - 결과 출력은 minimal (workerType + agentRunId) — 각 worker 의 user-facing formatter 통합은
//   별도 step (followUp / 결과 풍부 표시).
// - handoff chain 처리 X — followUp 응답은 무시. step 6 plan 에서 manager 가 cycle/depth 검증 후 재 dispatch.
export const registerRouterMessageHandler = (
  app: App,
  deps: {
    idaeriRouter: IdaeriRouterPort;
    logger: Logger;
  },
): void => {
  app.event('app_mention', async ({ event, say }) => {
    const rawText =
      'text' in event && typeof event.text === 'string' ? event.text : '';
    const cleanText = stripMentionPrefix(rawText);
    const slackUserId =
      'user' in event && typeof event.user === 'string'
        ? event.user
        : 'unknown';
    const threadTs =
      'thread_ts' in event && typeof event.thread_ts === 'string'
        ? event.thread_ts
        : event.ts;

    if (cleanText.length === 0) {
      await say({
        thread_ts: threadTs,
        text: '메시지가 비어 있습니다. 어떤 작업이 필요한지 자연어로 적어주세요.',
      });
      return;
    }

    try {
      const result = await deps.idaeriRouter.dispatch({
        source: 'SLACK_MESSAGE',
        slackUserId,
        text: cleanText,
      });
      await say({
        thread_ts: threadTs,
        text: `이대리 (${result.workerType}) 처리 완료 — agentRunId=${result.agentRunId}.\n자세한 결과는 해당 슬래시 명령으로 다시 호출해 검토해주세요.`,
      });
    } catch (error: unknown) {
      deps.logger.warn(
        `Router dispatch 실패 — user=${slackUserId} text="${cleanText.slice(0, 60)}": ${error instanceof Error ? error.message : String(error)}`,
      );
      await say({
        thread_ts: threadTs,
        text: `이대리 처리 실패: ${toUserFacingErrorMessage(error)}`,
      });
    }
  });
};

// Slack 멘션 prefix `<@U....>` 를 모두 제거 + 앞뒤 공백 trim.
// (사용자가 "<@BOT> 안녕" 형태로 보낸 경우 "안녕" 만 추출.)
const stripMentionPrefix = (text: string): string =>
  text.replace(/<@[A-Z0-9]+>\s*/g, '').trim();
