import {
  escapeSlackMrkdwn,
  sanitizeForSlackLink,
} from '../../slack/format/mrkdwn.util';
import {
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';

export interface ArtJobHeaderInput {
  count: number;
  mentionUserId: string | null;
}

export const formatArtJobHeader = ({
  count,
  mentionUserId,
}: ArtJobHeaderInput): string => {
  const mention = mentionUserId ? `<@${mentionUserId}> ` : '';
  return `🎨 ${mention}게임잡 새 원화 공고 *${count}건*`;
};

// 공고 한 건 = 메시지 한 통. 이미지는 메시지 이미지 블록으로 따로 붙으므로 여기선 글만 만든다.
export const formatArtJobPosting = (
  listing: ArtJobListing,
  resolved: ResolvedArtJobImage,
): string => {
  const lines = [
    `*<${listing.detailUrl}|${escapeSlackMrkdwn(sanitizeForSlackLink(listing.title))}>*`,
    `🏢 ${escapeSlackMrkdwn(listing.company)}${
      listing.deadlineText
        ? ` · ⏰ ${escapeSlackMrkdwn(listing.deadlineText)}`
        : ''
    }`,
  ];
  if (resolved.gameTitle) {
    lines.push(`🎮 ${escapeSlackMrkdwn(resolved.gameTitle)}`);
  }
  // 이미지를 못 찾았을 때만 검색 링크를 단다 — 이미지가 있으면 중복 정보다.
  if (!resolved.image && resolved.googleSearchUrl) {
    lines.push(`🔎 <${resolved.googleSearchUrl}|구글 이미지 검색>`);
  }
  return lines.join('\n');
};
