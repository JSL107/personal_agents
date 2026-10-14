import { Injectable, Logger } from '@nestjs/common';

import {
  ArtJobImage,
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';
import { extractGameTitle, normalizeTitleKey } from '../domain/game-title';
import { GameImageResolverPort } from '../domain/port/art-job-feed.ports';
import { fetchTextWithRetry } from './fetch-text-with-retry';
import { KakaoImageDocument, KakaoImageSearch } from './kakao-image.search';
import { parsePlayStoreSearch } from './play-store.parser';

// 이미지 검색은 이름만 보고 찾아서 팬아트·동명 게임이 섞인다. 게임 매체 기사에 실린 이미지만 받는다.
const TRUSTED_GAME_MEDIA_HOSTS = [
  'inven.co.kr',
  'ruliweb.com',
  'thisisgame.com',
  'gamemeca.com',
  'gamefocus.co.kr',
  'gameshot.net',
  'game.donga.com',
  'gamechosun.co.kr',
  'dailygame.co.kr',
  'khgames.co.kr',
  'gametoc.co.kr',
  'playforum.net',
];
// 썸네일 수준의 작은 그림은 스레드에서 알아보기 어렵다.
const MIN_IMAGE_WIDTH = 400;

const isTrustedMedia = (docUrl: string): boolean => {
  try {
    const host = new URL(docUrl).hostname;
    return TRUSTED_GAME_MEDIA_HOSTS.some((trusted) => {
      return host === trusted || host.endsWith(`.${trusted}`);
    });
  } catch {
    return false;
  }
};

// 기사 제목까지 확인할 후보 수 — 후보마다 기사 페이지를 한 번씩 받는다.
const MAX_ARTICLE_CHECKS = 5;

// 출처가 게임 매체이고 충분히 큰 그림만 후보로 남긴다. 그림이 그 게임 것인지는 아직 모른다.
export const filterKakaoCandidates = (
  documents: KakaoImageDocument[],
): KakaoImageDocument[] => {
  return documents
    .filter((document) => {
      return (
        isTrustedMedia(document.docUrl) && document.width >= MIN_IMAGE_WIDTH
      );
    })
    .slice(0, MAX_ARTICLE_CHECKS);
};

const decodeEntities = (text: string): string => {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
};

// og:title 의 content 는 같은 따옴표로 닫힐 때까지 읽는다 — 제목 안의 다른 따옴표('이터널 리턴')에서
// 끊으면 게임명이 잘려 나간다(실측). 속성 순서도 사이트마다 달라 태그 단위로 찾는다.
const readArticleTitles = (html: string): string[] => {
  const titles: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/og:title/i.test(tag)) {
      continue;
    }
    const content = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2];
    if (content) {
      titles.push(content);
    }
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  if (title) {
    titles.push(title);
  }
  return titles.map(decodeEntities);
};

// 기사 제목(og:title·title)에 게임명이 있어야 그 게임의 그림으로 본다. 실측(2026-10-14)에서
// 매체·크기 조건만으로는 다른 게임의 키아트와 무관한 사진이 절반가량 채택됐다.
export const articleMentionsGame = (
  html: string,
  gameTitle: string,
): boolean => {
  const key = normalizeTitleKey(gameTitle);
  return readArticleTitles(html).some((title) => {
    return normalizeTitleKey(title).includes(key);
  });
};

const toKakaoImage = (document: KakaoImageDocument): ArtJobImage => {
  return {
    url: document.imageUrl,
    origin: 'KAKAO_IMAGE',
    sourceName: document.sourceName || new URL(document.docUrl).hostname,
  };
};

@Injectable()
export class GameImageResolver implements GameImageResolverPort {
  private readonly logger = new Logger(GameImageResolver.name);

  constructor(private readonly kakaoImageSearch: KakaoImageSearch) {}

  async resolve(listing: ArtJobListing): Promise<ResolvedArtJobImage> {
    const gameTitle = extractGameTitle(listing.title, listing.company);
    if (gameTitle) {
      try {
        const html = await fetchTextWithRetry({
          url: `https://play.google.com/store/search?q=${encodeURIComponent(gameTitle)}&c=apps&hl=ko&gl=KR`,
          timeoutMs: 10_000,
          label: '플레이스토어 검색',
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        const key = normalizeTitleKey(gameTitle);
        const app = parsePlayStoreSearch(html).find((candidate) => {
          const appKey = normalizeTitleKey(candidate.name);
          return appKey === key || (key.length >= 4 && appKey.startsWith(key));
        });
        if (app) {
          return {
            gameTitle,
            image: { url: `${app.iconUrl}=w512`, origin: 'PLAY_STORE' },
            googleSearchUrl: null,
          };
        }
      } catch (error) {
        this.logger.warn(`플레이스토어 이미지 조회 실패: ${String(error)}`);
      }
    }
    // 플레이스토어에 없는(대개 미출시) 게임만 이미지 검색으로 보강한다.
    const searched = gameTitle ? await this.searchKakao(gameTitle) : null;
    if (searched) {
      return { gameTitle, image: searched, googleSearchUrl: null };
    }
    return {
      gameTitle,
      image: null,
      googleSearchUrl: gameTitle
        ? `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(gameTitle)}`
        : null,
    };
  }

  private async searchKakao(gameTitle: string): Promise<ArtJobImage | null> {
    if (!this.kakaoImageSearch.isEnabled()) {
      return null;
    }
    let candidates: KakaoImageDocument[];
    try {
      candidates = filterKakaoCandidates(
        await this.kakaoImageSearch.search(`${gameTitle} 게임`),
      );
    } catch (error) {
      this.logger.warn(`카카오 이미지 검색 실패: ${String(error)}`);
      return null;
    }
    for (const candidate of candidates) {
      if (await this.isArticleAboutGame(candidate.docUrl, gameTitle)) {
        return toKakaoImage(candidate);
      }
    }
    return null;
  }

  // 기사를 못 받으면 검증 실패로 친다 — 확인 못 한 그림을 싣느니 안 싣는다.
  private async isArticleAboutGame(
    docUrl: string,
    gameTitle: string,
  ): Promise<boolean> {
    try {
      const html = await fetchTextWithRetry({
        url: docUrl,
        timeoutMs: 5_000,
        label: '게임 매체 기사',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      return articleMentionsGame(html, gameTitle);
    } catch (error) {
      this.logger.warn(`기사 확인 실패 ${docUrl}: ${String(error)}`);
      return false;
    }
  }
}
