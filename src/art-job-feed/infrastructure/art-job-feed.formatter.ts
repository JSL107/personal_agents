import {
  escapeSlackMrkdwn,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
import {
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
  return [header, ...blocks].join('\n\n');
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
export const formatArtJobImageCaption = (
  order: number,
  gameTitle: string,
): string => {
  return `${order}. 🎮 ${escapeSlackMrkdwn(gameTitle)}`;
};
