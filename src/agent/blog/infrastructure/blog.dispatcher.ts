import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
import {
  BLOG_WRITE_VERBS,
  findHypotheticalMarker,
  formatHeldWrite,
} from '../../../router/domain/hypothetical-utterance';
import {
  BlogReplyContext,
  DispatchInput,
} from '../../../router/domain/idaeri-router.port';
import {
  AgentDispatcher,
  DispatchOutcome,
} from '../../../router/domain/port/agent-dispatcher.port';
import { formatBlogDraft } from '../../../slack/format/blog.formatter';
import { GenerateBlogDraftUsecase } from '../application/generate-blog-draft.usecase';
import {
  BLOG_SLACK_NOTIFIER_PORT,
  BlogSlackNotifierPort,
} from '../domain/port/slack-notifier.port';

// 비동기 즉시 ack 의 sentinel agentRunId — 이 시점엔 AgentRun 이 아직 begin 안 됐다.
// outcome.agentRunId 는 number 필수라 "유효 run 없음" sentinel 0 을 쓴다(router/handler 와 일관).
// 실제 agentRunId 는 백그라운드 완료 후 notify 메시지(formatBlogDraft)로 전달된다.
const ASYNC_ACK_AGENT_RUN_ID = 0;
// 종료 신호에서 중단 안내 답장에 주는 시간. 프로세스는 곧 죽어야 한다 — run 마감(AgentRunService
// SHUTDOWN_MARK_TIMEOUT_MS)과 같은 상한으로 병렬로 돌아 종료 시간을 늘리지 않는다.
const INTERRUPT_NOTICE_TIMEOUT_MS = 2_000;
const INTERRUPT_NOTICE_TEXT =
  '⚠️ 서버가 재시작되면서 블로그 초안 작성이 중단됐어요. 같은 요청을 다시 보내 주시면 처음부터 다시 쓸게요.';

const buildBlogRequestText = (input: DispatchInput): string => {
  const text = input.text ?? '';
  const userInstruction = input.conversationContext?.userInstruction?.trim();
  if (!userInstruction) {
    return text;
  }
  return `${text}\n\n[대화 맥락] ${userInstruction}`;
};

