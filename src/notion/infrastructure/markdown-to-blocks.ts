import {
  NotionPlanBlock,
  NotionRichText,
} from '../domain/port/notion-client.port';

const RICH_TEXT_LIMIT = 2_000;
const SUPPORTED_CODE_LANGUAGES = new Set([
  'bash',
  'c',
  'c#',
  'c++',
  'css',
  'diff',
  'docker',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'mermaid',
  'php',
  'plain text',
  'powershell',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
]);
const CODE_LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  sh: 'shell',
  text: 'plain text',
  ts: 'typescript',
  txt: 'plain text',
};
const CONTINUATION_INDENTATION = /^ {2,}/;
const BLOCK_SYNTAX = /^(?:[-*]\s+|\d+\.\s+|#+(?:\s|$)|>\s*|```)/;

export const markdownToBlocks = (markdown: string): NotionPlanBlock[] => {
  const blocks: NotionPlanBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  let lineIndex = 0;

  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    const fence = line.match(/^```\s*([^\s`]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      lineIndex += 1;
      while (lineIndex < lines.length && !/^```\s*$/.test(lines[lineIndex])) {
        codeLines.push(lines[lineIndex]);
        lineIndex += 1;
      }
      if (lineIndex < lines.length) {
        lineIndex += 1;
      }
      const text = codeLines.join('\n');
      blocks.push({
        type: 'code',
        text,
        richText: buildPlainRichText(text, { code: true }),
        language: resolveCodeLanguage(fence[1]),
      });
      continue;
    }

    const continuation = getContinuation(line);
    if (continuation !== null && appendContinuation(blocks, continuation)) {
      lineIndex += 1;
      continue;
    }

    const block = toBlock(line);
    if (block) {
      blocks.push(block);
    }
    lineIndex += 1;
  }

  return blocks;
};

const getContinuation = (line: string): string | null => {
  if (!CONTINUATION_INDENTATION.test(line)) {
    return null;
  }

  const content = line.trimStart();
  if (content.length === 0 || BLOCK_SYNTAX.test(content)) {
    return null;
  }

  return content;
};

const appendContinuation = (
  blocks: NotionPlanBlock[],
  continuation: string,
): boolean => {
  const previousBlock = blocks.at(-1);
  if (
    !previousBlock ||
    previousBlock.type === 'code' ||
    !('text' in previousBlock) ||
    !previousBlock.richText
  ) {
    return false;
  }

  const text = `${previousBlock.text}\n${stripInlineMarkers(continuation)}`;
  const richText = [
    ...previousBlock.richText,
    ...buildAnnotatedRichText(`\n${continuation}`),
  ];
  Object.assign(previousBlock, { text, richText });
  return true;
};

export const buildAnnotatedRichText = (text: string): NotionRichText[] => {
  const richText: NotionRichText[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    if (text.startsWith('**', cursor)) {
      const end = text.indexOf('**', cursor + 2);
      if (end >= 0) {
        appendRichText(richText, text.slice(cursor + 2, end), { bold: true });
        cursor = end + 2;
        continue;
      }
    }
    if (text[cursor] === '`') {
      const end = text.indexOf('`', cursor + 1);
      if (end >= 0) {
        appendRichText(richText, text.slice(cursor + 1, end), { code: true });
        cursor = end + 1;
        continue;
      }
    }

    const nextBold = text.indexOf('**', cursor + 1);
    const nextCode = text.indexOf('`', cursor + 1);
    const candidates = [nextBold, nextCode].filter((index) => index >= 0);
    const end = candidates.length > 0 ? Math.min(...candidates) : text.length;
    appendRichText(richText, text.slice(cursor, end));
    cursor = end;
  }

  return richText;
};

const toBlock = (line: string): NotionPlanBlock | null => {
  if (line.trim().length === 0) {
    return null;
  }
  if (line.trim() === '---') {
    return { type: 'divider' };
  }

  const patterns: Array<{
    expression: RegExp;
    type: 'heading' | 'subheading' | 'bullet' | 'numbered' | 'quote';
  }> = [
    { expression: /^##\s+/, type: 'heading' },
    { expression: /^###\s+/, type: 'subheading' },
    { expression: /^[-*]\s+/, type: 'bullet' },
    { expression: /^\d+\.\s+/, type: 'numbered' },
    { expression: /^>\s+/, type: 'quote' },
  ];
  for (const pattern of patterns) {
    if (pattern.expression.test(line)) {
      const content = line.replace(pattern.expression, '');
      return {
        type: pattern.type,
        text: stripInlineMarkers(content),
        richText: buildAnnotatedRichText(content),
      };
    }
  }
  return {
    type: 'paragraph',
    text: stripInlineMarkers(line),
    richText: buildAnnotatedRichText(line),
  };
};

const stripInlineMarkers = (text: string): string =>
  buildAnnotatedRichText(text)
    .map((item) => item.text.content)
    .join('');

const buildPlainRichText = (
  text: string,
  annotations?: NotionRichText['annotations'],
): NotionRichText[] => {
  const richText: NotionRichText[] = [];
  appendRichText(richText, text, annotations);
  return richText;
};

const appendRichText = (
  target: NotionRichText[],
  text: string,
  annotations?: NotionRichText['annotations'],
): void => {
  const characters = Array.from(text);
  for (let index = 0; index < characters.length; index += RICH_TEXT_LIMIT) {
    const content = characters.slice(index, index + RICH_TEXT_LIMIT).join('');
    if (content.length === 0) {
      continue;
    }
    target.push({
      type: 'text',
      text: { content },
      ...(annotations !== undefined ? { annotations } : {}),
    });
  }
};

const resolveCodeLanguage = (raw: string): string => {
  const normalized = raw.trim().toLowerCase();
  const language = CODE_LANGUAGE_ALIASES[normalized] ?? normalized;
  return SUPPORTED_CODE_LANGUAGES.has(language) ? language : 'plain text';
};
