export interface NotionReadBlock {
  type: string;
  text: string;
  language?: string;
}

const FENCE_START = /^```/;
const LIST_ITEM = /^(?:- |\d+\. )/;

export const blocksToMarkdown = (blocks: NotionReadBlock[]): string => {
  const lines: string[] = [];
  let fenceOpen = false;
  let previousOutput = '';

  for (const block of blocks) {
    const output = toMarkdown(block, fenceOpen);
    if (output.length === 0) {
      continue;
    }

    if (
      lines.length > 0 &&
      !fenceOpen &&
      !isContinuousList(previousOutput, output)
    ) {
      lines.push('');
    }
    lines.push(output);
    previousOutput = output;

    if (block.type === 'paragraph' && FENCE_START.test(output)) {
      fenceOpen = !fenceOpen;
    }
  }

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

const toMarkdown = (block: NotionReadBlock, fenceOpen: boolean): string => {
  const text =
    block.type === 'code' || (block.type === 'paragraph' && fenceOpen)
      ? block.text
      : block.text.trim();

  switch (block.type) {
    case 'heading_1':
    case 'heading_2':
      return `# ${text}`;
    case 'heading_3':
      return `## ${text}`;
    case 'bulleted_list_item':
      return `- ${text}`;
    case 'numbered_list_item':
      return `1. ${text}`;
    case 'code':
      return `\`\`\`${block.language ?? ''}\n${text}\n\`\`\``;
    case 'quote':
    case 'callout':
      return `> ${text}`;
    case 'divider':
      return '---';
    default:
      return text;
  }
};

const isContinuousList = (previousOutput: string, output: string): boolean =>
  LIST_ITEM.test(previousOutput) && LIST_ITEM.test(output);
