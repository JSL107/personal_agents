import { comparePlainDate } from '../../agent/vacation/domain/plain-date';
import {
  escapeSlackMrkdwn,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
import {
  ART_JOB_EXCLUDE_LABEL,
  ART_JOB_INTEREST_LABEL,
  ART_JOB_RESTORE_LABEL,
  ART_JOB_UNINTEREST_LABEL,
} from '../domain/art-job-exclusion';
import {
  ArtJobImage,
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';
import {
  deadlineDateOf,
  normalizeDeadline,
  PlainMonthDay,
} from '../domain/deadline';
import { ArtJobReminderPosting } from '../domain/port/art-job-posting.repository.port';

export interface ArtJobDigestItem {
  listing: ArtJobListing;
  resolved: ResolvedArtJobImage;
}

export interface ArtJobDigestInput {
  items: ArtJobDigestItem[];
  mentionUserId: string | null;
  today: PlainMonthDay;
}

// 본문 버튼 → 제외·관심 / 되돌리기(ArtJobExclusionActionHandler). 버튼 값은 공고 번호(sourceId)다.
// action_id 는 블록 안에서만 유일하면 되므로 공고마다 같은 값을 쓰고, 어느 공고인지는 값으로 가린다.
export const ART_JOB_EXCLUDE_ACTION = 'art_job_exclude';
export const ART_JOB_RESTORE_ACTION = 'art_job_restore';
export const ART_JOB_INTEREST_ACTION = 'art_job_interest';
export const ART_JOB_UNINTEREST_ACTION = 'art_job_uninterest';
const INTEREST_ACTIONS: readonly unknown[] = [
  ART_JOB_INTEREST_ACTION,
  ART_JOB_UNINTEREST_ACTION,
];
const ITEM_BLOCK_PREFIX = 'art-job:';

// 받는 사람이 기능을 알 길이 이 줄뿐이다. 본문 끝 context 블록 — 출처 표기 같은 꼬리 줄도 여기에 붙인다.
const EXCLUSION_HINT = `마음에 드는 공고는 *${ART_JOB_INTEREST_LABEL}* 을 누르면 마감 전날 DM 으로 알려 드려요. 관심 없는 공고는 *${ART_JOB_EXCLUDE_LABEL}* 을 누르면 같은 공고가 다시 올라와도 보내지 않아요.`;

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
      text: excluded ? ART_JOB_RESTORE_LABEL : ART_JOB_EXCLUDE_LABEL,
    },
    value: sourceId,
  };
};

const buildInterestButton = (
  sourceId: string,
  interested: boolean,
): SlackBlock => {
  return {
    type: 'button',
    action_id: interested ? ART_JOB_UNINTEREST_ACTION : ART_JOB_INTEREST_ACTION,
    text: {
      type: 'plain_text',
      text: `⭐ ${interested ? ART_JOB_UNINTEREST_LABEL : ART_JOB_INTEREST_LABEL}`,
    },
    value: sourceId,
  };
};

export interface ArtJobItemActionsState {
  // 마감일이 있는 공고만 「관심 있음」을 단다 — 상시·채용시는 전날 알림을 계산할 수 없다.
  interestable: boolean;
  interested: boolean;
  excluded: boolean;
}

// 공고 글 아래 버튼 줄. section accessory 는 버튼 하나만 받으므로 actions 블록에 둔다.
export const buildArtJobItemActions = (
  sourceId: string,
  { interestable, interested, excluded }: ArtJobItemActionsState,
): SlackBlock => {
  const elements = interestable
    ? [buildInterestButton(sourceId, interested)]
    : [];
  elements.push(buildArtJobItemButton(sourceId, excluded));
  return {
    type: 'actions',
    block_id: artJobItemBlockId(sourceId),
    elements,
  };
};

// 다시 그릴 때 원래 「관심 있음」이 달린 줄인지 — 마감일을 다시 계산하지 않고 그려진 모양을 따른다.
export const hasInterestButton = (block: SlackBlock): boolean => {
  const elements = block.elements;
  if (!Array.isArray(elements)) {
    return false;
  }
  return elements.some((element: { action_id?: unknown }) => {
    return INTEREST_ACTIONS.includes(element.action_id);
  });
};

// 전날 알림을 받을 수 있는 공고만 — 마감일이 없거나(상시·채용시) 오늘 마감이면 전날이 이미 지났다.
const isInterestable = (
  deadlineText: string | null,
  today: PlainMonthDay,
): boolean => {
  const date = deadlineDateOf(deadlineText, today);
  return date !== null && comparePlainDate(date, today) > 0;
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
      text: { type: 'mrkdwn', text: itemTexts[index] },
    });
    if (mentionUserId) {
      blocks.push(
        buildArtJobItemActions(listing.sourceId, {
          interestable: isInterestable(listing.deadlineText, today),
          interested: false,
          excluded: false,
        }),
      );
    }
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
  const name = resolved.gameTitle
    ? escapeSlackMrkdwn(sanitizeForSlackLink(resolved.gameTitle))
    : null;
  if (resolved.image) {
    if (resolved.representativeGame) {
      const representative = `회사 대표작 ${escapeSlackMrkdwn(sanitizeForSlackLink(resolved.representativeGame))} · 이미지는 스레드에`;
      return name ? `🎮 ${name} · ${representative}` : `🎮 ${representative}`;
    }
    return name ? `🎮 ${name} · 이미지는 스레드에` : null;
  }
  const parts = name ? [`🎮 ${name}`] : [];
  if (resolved.googleSearchUrl) {
    parts.push(`<${resolved.googleSearchUrl}|구글 이미지 검색>`);
  }
  if (parts.length === 0) {
    return null;
  }
  return name ? parts.join(' · ') : `🔎 ${parts.join(' · ')}`;
};

// 스레드 이미지 메시지의 글 — 본문 목록 번호와 맞춰 어느 공고의 그림인지 찾게 한다.
// 검색으로 찾은 그림은 공식 이미지가 아닐 수 있어 참고용임과 출처를 밝힌다.
// 회사 대표게임의 그림이면 공고의 게임으로 읽히지 않게 '회사 대표작' 을 붙인다.
export const formatArtJobImageCaption = (
  order: number,
  gameTitle: string,
  image: ArtJobImage,
  representative = false,
): string => {
  const caption = `${order}. 🎮 ${representative ? '회사 대표작: ' : ''}${escapeSlackMrkdwn(gameTitle)}`;
  if (image.origin !== 'KAKAO_IMAGE') {
    return caption;
  }
  const source = image.sourceName
    ? ` (출처: ${escapeSlackMrkdwn(image.sourceName)})`
    : '';
  return `${caption} · 참고 이미지${source}`;
};

// 마감 전날 DM — 「관심 있음」 공고 중 내일 마감인 것을 한 통으로 묶는다.
export const formatArtJobDeadlineReminder = (
  postings: ArtJobReminderPosting[],
): string => {
  const lines = postings.map((posting) => {
    const title = escapeSlackMrkdwn(sanitizeForSlackLink(posting.title));
    return `• <${posting.detailUrl}|${title}> · ${escapeSlackMrkdwn(posting.company)}`;
  });
  return [`⏰ 내일 마감인 관심 공고 *${postings.length}건*`, ...lines].join(
    '\n',
  );
};
