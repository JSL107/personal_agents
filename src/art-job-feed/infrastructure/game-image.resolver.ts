import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';
import { extractGameTitle, normalizeTitleKey } from '../domain/game-title';
import {
  ART_JOB_SOURCE_PORT,
  ArtJobSourcePort,
  GameImageResolverPort,
} from '../domain/port/art-job-feed.ports';
import { fetchTextWithRetry } from './fetch-text-with-retry';
import { parsePlayStoreSearch } from './play-store.parser';

@Injectable()
export class GameImageResolver implements GameImageResolverPort {
  private readonly logger = new Logger(GameImageResolver.name);

  constructor(
    @Inject(ART_JOB_SOURCE_PORT) private readonly source: ArtJobSourcePort,
  ) {}

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
          return appKey.includes(key) || key.includes(appKey);
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
    try {
      const photos = await this.source.fetchCompanyPhotoUrls(listing.sourceId);
      if (photos[0]) {
        return {
          gameTitle,
          image: { url: photos[0], origin: 'COMPANY_PHOTO' },
          googleSearchUrl: null,
        };
      }
    } catch (error) {
      this.logger.warn(`게임잡 회사 사진 조회 실패: ${String(error)}`);
    }
    return {
      gameTitle,
      image: null,
      googleSearchUrl: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(gameTitle ?? `${listing.company} 게임`)}`,
    };
  }
}