// BLOG worker 의 Router dispatcher — 자연어 멘션(input.text)을 Hermes 블로그 스킬 요청으로 릴레이.
// - replyContext 없음(cron/슬래시/test): 기존 동기 — execute 완료까지 await 후 결과 반환.
// - replyContext 있음(Slack 자연어): Hermes 가 5분+ 걸리므로 즉시 "작성 시작" ack 를 반환하고
//   AgentRun+hermes+Notion enrich 전체를 백그라운드 Promise 로 돌린 뒤 같은 스레드에 답장한다.
@Injectable()
export class BlogDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG;
  private readonly logger = new Logger(BlogDispatcher.name);
  // 백그라운드로 도는 초안의 답장 위치. 프로세스가 죽으면 runInBackground 의 실패 답장도 같이
  // 사라지므로, 종료 신호에서 notifyInterrupted 가 대신 알린다.
  private readonly inFlightReplies = new Set<BlogReplyContext>();

  constructor(
    private readonly generateBlogDraft: GenerateBlogDraftUsecase,
    @Inject(BLOG_SLACK_NOTIFIER_PORT)
    private readonly notifier: BlogSlackNotifierPort,
  ) {}

  async dispatch(input: DispatchInput): Promise<DispatchOutcome> {
    const reply = input.replyContext;
    if (!reply) {
      // 동기 경로 (cron/슬래시/test) — 기존 그대로.
      const outcome = await this.generateBlogDraft.execute({
        requestText: buildBlogRequestText(input),
        slackUserId: input.slackUserId,
      });
      return {
        agentRunId: outcome.agentRunId,
        output: outcome.result,
        modelUsed: outcome.modelUsed,
        formattedText: formatBlogDraft(outcome.result),
      };
    }

    // 자연어 질문("이거 3줄 요약할 수 있어?")이면 초안을 만들지 않는다 — Notion 페이지가 실제로
    // 생긴다(2026-10-14 run 8837). 회신 컨텍스트가 있는 자연어 멘션 경로만 본다 — 주제 번호 선택은
    // 명시 지시라 동기 경로로 오고, 주제 제목에 물음표가 있어도 막지 않는다.
    // "블로그 글 써줄래?" 같은 정중한 지시는 질문이 아니다 — 블로그 동사는 여기서만 넘긴다.
    const marker = findHypotheticalMarker(input.text ?? '', BLOG_WRITE_VERBS);
    if (marker !== null) {
      this.logger.warn(`BLOG 초안 보류 — 질문·가정형 원문 (표지=${marker})`);
      return {
        agentRunId: ASYNC_ACK_AGENT_RUN_ID,
        output: { heldWrite: { action: 'DRAFT', marker } },
        modelUsed: 'none',
        // 예시 문구에 `<주제>` 를 쓰면 Slack 이 `<…>` 를 제어 표기로 읽어 깨진다 — 실제 주제로 든다.
        formattedText: formatHeldWrite(
          '블로그 초안을 작성',
          '프롬프트 RAG 블로그 초안 써줘',
        ),
      };
    }

    // 비동기 경로 — 즉시 ack + 백그라운드. runInBackground 는 내부에서 모든 실패를
    // notify 로 흡수하므로 void 로 띄워도 unhandled rejection 이 없다.
    // 결과 답장 대기는 백그라운드를 띄우기 전에 남긴다 — 결과 기록이 대기 기록보다 먼저 쓰이면 안 된다.
    await reply.markFinalReplyPending?.();
    void this.runInBackground(input, reply);
    return {
      agentRunId: ASYNC_ACK_AGENT_RUN_ID,
      output: { async: true },
      modelUsed: 'hermes-cli',
      formattedText:
        '📝 블로그 초안 작성을 시작했어요. 몇 분 뒤 이 스레드에 Notion 링크를 올릴게요.',
    };
  }

  // 백그라운드 실행 — 성공/실패 모두 notify 로 같은 스레드에 답장한다.
  // notifier 내부도 swallow 라 이중 방어(여기 try/catch + notifier swallow)로 throw 가 새지 않는다.
  private async runInBackground(
    input: DispatchInput,
    reply: BlogReplyContext,
  ): Promise<void> {
    this.inFlightReplies.add(reply);
    let text: string;
    let agentRunId: number | undefined;
    try {
      const outcome = await this.generateBlogDraft.execute({
        requestText: buildBlogRequestText(input),
        slackUserId: input.slackUserId,
        ...(reply.conversationKey
          ? { conversationKey: reply.conversationKey }
          : {}),
        ...(reply.replyThreadKey
          ? { replyThreadKey: reply.replyThreadKey }
          : {}),
      });
      text = formatBlogDraft(outcome.result);
      agentRunId = outcome.agentRunId;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `비동기 BLOG 백그라운드 실패 (user=${input.slackUserId}): ${message}`,
      );
      text = `블로그 초안 생성 실패: ${message}`;
    } finally {
      // 생성이 끝나면 답장 전에 중단 대상에서 뺀다 — 완료 답장 도중 신호가 오면 "다시 요청하라" 가
      // 성공 링크와 같이 나가 이미 있는 초안을 중복 생성하게 한다(#824 리뷰).
      this.inFlightReplies.delete(reply);
    }
    const posted = await this.reply(reply, text, agentRunId);
    // 재시작 안내(notifyInterrupted)는 결과가 아니라 기록하지 않는다 — 대기로 남아 「답 안 나감」으로 세진다.
    await reply.recordFinalReply?.(posted);
  }

  // 종료 신호(SIGTERM·SIGINT)에서 아직 도는 초안의 스레드에 중단을 알린다 — 없으면 "몇 분 뒤 링크를
  // 올릴게요" 뒤로 아무 소식이 없다(2026-10-14 run 8886). 상한을 넘기거나 실패하면 포기한다.
  async notifyInterrupted(): Promise<void> {
    const replies = [...this.inFlightReplies];
    if (replies.length === 0) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled(
          replies.map((reply) => this.reply(reply, INTERRUPT_NOTICE_TEXT)),
        ),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, INTERRUPT_NOTICE_TIMEOUT_MS);
        }),
      ]);
      this.logger.warn(
        `종료 신호 — 블로그 초안 ${replies.length}건에 중단 안내`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  // 같은 스레드에 답장하고 대화 기억에도 남긴다. 기억 실패는 답장을 막지 않는다 — 다음 턴 맥락만 잃는다.
  private async reply(
    reply: BlogReplyContext,
    text: string,
    agentRunId?: number,
  ): Promise<boolean> {
    const posted = await this.notifier.notify({
      channel: reply.channel,
      ...(reply.threadTs ? { threadTs: reply.threadTs } : {}),
      text,
    });
    try {
      await reply.rememberReply?.(text, agentRunId);
    } catch (error: unknown) {
      this.logger.warn(
        `BLOG 완료 답장 대화 기억 실패: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return posted;
  }
}
