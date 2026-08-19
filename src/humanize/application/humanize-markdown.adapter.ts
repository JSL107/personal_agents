import {
  HumanizeMarkdownResult,
  scanMarkdownBlocks,
} from '../domain/markdown-blocks';
import { HumanizeService } from './humanize.service';

// 마크다운 본문에서 **산문 문단만** 골라 윤문하고 제자리에 되끼운다.
//
// 왜 블록을 가려야 하는가 — 코드블록·표·헤딩까지 모델에 넘기면 코드가 윤문되어 깨진다.
// (같은 뿌리의 사고를 오늘 겪었다: 정규식이 JSON string 안 코드펜스를 응답 펜스로 오인해
//  BLOG_PUBLISH run#864 가 죽었다. 마크다운을 다룰 때 펜스 인식은 선택이 아니다.)
//
// 문단 텍스트만 humanize 에 넘기고 같은 자리에 되끼운다. 실패 시 원문 그대로(best-effort).
export const humanizeMarkdownProse = async (
  markdown: string,
  humanizer: HumanizeService,
): Promise<HumanizeMarkdownResult> => {
  const { lines, blocks } = scanMarkdownBlocks(markdown);
  const proseBlocks = blocks.filter(
    (block) =>
      block.kind === 'prose' &&
      lines
        .slice(block.startLine, block.endLine + 1)
        .join('\n')
        .trim().length > 0,
  );

  if (proseBlocks.length === 0) {
    return { markdown, changedParagraphs: 0, proseParagraphs: 0 };
  }

  const fields: Record<string, string> = {};
  proseBlocks.forEach((block, order) => {
    fields[String(order)] = lines
      .slice(block.startLine, block.endLine + 1)
      .join('\n');
  });

  // 블로그 본문은 분량이 곧 내용이라 길이 예산을 걸지 않는다(훑어 읽는 Slack 요약과 반대).
  const humanized = await humanizer.humanize(fields, {
    longForm: true,
    voice: 'personal-blog',
  });

  // 뒤에서부터 갈아끼운다 — 앞에서부터 바꾸면 줄 수가 달라져 뒤 블록의 줄 번호가 밀린다.
  const nextLines = [...lines];
  let changedParagraphs = 0;
  for (let order = proseBlocks.length - 1; order >= 0; order -= 1) {
    const block = proseBlocks[order];
    const original = fields[String(order)];
    const rewritten = humanized[String(order)];
    if (typeof rewritten !== 'string' || rewritten.trim().length === 0) {
      continue;
    }
    if (rewritten === original) {
      continue;
    }
    changedParagraphs += 1;
    nextLines.splice(
      block.startLine,
      block.endLine - block.startLine + 1,
      ...rewritten.split('\n'),
    );
  }

  return {
    markdown: nextLines.join('\n'),
    changedParagraphs,
    proseParagraphs: proseBlocks.length,
  };
};
