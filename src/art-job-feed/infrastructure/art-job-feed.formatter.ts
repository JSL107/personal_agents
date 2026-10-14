import {
  escapeSlackMrkdwn,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
import {
  ArtJobImage,
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';
import { normalizeDeadline, PlainMonthDay } from '../domain/deadline';

export interface ArtJobDigestItem {
  listing: ArtJobListing;
  resolved: ResolvedArtJobImage;
}

export interface ArtJobDigestInput {
  items: ArtJobDigestItem[];
  mentionUserId: string | null;
  today: PlainMonthDay;
}

// 본문 버튼 → 제외 / 되돌리기(ArtJobExclusionActionHandler). 버튼 값은 공고 번호(sourceId)다.
// action_id 는 블록 안에서만 유일하면 되므로 공고마다 같은 값을 쓰고, 어느 공고인지는 값으로 가린다.
export const ART_JOB_EXCLUDE_ACTION = 'art_job_exclude';
export const ART_JOB_RESTORE_ACTION = 'art_job_restore';
const ITEM_BLOCK_PREFIX = 'art-job:';

// 받는 사람이 기능을 알 길이 이 줄뿐이다. 본문 끝 context 블록 — 출처 표기 같은 꼬리 줄도 여기에 붙인다.
const EXCLUSION_HINT =
  '관심 없는 공고는 *관심 없음* 을 눌러 주세요. 같은 공고가 다시 올라와도 보내지 않아요.';

export interface ArtJobDigestMessage {
  // 알림·스크린 리더용 대체 문구 — blocks 와 같은 내용을 글로 담는다(버튼·안내 제외).
  text: string;
  blocks: SlackBlock[];
}

export type SlackBlock = Record<string, unknown>;

export const artJobItemBlockId = (sourceId: string): string => {
  return `${ITEM_BLOCK_PREFIX}${sourceId}`;
};

export const parseArtJobItemBlockId = (blockId: unknown): string | null => {
  if (typeof blockId !== 'string' || !blockId.startsWith(ITEM_BLOCK_PREFIX)) {
    return null;
  }
  return blockId.slice(ITEM_BLOCK_PREFIX.length) || null;
};

export const buildArtJobItemButton = (
  sourceId: string,
  excluded: boolean,
): SlackBlock => {
  return {
    type: 'button',
    action_id: excluded ? ART_JOB_RESTORE_ACTION : ART_JOB_EXCLUDE_ACTION,
    text: {
      type: 'plain_text',
      text: excluded ? '제외됨 · 되돌리기' : '관심 없음',
    },
    value: sourceId,
  };
};

// 한 회차 = 채널 메시지 한 통. 공고마다 따로 보내면 하루 최대 22통이 채널을 덮어
// 목록을 한눈에 비교할 수 없었다. 이미지는 스레드로 내리고 여기엔 글만 싣는다.
//
// 버튼은 받는 사람(멘션 대상)이 있을 때만 단다 — 핸들러가 그 사람의 클릭만 받으므로,
// 멘션이 없으면 아무도 누를 수 없는 버튼이 된다.
export const formatArtJobDigest = ({
  items,
  mentionUserId,
  today,
}: ArtJobDigestInput): ArtJobDigestMessage => {
  const mention = mentionUserId ? `<@${mentionUserId}> ` : '';
  const header = `🎨 ${mention}게임잡 새 원화 공고 *${items.length}건*`;
  const itemTexts = items.map(({ listing, resolved }, index) => {
    return formatItem(index + 1, listing, resolved, today);
  });
  const blocks: SlackBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: header } },
  ];
  for (const [index, { listing }] of items.entries()) {
    blocks.push({
      type: 'section',
      block_id: artJobItemBlockId(listing.sourceId),
      text: { type: 'mrkdwn', text: itemTexts[index] },
      ...(mentionUserId
        ? { accessory: buildArtJobItemButton(listing.sourceId, false) }
        : {}),
    });
  }
  if (mentionUserId) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: EXCLUSION_HINT }],
    });
  }
  // 스크린 리더와 블록을 못 그리는 화면은 text 만 읽는다 — 머리만 두면 공고가 통째로 빠진다.
  return { text: [header, ...itemTexts].join('\n\n'), blocks };
};

const formatItem = (
  order: number,
  listing: ArtJobListing,
  resolved: ResolvedArtJobImage,
  today: PlainMonthDay,
): string => {
  const title = escapeSlackMrkdwn(sanitizeForSlackLink(listing.title));
  const deadline = normalizeDeadline(listing.deadlineText, today);
  // 원화가가 공고를 거르는 기준 순서 — 회사 · 경력 · 고용형태 · 지역 · 마감.
  const facts = [
    listing.company,
    listing.career,
    listing.employmentType,
    listing.location,
  ]
    .filter((value): value is string => Boolean(value))
    .map(escapeSlackMrkdwn);
  if (deadline) {
    facts.push(
      deadline.urgent
        ? `🔥 *${escapeSlackMrkdwn(deadline.label)}*`
        : escapeSlackMrkdwn(deadline.label),
    );
  }
  const lines = [
    `*${order}. <${listing.detailUrl}|${title}>*`,
    facts.join(' · '),
  ];
  const game = formatGameLine(resolved);
  if (game) {
    lines.push(game);
  }
  return lines.join('\n');
};

const formatGameLine = (resolved: ResolvedArtJobImage): string | null => {
  if (!resolved.gameTitle) {
    return null;
  }
  const name = escapeSlackMrkdwn(sanitizeForSlackLink(resolved.gameTitle));
  if (resolved.image) {
    return `🎮 ${name} · 이미지는 스레드에`;
  }
  if (resolved.googleSearchUrl) {
    return `🎮 <${resolved.googleSearchUrl}|${name}> (구글 이미지 검색)`;
  }
  return `🎮 ${name}`;
};

// 스레드 이미지 메시지의 글 — 본문 목록 번호와 맞춰 어느 공고의 그림인지 찾게 한다.
// 검색으로 찾은 그림은 공식 이미지가 아닐 수 있어 참고용임과 출처를 밝힌다.
export const formatArtJobImageCaption = (
  order: number,
  gameTitle: string,
  image: ArtJobImage,
): string => {
  const caption = `${order}. 🎮 ${escapeSlackMrkdwn(gameTitle)}`;
  if (image.origin !== 'KAKAO_IMAGE') {
    return caption;
  }
  const source = image.sourceName
    ? ` (출처: ${escapeSlackMrkdwn(image.sourceName)})`
    : '';
  return `${caption} · 참고 이미지${source}`;
};
