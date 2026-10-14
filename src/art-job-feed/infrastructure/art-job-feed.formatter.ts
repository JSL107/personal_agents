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

// 번호 이모지 리액션 → 제외(ArtJobExclusionReactionHandler). 받는 사람이 기능을 알 길이 이 줄뿐이다.
// 핸들러는 받는 사람(멘션 대상)이 있을 때만 켜지므로, 멘션이 없으면 동작하지 않는 안내도 싣지 않는다.
const EXCLUSION_HINT =
  '_관심 없는 공고는 이 메시지에 번호 이모지(1️⃣~🔟)를 달아 주세요. 같은 공고가 다시 올라와도 보내지 않아요._';

// 한 회차 = 채널 메시지 한 통. 공고마다 따로 보내면 하루 최대 22통이 채널을 덮어
// 목록을 한눈에 비교할 수 없었다. 이미지는 스레드로 내리고 여기엔 글만 싣는다.
export const formatArtJobDigest = ({
  items,
  mentionUserId,
  today,
}: ArtJobDigestInput): string => {
  const mention = mentionUserId ? `<@${mentionUserId}> ` : '';
  const header = `🎨 ${mention}게임잡 새 원화 공고 *${items.length}건*`;
  const blocks = items.map(({ listing, resolved }, index) => {
    return formatItem(index + 1, listing, resolved, today);
  });
  const hint = mentionUserId ? [EXCLUSION_HINT] : [];
  return [header, ...blocks, ...hint].join('\n\n');
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
    return name ? `🎮 ${name} · 이미지는 스레드에` : null;
  }
  const parts = name ? [`🎮 ${name}`] : [];
  if (resolved.preview) {
    parts.push('검색 미리보기는 스레드에');
  }
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

// 확인 못 한 검색 1순위 그림의 글 — 받는 사람이 다른 게임 그림을 이 공고의 것으로 오해하지 않게
// '확인 안 됨' 과 검색어·출처를 함께 밝힌다.
export const formatArtJobPreviewCaption = (
  order: number,
  searchQuery: string,
  preview: ArtJobImage,
): string => {
  const source = preview.sourceName
    ? ` · 출처: ${escapeSlackMrkdwn(preview.sourceName)}`
    : '';
  return `${order}. 🔎 검색 미리보기 · 확인 안 된 이미지 (검색어: ${escapeSlackMrkdwn(searchQuery)}${source})`;
};
