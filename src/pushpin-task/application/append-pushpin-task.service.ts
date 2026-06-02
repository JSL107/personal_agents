import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { getTodayKstDate } from '../../common/util/kst-date.util';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../notion/domain/port/notion-client.port';

// 한 줄로 자르는 cap — Slack 메시지가 너무 길면 Notion bullet 한 줄이 폭주.
// 600 자 = 평균 3~4 문장. 그 이상은 cap + ellipsis.
const MESSAGE_CAP = 600;

export interface AppendPushpinTaskInput {
  slackUserId: string;
  channelId: string;
  messageTs: string;
  text: string;
  // chat.getPermalink 결과 — caller 가 fetch 해서 넘김 (실패 시 undefined).
  permalink?: string;
}

export interface AppendPushpinTaskResult {
  appended: boolean;
  // appended=false 면 skip 사유 — env 미설정 / 부모 페이지 ID 미설정 등.
  skipReason?: string;
}

// 📌 reaction → Notion task 자동 적재.
// 부모 페이지 (env `SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID`) 아래 일별 자식 페이지 (YYYY-MM-DD (요일))
// 를 찾거나 만들고, 해당 페이지에 bullet block 1건 append. (LLM 호출 X, 패턴은 PR careerLog 와 동일.)
//
// 멱등성: 본 service 는 멱등성 보장 X — 동일 message 에 같은 사용자가 📌 두 번 누르면 (toggle off → on)
// bullet 2건. Slack reaction_added 이벤트가 멱등하지 않은 한계 — caller 가 추가 dedup 원하면 별도 store 필요.
// (cost / 가치 balance: 일상 운영에선 reaction 토글 빈도 낮음 — 본 단계 추가 dedup 없이 출시.)
@Injectable()
export class AppendPushpinTaskService {
  private readonly logger = new Logger(AppendPushpinTaskService.name);

  constructor(
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async execute(
    input: AppendPushpinTaskInput,
  ): Promise<AppendPushpinTaskResult> {
    const parentPageId = this.configService
      .get<string>('SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID')
      ?.trim();
    if (!parentPageId || parentPageId.length === 0) {
      return {
        appended: false,
        skipReason: 'SLACK_PUSHPIN_REACTION_NOTION_PAGE_ID 미설정',
      };
    }

    const trimmedText = (input.text ?? '').trim();
    if (trimmedText.length === 0) {
      return { appended: false, skipReason: '빈 메시지' };
    }

    const todayKst = getTodayKstDate();
    const dailyTitle = buildDailyChildPageTitle(todayKst);

    const dailyPage = await this.notionClient.findOrCreateChildPage({
      parentPageId,
      title: dailyTitle,
    });

    const blocks = buildPushpinTaskBlocks({
      text: trimmedText,
      slackUserId: input.slackUserId,
      permalink: input.permalink,
    });

    await this.notionClient.appendBlocks({
      pageId: dailyPage.pageId,
      blocks,
    });

    this.logger.log(
      `📌 task 적재 완료 — parentPageId=${parentPageId} dailyChildPageId=${dailyPage.pageId} dailyTitle="${dailyTitle}" slackUserId=${input.slackUserId} channelId=${input.channelId}`,
    );

    return { appended: true };
  }
}

// "YYYY-MM-DD (요일)" 자식 페이지 title (PR careerLog 와 동일 포맷 — 같은 페이지 트리 공유 가능).
export const buildDailyChildPageTitle = (todayKst: string): string => {
  const date = new Date(`${todayKst}T00:00:00+09:00`);
  const weekday = new Intl.DateTimeFormat('ko-KR', {
    weekday: 'short',
    timeZone: 'Asia/Seoul',
  }).format(date);
  const weekdayShort = weekday.charAt(0);
  return `${todayKst} (${weekdayShort})`;
};

// 한 task = 1 bullet (cap 적용) + 옵션 link bullet (permalink).
// bullet 1줄에 link 가 같이 있으면 텍스트 전체가 클릭 가능해져 가독성 떨어짐 — 분리.
export const buildPushpinTaskBlocks = ({
  text,
  slackUserId,
  permalink,
}: {
  text: string;
  slackUserId: string;
  permalink?: string;
}): NotionPlanBlock[] => {
  const capped =
    text.length > MESSAGE_CAP ? `${text.slice(0, MESSAGE_CAP)}…` : text;
  const prefix = `📌 (by <@${slackUserId}>)`;
  const blocks: NotionPlanBlock[] = [
    { type: 'todo', text: `${prefix} ${capped}`, checked: false },
  ];
  if (permalink && permalink.length > 0) {
    blocks.push({
      type: 'bullet',
      text: '↳ Slack 원본 링크',
      link: permalink,
    });
  }
  return blocks;
};
