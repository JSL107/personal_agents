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
  buildRunVerdictFallbackText,
  parseRunVerdictValue,
  readRunVerdictQuote,
  RUN_VERDICT_ACTION_PATTERN,
} from '../format/run-verdict-message.builder';
import { toUserFacingErrorMessage } from './slack-handler.helper';

// 실행별 판정 버튼(저녁 회고·PO 대행·아침 계획 스레드 댓글) 처리 — 누르면 저장하고 그 댓글을 "판정됨" 으로 다시 그린다.
// 설계: docs/superpowers/specs/2026-09-30-human-feedback-channel-design.md §3·§4.
//
// 실패는 조용히 넘기지 않는다 — 누른 사람은 저장됐다고 믿고 떠나므로, 저장이 안 됐으면 그 자리에서 알린다.
@Injectable()
export class RunVerdictActionHandler implements SlackHandler {
  private readonly logger = new Logger(RunVerdictActionHandler.name);
  // 실행별 "조회 → 댓글 갱신" 줄. 둘을 겹쳐 돌리면 먼저 읽은 오래된 목록이 나중에 도착해
  // 댓글을 덮어쓴다 — 원장은 맞는데 화면에서 다른 사람 판정이 사라진다. 줄을 세우면 뒤 차례는
  // 앞 차례의 저장이 끝난 뒤에 읽으므로 마지막 갱신이 항상 최신이다.
  // ponytail: 프로세스 안 직렬화라 앱을 여러 개 띄우면 다시 겹칠 수 있다 — 그때는 메시지 단위 버전 검사로.
  private readonly redrawChains = new Map<number, Promise<void>>();

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
          await this.serializeByRun(agentRunId, async () => {
            const rows = await this.verdictRepository.findByRun(agentRunId);
            const verdicts: Partial<
              Record<
                RunVerdictFacet,
                { slackUserId: string; verdict: string }[]
              >
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
              text: buildRunVerdictFallbackText(facets),
              blocks: buildRunVerdictBlocks({
                agentRunId,
                facets,
                verdicts,
                quoteMrkdwn: readRunVerdictQuote(body),
              }) as never,
            });
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

  private serializeByRun(
    agentRunId: number,
    task: () => Promise<void>,
  ): Promise<void> {
    const previous = this.redrawChains.get(agentRunId) ?? Promise.resolve();
    const current = previous.then(task);
    // 앞 차례가 실패해도 뒤 차례는 돌아야 한다 — 줄에는 실패를 삼킨 꼬리만 남긴다.
    const tail = current.catch(() => undefined);
    this.redrawChains.set(agentRunId, tail);
    void tail.then(() => {
      if (this.redrawChains.get(agentRunId) === tail) {
        this.redrawChains.delete(agentRunId);
      }
    });
    return current;
  }
}
