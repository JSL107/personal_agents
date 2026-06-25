import { Inject, Injectable, Logger } from '@nestjs/common';

import { AgentType } from '../../../model-router/domain/model-router.type';
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

// BLOG worker 의 Router dispatcher — 자연어 멘션(input.text)을 Hermes 블로그 스킬 요청으로 릴레이.
// - replyContext 없음(cron/슬래시/test): 기존 동기 — execute 완료까지 await 후 결과 반환.
// - replyContext 있음(Slack 자연어): Hermes 가 5분+ 걸리므로 즉시 "작성 시작" ack 를 반환하고
//   AgentRun+hermes+Notion enrich 전체를 백그라운드 Promise 로 돌린 뒤 같은 스레드에 답장한다.
@Injectable()
export class BlogDispatcher implements AgentDispatcher {
  readonly agentType = AgentType.BLOG;
  private readonly logger = new Logger(BlogDispatcher.name);

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
        requestText: input.text ?? '',
        slackUserId: input.slackUserId,
      });
      return {
        agentRunId: outcome.agentRunId,
        output: outcome.result,
        modelUsed: outcome.modelUsed,
        formattedText: formatBlogDraft(outcome.result),
      };
    }

    // 비동기 경로 — 즉시 ack + 백그라운드. runInBackground 는 내부에서 모든 실패를
    // notify 로 흡수하므로 void 로 띄워도 unhandled rejection 이 없다.
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
    try {
      const outcome = await this.generateBlogDraft.execute({
        requestText: input.text ?? '',
        slackUserId: input.slackUserId,
      });
      await this.notifier.notify({
        channel: reply.channel,
        ...(reply.threadTs ? { threadTs: reply.threadTs } : {}),
        text: formatBlogDraft(outcome.result),
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `비동기 BLOG 백그라운드 실패 (user=${input.slackUserId}): ${message}`,
      );
      await this.notifier.notify({
        channel: reply.channel,
        ...(reply.threadTs ? { threadTs: reply.threadTs } : {}),
        text: `블로그 초안 생성 실패: ${message}`,
      });
    }
  }
}
