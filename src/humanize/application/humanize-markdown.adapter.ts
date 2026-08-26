import {
  HumanizeMarkdownResult,
  HumanizeSkipReasons,
  scanMarkdownBlocks,
} from '../domain/markdown-blocks';
import { HumanizeAudience, HumanizeService } from './humanize.service';

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
  // 생략하면 `developer` — 지금까지의 발행 동작 그대로다. 대외용 글이 생기면 여기에 `general` 을 넘긴다.
  //
  // 왜 이 어댑터에만 뚫었는가 — 노션 초안 발행이 유일하게 "개발자가 아닌 사람이 읽을 수도 있는"
  // 경로다. 저녁 블로그(`humanize-evening-blog`)와 이력서(`humanize-career-profile`)는 독자가
  // 각각 본인·채용 담당이라 완화할 이유가 없다. 필요해지면 같은 방식으로 인자 하나만 통과시키면 된다.
  audience?: HumanizeAudience,
  // 직전 회차 실측 평균. 하한 미달일 때만 넘겨 그 수치를 지시에 싣는다(호흡 되먹임).
  measuredAverageLength?: number,
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
    return {
      markdown,
      changedParagraphs: 0,
      proseParagraphs: 0,
      skippedParagraphs: { empty: 0, identical: 0 },
    };
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
    audience,
    measuredAverageLength,
  });

  // 뒤에서부터 갈아끼운다 — 앞에서부터 바꾸면 줄 수가 달라져 뒤 블록의 줄 번호가 밀린다.
  const nextLines = [...lines];
  let changedParagraphs = 0;
  // 건너뛴 문단을 사유별로 센다. 세지 않으면 카드의 `42/43` 을 보고도 그 하나가 왜 빠졌는지
  // 알 수 없다 — 원인 규명이 막히는 자리가 정확히 여기였다.
  const skippedParagraphs: HumanizeSkipReasons = { empty: 0, identical: 0 };
  for (let order = proseBlocks.length - 1; order >= 0; order -= 1) {
    const block = proseBlocks[order];
    const original = fields[String(order)];
    const rewritten = humanized[String(order)];
    if (typeof rewritten !== 'string' || rewritten.trim().length === 0) {
      skippedParagraphs.empty += 1;
      continue;
    }
    if (rewritten === original) {
      skippedParagraphs.identical += 1;
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
    skippedParagraphs,
  };
};
