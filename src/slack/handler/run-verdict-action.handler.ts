import { Inject, Injectable, Logger } from '@nestjs/common';
import { App } from '@slack/bolt';

import {
  AGENT_RUN_VERDICT_REPOSITORY_PORT,
  AgentRunVerdictRepositoryPort,
} from '../../agent-run/domain/port/agent-run-verdict.repository.port';
import {
  isRunVerdictFacet,
  RUN_VERDICT_SOURCE,
  RunVerdictFacet,
} from '../../agent-run/domain/run-verdict';
import {
  extractActionMessageRef,
  extractActionUserId,
  extractActionValue,
} from '../bolt/action-body.parser';
import { SlackHandler } from '../domain/port/slack-handler.port';
import {
  buildRunVerdictBlocks,
  parseRunVerdictValue,
  RUN_VERDICT_ACTION_PATTERN,
  RUN_VERDICT_FALLBACK_TEXT,
} from '../format/run-verdict-message.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// 실행별 판정 버튼(저녁 회고 스레드 댓글) 처리 — 누르면 저장하고 그 댓글을 "판정됨" 으로 다시 그린다.
// 설계: docs/superpowers/specs/2026-09-30-human-feedback-channel-design.md §3·§4.
//
// 실패는 조용히 넘기지 않는다 — 누른 사람은 저장됐다고 믿고 떠나므로, 저장이 안 됐으면 그 자리에서 알린다.
@Injectable()
export class RunVerdictActionHandler implements SlackHandler {
  private readonly logger = new Logger(RunVerdictActionHandler.name);

  constructor(
    @Inject(AGENT_RUN_VERDICT_REPOSITORY_PORT)
    private readonly verdictRepository: AgentRunVerdictRepositoryPort,
  ) {}

  register(app: App): void {
    app.action(
      RUN_VERDICT_ACTION_PATTERN,
      async ({ ack, body, respond, client }) => {
        await ack();
        const selection = parseRunVerdictValue(extractActionValue(body));
        const slackUserId = extractActionUserId(body);
        if (!selection || !slackUserId) {
          this.logger.warn(
            '판정 버튼 값 해석 실패 — 허용 목록 밖이거나 사용자 누락, 저장하지 않음.',
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '판정을 저장하지 못했습니다 — 버튼 값을 읽지 못했습니다.',
          });
          return;
        }
        const { agentRunId, facet, verdict, facets } = selection;

        try {
          await this.verdictRepository.record({
            agentRunId,
            facet,
            verdict,
            slackUserId,
            source: RUN_VERDICT_SOURCE.BUTTON,
          });
          this.logger.log(
            `실행 판정 저장 — agentRunId=${agentRunId} ${facet}=${verdict}`,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `실행 판정 저장 실패 — agentRunId=${agentRunId} ${facet}=${verdict}: ${message}`,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: `판정 저장 실패: ${toUserFacingErrorMessage(error)}`,
          });
          return;
        }

        // 저장은 끝났다. 다시 그리기가 실패해도 판정은 남아 있으므로 알리기만 한다.
        try {
          const rows = await this.verdictRepository.findByRun(agentRunId);
          const verdicts: Partial<
            Record<RunVerdictFacet, { slackUserId: string; verdict: string }[]>
          > = {};
          for (const row of rows) {
            if (isRunVerdictFacet(row.facet)) {
              (verdicts[row.facet] ??= []).push({
                slackUserId: row.slackUserId,
                verdict: row.verdict,
              });
            }
          }
          const messageRef = extractActionMessageRef(body);
          if (!messageRef) {
            throw new Error('댓글 좌표를 읽지 못했습니다');
          }
          await client.chat.update({
            channel: messageRef.channel,
            ts: messageRef.ts,
            text: RUN_VERDICT_FALLBACK_TEXT,
            blocks: buildRunVerdictBlocks({
              agentRunId,
              facets,
              verdicts,
            }) as never,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `판정 댓글 갱신 실패 (저장은 완료) — agentRunId=${agentRunId}: ${message}`,
          );
          await respond({
            response_type: 'ephemeral',
            replace_original: false,
            text: '판정은 저장했지만 댓글 표시를 갱신하지 못했습니다.',
          });
        }
      },
    );
  }
}
