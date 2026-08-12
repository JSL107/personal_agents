import { NotionPlanBlock } from '../../notion/domain/port/notion-client.port';
import { HumanizeService } from './humanize.service';

type EveningBlogParagraphFields = Record<string, string>;

export const humanizeEveningBlogBlocks = async (
  blocks: NotionPlanBlock[],
  humanizer: HumanizeService,
): Promise<NotionPlanBlock[]> => {
  const paragraphBlockIndexes: number[] = [];
  const paragraphFields: EveningBlogParagraphFields = {};

  blocks.forEach((block, blockIndex) => {
    if (block.type === 'paragraph') {
      paragraphBlockIndexes.push(blockIndex);
      paragraphFields[String(blockIndex)] = block.text;
    }
  });

  if (paragraphBlockIndexes.length === 0) {
    return blocks;
  }

  // 블로그 본문은 분량이 곧 내용이라 길이 예산을 걸지 않는다(훑어 읽는 Slack 요약과 반대).
  const humanizedFields = await humanizer.humanize(paragraphFields, {
    longForm: true,
  });

  return blocks.map((block, blockIndex) => {
    if (block.type !== 'paragraph') {
      return block;
    }

    const blockIndexKey = String(blockIndex);
    const humanizedText = humanizedFields[blockIndexKey] ?? block.text;
    return { ...block, text: humanizedText };
  });
};
