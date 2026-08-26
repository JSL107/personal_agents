import {
  breakProseIntoSentences,
  isCodeFenceLine,
  linkifyBareUrls,
} from './mrkdwn.util';
import {
  chunkMrkdwnText,
  SECTION_MRKDWN_LIMIT,
} from './preview-message.builder';

// Slack 메시지 하나에 넣을 수 있는 block 상한. 초과하면 API 가 invalid_blocks 로 거절한다.
const SLACK_MAX_BLOCKS = 50;

// header block 의 plain_text 상한은 150. 여유 10 두고 140 까지만 제목으로 승격한다.
const HEADER_TEXT_LIMIT = 140;

// 줄 전체가 `*제목*` 하나로만 이뤄진 줄 = 섹션 제목. `*판단 근거*: ...` 처럼 뒤에 본문이 붙은 줄은
// 제목이 아니라 본문의 첫 줄이므로 승격 대상에서 제외된다 (뒤에 `:` 가 따라와 패턴이 안 맞음).
const HEADING_LINE = new RegExp(`^\\*([^*]{1,${HEADER_TEXT_LIMIT}})\\*$`);

// header block 은 plain_text 라 mrkdwn 을 렌더하지 않는다 — 링크(`<url|이름>`)나 escapeSlackMrkdwn 이 남긴
// 엔티티(`&lt;`), 인라인 코드가 제목에 섞이면 기호가 날것으로 노출돼 지금보다 읽기 나빠진다.
// 이런 줄은 승격을 포기하고 본문 section 으로 남긴다 — 최악이라야 현행 렌더와 같다.
const HEADER_UNSAFE_CHARACTER = /[<>&`_~]/;

type SlackBlock = Record<string, unknown>;

// Slack 의 mrkdwn 상태는 block 사이로 이어지지 않는다 — 코드블록이 두 section 에 걸치면
// 뒷 조각이 평범한 글로 렌더돼 서식이 깨지고 그 안의 Slack 문법까지 해석된다.
// 나눌 수 없으면 null 을 돌려 통째로 text 경로에 맡긴다(현행 렌더 유지).
const splitsCodeFence = (chunk: string): boolean =>
  (chunk.match(/```/g) ?? []).length % 2 !== 0;

const toSectionBlocks = (body: string): SlackBlock[] | null => {
  const chunks = chunkMrkdwnText(body, SECTION_MRKDWN_LIMIT);
  if (chunks.some(splitsCodeFence)) {
    return null;
  }
  return chunks.map((chunk) => ({
    type: 'section',
    text: { type: 'mrkdwn', text: chunk },
  }));
};

// mrkdwn 텍스트를 읽기 쉬운 Block Kit 블록으로 분해한다.
//
// 문자열 한 덩어리로 보내면 소제목과 본문이 같은 크기·굵기로 이어져 눈이 섹션 경계를 못 잡는다.
// 제목 줄을 header 로 승격하고 그 앞에 divider 를 깔아 시각 계층을 만든다.
//
// 블록이 상한을 넘으면 null 을 반환한다 — 호출부는 기존처럼 text 만 발송해 실패 대신 현행 렌더로 되돌아간다.
export const buildReadableBlocks = (text: string): SlackBlock[] | null => {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const blocks: SlackBlock[] = [];
  let buffer: string[] = [];
  let unsplittable = false;

  const flushBuffer = (): void => {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (body.length === 0) {
      return;
    }
    const sections = toSectionBlocks(body);
    if (sections === null) {
      unsplittable = true;
      return;
    }
    blocks.push(...sections);
  };

  // ``` 코드블록 안의 `*강조*` 줄을 제목으로 올리면 그 자리에서 블록이 갈려
  // 여는 fence 만 남은 조각이 생긴다 — 코드가 통째로 깨진 채 발송된다.
  let insideCodeFence = false;
  for (const line of trimmed.split('\n')) {
    if (isCodeFenceLine(line)) {
      insideCodeFence = !insideCodeFence;
      buffer.push(line);
      continue;
    }
    const heading = insideCodeFence ? null : HEADING_LINE.exec(line.trim());
    if (!heading || HEADER_UNSAFE_CHARACTER.test(heading[1])) {
      buffer.push(line);
      continue;
    }
    flushBuffer();
    if (blocks.length > 0) {
      blocks.push({ type: 'divider' });
    }
    blocks.push({
      type: 'header',
      text: { type: 'plain_text', text: heading[1], emoji: true },
    });
  }
  flushBuffer();

  // 제목이 하나도 없으면 단일 section 과 다를 게 없다 — 블록으로 감쌀 이득이 없으니 text 경로에 맡긴다.
  const hasHeader = blocks.some((block) => block.type === 'header');
  if (unsplittable || !hasHeader || blocks.length > SLACK_MAX_BLOCKS) {
    return null;
  }
  return blocks;
};

// 모든 Slack 텍스트 발송이 지나는 공통 렌더. 맨 URL 을 접고, 가능하면 Block Kit 으로 계층을 세운다.
// text 는 blocks 유무와 무관하게 항상 채운다 — 알림 미리보기와 스크린리더가 읽는 값이라 비우면 안 된다.
export const toReadableMessage = (
  text: string,
): { text: string; blocks?: SlackBlock[] } => {
  const linked = breakProseIntoSentences(linkifyBareUrls(text));
  const blocks = buildReadableBlocks(linked);
  return blocks ? { text: linked, blocks } : { text: linked };
};

// say / respond / chat.postMessage 인자에 그대로 펼쳐 쓰는 형태.
// Bolt 의 blocks union(KnownBlock)은 Block Kit JSON 을 그대로 받지 못할 만큼 엄격해 narrow cast 가
// 필요한데, 발송 지점마다 캐스팅을 흩뿌리지 않도록 여기 한곳에 모은다.
export const toReadableSlackArgs = (
  text: string,
): { text: string; blocks?: never } => {
  const readable = toReadableMessage(text);
  return {
    text: readable.text,
    ...(readable.blocks ? { blocks: readable.blocks as never } : {}),
  };
};
