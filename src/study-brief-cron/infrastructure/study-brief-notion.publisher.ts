import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { match } from 'ts-pattern';

import { StudyTopicVerdict } from '../../agent/cto/domain/cto.type';
import {
  NOTION_CLIENT_PORT,
  NotionClientPort,
  NotionPlanBlock,
} from '../../notion/domain/port/notion-client.port';
import {
  buildAnnotatedRichText,
  markdownToBlocks,
} from '../../notion/infrastructure/markdown-to-blocks';
import {
  PublishedStudyBrief,
  PublishStudyBriefInput,
  StudyBriefPublisherPort,
} from '../domain/port/study-brief-publisher.port';

const NOTION_BLOCK_LIMIT = 100;
const PROPERTY_NAME_TITLE = '이름';
const PROPERTY_NAME_KIND = '종류';
const PROPERTY_NAME_DATE = '날짜';
const PROPERTY_NAME_MINUTES = '소요';
const PROPERTY_NAME_SOURCE_COUNT = '출처 수';

@Injectable()
export class StudyBriefNotionPublisher implements StudyBriefPublisherPort {
  constructor(
    @Inject(NOTION_CLIENT_PORT)
    private readonly notionClient: NotionClientPort,
    private readonly configService: ConfigService,
  ) {}

  async publish(input: PublishStudyBriefInput): Promise<PublishedStudyBrief> {
    const databaseId = this.configService
      .get<string>('STUDY_BRIEF_NOTION_DATABASE_ID')
      ?.trim();
    if (!databaseId) {
      throw new Error('STUDY_BRIEF_NOTION_DATABASE_ID가 설정되지 않았습니다.');
    }

    const blocks = buildPageBlocks(input);
    const firstBlocks = blocks.slice(0, NOTION_BLOCK_LIMIT);
    const page = await this.notionClient.createDatabasePage({
      databaseId,
      properties: buildProperties(input),
      blocks: firstBlocks,
    });
    for (
      let index = NOTION_BLOCK_LIMIT;
      index < blocks.length;
      index += NOTION_BLOCK_LIMIT
    ) {
      await this.notionClient.appendBlocks({
        pageId: page.pageId,
        blocks: blocks.slice(index, index + NOTION_BLOCK_LIMIT),
      });
    }
    return page;
  }
}

const buildPageBlocks = (input: PublishStudyBriefInput): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [
    buildCallout(input.verdict),
    { type: 'divider' },
    ...markdownToBlocks(input.reportMd),
    { type: 'divider' },
    { type: 'heading', text: '출처' },
  ];
  for (const sourceUrl of input.sourceUrls) {
    blocks.push({ type: 'bullet', text: sourceUrl, link: sourceUrl });
  }
  return blocks;
};

const buildCallout = (verdict: StudyTopicVerdict): NotionPlanBlock => {
  const callout = match(verdict)
    .with({ kind: 'CONCEPT' }, (concept) => ({
      icon: '📚',
      text: [
        `**왜 지금 나한테** ${concept.whyNow}`,
        `**어디에 닿나** ${concept.whereItLands}`,
        `**읽을 것** ${concept.readingPlan}`,
      ].join('\n'),
    }))
    .with({ kind: 'TOOL' }, (tool) => {
      const lines = [
        `**뭐가 좋아지나** ${tool.whatImproves}`,
        `**붙이는 비용** ${tool.adoptionCost}`,
        `**설치** ${tool.installHint}`,
      ];
      if (tool.caution !== undefined) {
        lines.push(`**주의** ${tool.caution}`);
      }
      return { icon: '🔧', text: lines.join('\n') };
    })
    .exhaustive();
  return {
    type: 'callout',
    icon: callout.icon,
    text: buildAnnotatedRichText(callout.text)
      .map((item) => item.text.content)
      .join(''),
    richText: buildAnnotatedRichText(callout.text),
  };
};

const buildProperties = (
  input: PublishStudyBriefInput,
): Record<string, unknown> => ({
  [PROPERTY_NAME_TITLE]: {
    title: buildAnnotatedRichText(input.topic),
  },
  [PROPERTY_NAME_KIND]: {
    select: { name: input.kind === 'CONCEPT' ? '개념' : '도구' },
  },
  [PROPERTY_NAME_DATE]: { date: { start: formatKstDate(input.createdAt) } },
  [PROPERTY_NAME_MINUTES]: { number: input.verdict.minutes },
  [PROPERTY_NAME_SOURCE_COUNT]: { number: input.sourceUrls.length },
});

const formatKstDate = (date: Date): string => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};
