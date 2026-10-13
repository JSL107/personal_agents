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

export const pickKakaoImage = (
  documents: KakaoImageDocument[],
): ArtJobImage | null => {
  const picked = documents.find((document) => {
    return isTrustedMedia(document.docUrl) && document.width >= MIN_IMAGE_WIDTH;
  });
  if (!picked) {
    return null;
  }
  return {
    url: picked.imageUrl,
    origin: 'KAKAO_IMAGE',
    sourceName: picked.sourceName || new URL(picked.docUrl).hostname,
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
    try {
      return pickKakaoImage(
        await this.kakaoImageSearch.search(`${gameTitle} 게임`),
      );
    } catch (error) {
      this.logger.warn(`카카오 이미지 검색 실패: ${String(error)}`);
      return null;
    }
  }
}
