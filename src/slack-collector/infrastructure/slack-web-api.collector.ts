import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebClient } from '@slack/web-api';
import { match } from 'ts-pattern';

import { appendIntegrationHint } from '../../common/domain/integration-failure-hint';
import { DomainStatus } from '../../common/exception/domain-status.enum';
import {
  ListMyMentionsOptions,
  SLACK_WEB_CLIENT,
  SlackCollectorPort,
} from '../domain/port/slack-collector.port';
import { SlackCollectorException } from '../domain/slack-collector.exception';
import { SlackMention } from '../domain/slack-collector.type';
import { SlackCollectorErrorCode } from '../domain/slack-collector-error-code.enum';

const DEFAULT_SINCE_HOURS = 24;
const DEFAULT_MAX_CHANNELS = 100;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 200;

const CHANNEL_TYPES_PARAM = 'public_channel,private_channel,im,mpim';

@Injectable()
export class SlackWebApiCollector implements SlackCollectorPort {
  private readonly logger = new Logger(SlackWebApiCollector.name);

  constructor(
    @Inject(SLACK_WEB_CLIENT) private readonly client: WebClient | null,
  ) {}

  async listMyMentions({
    slackUserId,
    sinceHours = DEFAULT_SINCE_HOURS,
    maxChannels = DEFAULT_MAX_CHANNELS,
    maxMessagesPerChannel = DEFAULT_MAX_MESSAGES_PER_CHANNEL,
  }: ListMyMentionsOptions): Promise<SlackMention[]> {
    if (!this.client) {
      throw new SlackCollectorException({
        code: SlackCollectorErrorCode.TOKEN_NOT_CONFIGURED,
        message:
          'SLACK_BOT_TOKEN 이 설정되지 않아 Slack WebAPI 호출이 불가합니다.',
        status: DomainStatus.PRECONDITION_FAILED,
      });
    }

    const oldest = String((Date.now() - sinceHours * 3600 * 1000) / 1000);
    const mentionToken = `<@${slackUserId}>`;

    let conversationsResponse: Awaited<
      ReturnType<WebClient['users']['conversations']>
    >;
    try {
      conversationsResponse = await this.client.users.conversations({
        types: CHANNEL_TYPES_PARAM,
        exclude_archived: true,
        limit: maxChannels,
      });
    } catch (error: unknown) {
      throw this.wrapRequestFailed(error, 'users.conversations 호출 실패');
    }

    const channels = (conversationsResponse.channels ?? []).slice(
      0,
      maxChannels,
    );

    const mentions: SlackMention[] = [];
    for (const channel of channels) {
      if (!channel.id) {
        continue;
      }
      let history: Awaited<ReturnType<WebClient['conversations']['history']>>;
      try {
        history = await this.client.conversations.history({
          channel: channel.id,
          oldest,
          limit: maxMessagesPerChannel,
        });
      } catch (error: unknown) {
        // 한 채널 history 실패는 전체를 무너뜨리지 않는다 (private 미초대 등).
        // 삼키는 경로라 로그가 유일한 단서다 — 초대 방법까지 여기서 알려 준다.
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          appendIntegrationHint(
            `conversations.history 실패 (channel=${channel.id}): ${reason}`,
            error,
          ),
        );
        continue;
      }

      for (const message of history.messages ?? []) {
        if (typeof message.text !== 'string') {
          continue;
        }
        if (!message.text.includes(mentionToken)) {
          continue;
        }
        mentions.push({
          channelId: channel.id,
          channelName: channel.name ?? undefined,
          channelType: resolveChannelType(channel),
          authorUserId: message.user ?? undefined,
          ts: message.ts ?? '',
          text: message.text,
          permalink: undefined,
        });
      }
    }

    return mentions;
  }

  private wrapRequestFailed(
    error: unknown,
    prefix: string,
  ): SlackCollectorException {
    const reason = error instanceof Error ? error.message : String(error);
    return new SlackCollectorException({
      code: SlackCollectorErrorCode.REQUEST_FAILED,
      message: appendIntegrationHint(`${prefix}: ${reason}`, error),
      cause: error,
    });
  }
}

const resolveChannelType = (channel: {
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}): SlackMention['channelType'] =>
  match(channel)
    .with({ is_im: true }, () => 'im' as const)
    .with({ is_mpim: true }, () => 'mpim' as const)
    .with({ is_private: true }, () => 'private_channel' as const)
    .otherwise(() => 'public_channel' as const);
