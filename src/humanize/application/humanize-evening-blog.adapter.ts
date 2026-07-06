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

  const humanizedFields = await humanizer.humanize(paragraphFields);

  return blocks.map((block, blockIndex) => {
    if (block.type !== 'paragraph') {
      return block;
    }

    const blockIndexKey = String(blockIndex);
    const humanizedText = humanizedFields[blockIndexKey] ?? block.text;
    return { ...block, text: humanizedText };
  });
};
