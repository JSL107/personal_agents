import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ArtJobImage,
  ArtJobListing,
  ResolvedArtJobImage,
} from '../domain/art-job-feed.type';
import {
  buildImageSearchQuery,
  extractGameTitle,
  normalizeTitleKey,
} from '../domain/game-title';
import {
  ART_JOB_SOURCE_PORT,
  ArtJobSourcePort,
  GameImageResolverPort,
} from '../domain/port/art-job-feed.ports';
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

// 이보다 짧은 게임명은 부분 일치 검증이 의미 없다(플레이스토어 시작 일치와 같은 하한).
const MIN_VERIFIABLE_TITLE_LENGTH = 4;
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

  constructor(
    private readonly kakaoImageSearch: KakaoImageSearch,
    @Inject(ART_JOB_SOURCE_PORT)
    private readonly source: ArtJobSourcePort,
  ) {}

  async resolve(listing: ArtJobListing): Promise<ResolvedArtJobImage> {
    const gameTitle = extractGameTitle(listing.title, listing.company);
    const googleSearchUrl = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(buildImageSearchQuery(listing.company, gameTitle))}`;
    if (gameTitle) {
      const image =
        (await this.findPlayStoreIcon(gameTitle)) ??
        (await this.findKakaoVerified(listing.company, gameTitle));
      if (image) {
        return { gameTitle, image, googleSearchUrl: null };
      }
    }
    // 원화 공고의 2/3 는 미공개 프로젝트라 그 게임의 그림이 없다(실측 2026-10-15, 33건 중 21건).
    // 회사가 게임잡에 적은 「대표게임」으로 그 스튜디오의 그림체를 대신 보여준다 — 33건 중 10건이 플레이스토어와 일치.
    const representative = await this.findRepresentativeImage(listing);
    if (representative) {
      return {
        gameTitle,
        image: representative.image,
        representativeGame: representative.name,
        googleSearchUrl: null,
      };
    }
    return { gameTitle, image: null, googleSearchUrl };
  }

  // 대표게임마다 플레이스토어를 먼저 보고, 없으면 첫 대표게임만 카카오 기사로 확인한다 —
  // 카카오 확인은 후보 기사마다 페이지를 받아 비싸다.
  private async findRepresentativeImage(
    listing: ArtJobListing,
  ): Promise<{ name: string; image: ArtJobImage } | null> {
    let names: string[];
    try {
      names = await this.source.fetchRepresentativeGames(listing);
    } catch (error) {
      this.logger.warn(
        `대표게임 조회 실패 ${listing.sourceId}: ${String(error)}`,
      );
      return null;
    }
    for (const name of names) {
      const image = await this.findPlayStoreIcon(name);
      if (image) {
        return { name, image };
      }
    }
    if (names.length === 0) {
      return null;
    }
    const image = await this.findKakaoVerified(listing.company, names[0]);
    return image ? { name: names[0], image } : null;
  }

  private async findPlayStoreIcon(name: string): Promise<ArtJobImage | null> {
    try {
      const html = await fetchTextWithRetry({
        url: `https://play.google.com/store/search?q=${encodeURIComponent(name)}&c=apps&hl=ko&gl=KR`,
        timeoutMs: 10_000,
        label: '플레이스토어 검색',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const key = normalizeTitleKey(name);
      const app = parsePlayStoreSearch(html).find((candidate) => {
        const appKey = normalizeTitleKey(candidate.name);
        return appKey === key || (key.length >= 4 && appKey.startsWith(key));
      });
      return app ? { url: `${app.iconUrl}=w512`, origin: 'PLAY_STORE' } : null;
    } catch (error) {
      this.logger.warn(`플레이스토어 이미지 조회 실패: ${String(error)}`);
      return null;
    }
  }

  // 플레이스토어에 없으면 카카오 이미지 검색에서 기사 제목으로 확인된 그림을 찾는다.
  private async findKakaoVerified(
    company: string,
    name: string,
  ): Promise<ArtJobImage | null> {
    const documents = await this.searchKakao(
      buildImageSearchQuery(company, name),
    );
    return this.findVerified(documents, name);
  }

  private async searchKakao(query: string): Promise<KakaoImageDocument[]> {
    if (!this.kakaoImageSearch.isEnabled()) {
      return [];
    }
    try {
      return await this.kakaoImageSearch.search(query);
    } catch (error) {
      this.logger.warn(`카카오 이미지 검색 실패: ${String(error)}`);
      return [];
    }
  }

  // 게임 매체 기사이고 기사 제목에 게임명이 있는 그림만 '확인됨' 으로 친다.
  private async findVerified(
    documents: KakaoImageDocument[],
    gameTitle: string,
  ): Promise<ArtJobImage | null> {
    // 'NC' 같은 짧은 이름은 기사 제목 검증이 무력하다('NCSOFT' 가 든 모든 기사와 일치).
    // 플레이스토어 시작 일치와 같은 하한을 둔다.
    if (normalizeTitleKey(gameTitle).length < MIN_VERIFIABLE_TITLE_LENGTH) {
      return null;
    }
    for (const candidate of filterKakaoCandidates(documents)) {
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
